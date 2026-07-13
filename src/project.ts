import { createHash } from 'node:crypto';
import { access, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { transform } from '@astrojs/compiler';
import type {
  FlockEditIntent,
  FlockPreviewInput,
  FlockProjectSummary,
  FlockSectionPacket,
  FlockSectionSummary,
  JsonObject,
} from './types.js';

const SECTION_ID_PATTERN = /data-section-id\s*=\s*["']([^"']+)["']/;
const SECTION_ROLE_PATTERN = /data-stitch-role\s*=\s*["']section["']/;
const EXTERNAL_SCRIPT_PATTERN = /<script\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\//i;
const MAX_SECTION_BYTES = 160 * 1024;

interface StitchManifest extends JsonObject {
  projectId?: string;
  files?: Array<{ path?: string; hash?: string }>;
  source?: { contractHash?: string; runHash?: string };
  target?: { framework?: string; rendererTarget?: string };
}

interface SectionRecord {
  id: string;
  absolutePath: string;
  relativePath: string;
  source: string;
}

export class FlockProjectError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'flock_error',
    readonly failures?: string[],
  ) {
    super(message);
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson<T = unknown>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sha256(source: string | Buffer): string {
  return `sha256:${createHash('sha256').update(source).digest('hex')}`;
}

function normalizeRelative(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function assertInside(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new FlockProjectError('Resolved path escapes the project root.', 403, 'unsafe_path');
  }
}

async function findAstroFiles(directory: string): Promise<string[]> {
  if (!(await exists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) return findAstroFiles(candidate);
    return entry.isFile() && entry.name.endsWith('.astro') ? [candidate] : [];
  }));
  return nested.flat();
}

function findSectionContract(contract: unknown, sectionId: string): { page?: JsonObject; section?: JsonObject } {
  if (!isObject(contract) || !Array.isArray(contract.pages)) return {};
  for (const pageValue of contract.pages) {
    if (!isObject(pageValue) || !Array.isArray(pageValue.sections)) continue;
    const section = pageValue.sections.find((candidate) => isObject(candidate) && candidate.id === sectionId);
    if (isObject(section)) return { page: pageValue, section };
  }
  return {};
}

function sectionScopedItems(value: unknown, sectionId: string): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => isObject(item) && item.sectionId === sectionId);
}

function sectionReviewItems(provenance: unknown, sectionId: string): unknown[] {
  if (!isObject(provenance) || !isObject(provenance.review) || !Array.isArray(provenance.review.items)) return [];
  return provenance.review.items.filter((item) => {
    if (!isObject(item)) return false;
    const contractPath = typeof item.contractPath === 'string' ? item.contractPath : '';
    return item.sectionId === sectionId || contractPath.includes(sectionId);
  });
}

function sectionRecipes(contract: unknown, sectionId: string): unknown[] {
  if (!isObject(contract) || !isObject(contract.designSystem) || !isObject(contract.designSystem.recipes)) return [];
  const items = contract.designSystem.recipes.items;
  if (!Array.isArray(items)) return [];
  return items.filter((recipe) => isObject(recipe) && Array.isArray(recipe.appliesTo)
    && recipe.appliesTo.some((target) => typeof target === 'string' && target.startsWith(`${sectionId}.`)));
}

function visualFor(visualIndex: unknown, sectionId: string): JsonObject | undefined {
  if (!isObject(visualIndex) || !Array.isArray(visualIndex.sections)) return undefined;
  return visualIndex.sections.find((entry) => isObject(entry) && entry.sectionId === sectionId) as JsonObject | undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function sourceAttributes(source: string, attributes: string[]): string[] {
  const values: string[] = [];
  for (const attribute of attributes) {
    const pattern = new RegExp(`\\b${attribute}\\s*=\\s*["']([^"']+)["']`, 'gi');
    for (const match of source.matchAll(pattern)) if (match[1]) values.push(match[1]);
  }
  return unique(values);
}

function sourceVisibleContent(source: string): string[] {
  const body = source
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/\{[\s\S]*?\}/g, '');
  const values: string[] = [];
  for (const match of body.matchAll(/>([^<]+)</g)) {
    const text = match[1]?.replace(/\s+/g, ' ').trim();
    if (text && text.length > 1) values.push(text);
  }
  return unique(values);
}

function collectHintedStrings(value: unknown, keyPattern: RegExp, output: string[], parentKey = ''): void {
  if (typeof value === 'string') {
    if (keyPattern.test(parentKey)) output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectHintedStrings(item, keyPattern, output, parentKey);
    return;
  }
  if (!isObject(value)) return;
  for (const [key, item] of Object.entries(value)) collectHintedStrings(item, keyPattern, output, key);
}

function compactVisibleContent(...values: unknown[]): string[] {
  const output: string[] = [];
  for (const value of values) collectHintedStrings(value, /^(text|copy|content|title|heading|label|body|eyebrow|caption)$/i, output);
  return unique(output).filter((item) => item.length <= 500).slice(0, 120);
}

function compactLinks(...values: unknown[]): string[] {
  const output: string[] = [];
  for (const value of values) collectHintedStrings(value, /^(href|url|destination|targetUrl|action)$/i, output);
  return unique(output).slice(0, 80);
}

function compactAssets(...values: unknown[]): string[] {
  const output: string[] = [];
  for (const value of values) collectHintedStrings(value, /^(src|asset|assetPath|image|poster|media)$/i, output);
  return unique(output).slice(0, 80);
}

function flattenTokens(value: unknown, pathParts: string[] = [], output: Array<[string, unknown]> = []): Array<[string, unknown]> {
  if (!isObject(value)) {
    if (pathParts.length) output.push([pathParts.join('.'), value]);
    return output;
  }
  for (const [key, item] of Object.entries(value)) flattenTokens(item, [...pathParts, key], output);
  return output;
}

function referencedTokens(tokens: unknown, references: unknown[]): JsonObject | undefined {
  if (!isObject(tokens)) return undefined;
  const haystack = JSON.stringify(references).toLowerCase();
  const selected = flattenTokens(tokens).filter(([tokenPath, value]) => {
    const leaf = tokenPath.split('.').at(-1) ?? tokenPath;
    const valueString = typeof value === 'string' ? value : '';
    return haystack.includes(tokenPath.toLowerCase())
      || (leaf.length > 3 && haystack.includes(leaf.toLowerCase()))
      || (valueString.startsWith('var(') && haystack.includes(valueString.toLowerCase()));
  }).slice(0, 80);
  return selected.length ? Object.fromEntries(selected) : undefined;
}

function missingValues(required: string[], candidate: string): string[] {
  return required.filter((value) => !candidate.includes(value));
}

async function candidateFailures(
  current: SectionRecord,
  source: string,
  intent: FlockEditIntent,
): Promise<string[]> {
  const failures: string[] = [];
  if (!source.trim()) failures.push('Candidate source is empty.');
  if (Buffer.byteLength(source, 'utf8') > MAX_SECTION_BYTES) failures.push(`Candidate exceeds ${MAX_SECTION_BYTES / 1024} KB.`);
  if (!SECTION_ROLE_PATTERN.test(source)) failures.push('Required data-stitch-role="section" is missing.');
  if (source.match(SECTION_ID_PATTERN)?.[1] !== current.id) failures.push(`Required data-section-id="${current.id}" is missing or changed.`);
  if (EXTERNAL_SCRIPT_PATTERN.test(source)) failures.push('External scripts are not allowed.');

  if (!intent.mayChangeContent) {
    const missing = missingValues(sourceVisibleContent(current.source), source);
    if (missing.length) failures.push(`Visible content disappeared: ${missing.slice(0, 6).join(' | ')}`);
  }
  if (!intent.mayChangeLinks) {
    const missing = missingValues(sourceAttributes(current.source, ['href', 'action']), source);
    if (missing.length) failures.push(`Required links disappeared: ${missing.slice(0, 6).join(' | ')}`);
  }
  if (!intent.mayChangeAssets) {
    const missing = missingValues(sourceAttributes(current.source, ['src', 'poster']), source);
    if (missing.length) failures.push(`Required assets disappeared: ${missing.slice(0, 6).join(' | ')}`);
  }

  if (!failures.length) {
    try {
      const result = await transform(source, { filename: current.absolutePath, sourcemap: false });
      const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 1);
      for (const diagnostic of errors.slice(0, 8)) {
        failures.push(`Astro compiler: ${diagnostic.text} (${diagnostic.location.line}:${diagnostic.location.column})`);
      }
      for (const styleError of result.styleError.slice(0, 4)) failures.push(`Style compiler: ${styleError}`);
    } catch (error) {
      failures.push(`Astro compiler: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failures;
}

export class StitchProject {
  readonly root: string;
  readonly stitchRoot: string;
  private readonly previousSource = new Map<string, string>();
  private readonly mutationTails = new Map<string, Promise<unknown>>();

  private constructor(root: string) {
    this.root = path.resolve(root);
    this.stitchRoot = path.join(this.root, '.stitch');
  }

  static async open(root: string): Promise<StitchProject> {
    const project = new StitchProject(root);
    const manifestPath = path.join(project.stitchRoot, 'manifest.json');
    if (!(await exists(manifestPath))) {
      throw new Error(`Not a Stitch project: missing ${normalizeRelative(path.relative(project.root, manifestPath))}`);
    }
    const manifest = await readJson<StitchManifest>(manifestPath);
    if (manifest.target?.framework !== 'astro') {
      throw new Error(`Unsupported Stitch target: ${String(manifest.target?.framework ?? 'unknown')}`);
    }
    return project;
  }

  private async manifest(): Promise<StitchManifest> {
    return readJson<StitchManifest>(path.join(this.stitchRoot, 'manifest.json'));
  }

  private async contract(): Promise<JsonObject> {
    return readJson<JsonObject>(path.join(this.stitchRoot, 'contract.json'));
  }

  private async optionalJson(filePath: string): Promise<unknown | undefined> {
    return await exists(filePath) ? readJson(filePath) : undefined;
  }

  private async scanSections(): Promise<Map<string, SectionRecord>> {
    const files = await findAstroFiles(path.join(this.root, 'src'));
    const sections = new Map<string, SectionRecord>();
    for (const absolutePath of files) {
      const source = await readFile(absolutePath, 'utf8');
      const id = source.match(SECTION_ID_PATTERN)?.[1];
      if (!id || !SECTION_ROLE_PATTERN.test(source)) continue;
      if (sections.has(id)) throw new Error(`Duplicate Stitch section ID: ${id}`);
      sections.set(id, {
        id,
        absolutePath,
        relativePath: normalizeRelative(path.relative(this.root, absolutePath)),
        source,
      });
    }
    return sections;
  }

  private async sectionRecord(sectionId: string): Promise<SectionRecord> {
    const section = (await this.scanSections()).get(sectionId);
    if (!section) throw new FlockProjectError(`Unknown Stitch section: ${sectionId}`, 404, 'unknown_section');
    assertInside(this.root, section.absolutePath);
    return section;
  }

  private async withMutation<T>(sectionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.mutationTails.get(sectionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.mutationTails.set(sectionId, current);
    try {
      return await current;
    } finally {
      if (this.mutationTails.get(sectionId) === current) this.mutationTails.delete(sectionId);
    }
  }

  async summary(): Promise<FlockProjectSummary> {
    const [manifest, contract, run, visualIndex, sections] = await Promise.all([
      this.manifest(),
      this.contract(),
      this.optionalJson(path.join(this.stitchRoot, 'run.json')),
      this.optionalJson(path.join(this.stitchRoot, 'visuals', 'sections.json')),
      this.scanSections(),
    ]);
    const manifestHashes = new Map((manifest.files ?? [])
      .filter((item) => item.path && item.hash)
      .map((item) => [item.path as string, item.hash as string]));

    const summaries: FlockSectionSummary[] = [];
    for (const section of sections.values()) {
      const currentHash = sha256(section.source);
      const originalHash = manifestHashes.get(section.relativePath);
      const contractEntry = findSectionContract(contract, section.id);
      const visual = visualFor(visualIndex, section.id);
      summaries.push({
        id: section.id,
        label: typeof contractEntry.section?.label === 'string' ? contractEntry.section.label : undefined,
        intent: typeof contractEntry.section?.intent === 'string' ? contractEntry.section.intent : undefined,
        route: typeof contractEntry.page?.route === 'string' ? contractEntry.page.route : undefined,
        file: section.relativePath,
        modified: Boolean(originalHash && originalHash !== currentHash),
        originalHash,
        currentHash,
        hasVisual: Boolean(visual?.path),
        hasFailure: await exists(path.join(this.stitchRoot, 'failures', 'sections', `${section.id}.json`)),
        canRevert: this.previousSource.has(section.id),
      });
    }
    summaries.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

    const runObject = isObject(run) ? run : {};
    const contractProject = isObject(contract.project) ? contract.project : {};
    return {
      kind: 'flock.projectSummary',
      version: '1.0.0',
      projectId: manifest.projectId ?? 'unknown',
      projectName: typeof contractProject.name === 'string' ? contractProject.name : undefined,
      stitchRunStatus: typeof runObject.status === 'string' ? runObject.status : undefined,
      projectionStatus: isObject(runObject.projection) && typeof runObject.projection.status === 'string'
        ? runObject.projection.status : undefined,
      publicationStatus: isObject(runObject.publication) && typeof runObject.publication.status === 'string'
        ? runObject.publication.status : undefined,
      sections: summaries,
    };
  }

  async packet(sectionId: string): Promise<FlockSectionPacket> {
    const [manifest, contract, provenance] = await Promise.all([
      this.manifest(),
      this.contract(),
      this.optionalJson(path.join(this.stitchRoot, 'provenance.json')),
    ]);
    const record = await this.sectionRecord(sectionId);
    const { page, section } = findSectionContract(contract, sectionId);
    const factsRoot = isObject(contract.facts) ? contract.facts : {};
    const designSystem = isObject(contract.designSystem) ? contract.designSystem : {};
    const facts = sectionScopedItems(factsRoot.items, sectionId);
    const occurrences = sectionScopedItems(factsRoot.occurrences, sectionId);
    const recipes = sectionRecipes(contract, sectionId);
    const failurePath = path.join(this.stitchRoot, 'failures', 'sections', `${sectionId}.json`);

    return {
      kind: 'flock.sectionPacket',
      version: '1.0.0',
      section: {
        id: sectionId,
        label: typeof section?.label === 'string' ? section.label : undefined,
        intent: typeof section?.intent === 'string' ? section.intent : undefined,
        route: typeof page?.route === 'string' ? page.route : undefined,
        file: record.relativePath,
        source: record.source,
        baseHash: sha256(record.source),
      },
      visibleContent: unique([
        ...sourceVisibleContent(record.source),
        ...compactVisibleContent(section, facts, occurrences),
      ]).slice(0, 160),
      links: unique([
        ...sourceAttributes(record.source, ['href', 'action']),
        ...compactLinks(section, facts, occurrences),
      ]).slice(0, 100),
      assets: unique([
        ...sourceAttributes(record.source, ['src', 'poster']),
        ...compactAssets(section, facts, occurrences),
      ]).slice(0, 100),
      contract: section,
      facts,
      occurrences,
      recipes,
      tokens: referencedTokens(designSystem.tokens, [record.source, section, recipes]),
      reviewItems: sectionReviewItems(provenance, sectionId),
      failure: await this.optionalJson(failurePath),
      constraints: {
        framework: 'astro',
        styling: 'tailwind',
        replacementUnit: 'complete-section-file',
        requiredSectionId: sectionId,
        requiredRootAttribute: 'data-stitch-role="section"',
        preserveContentByDefault: true,
        preserveLinksByDefault: true,
        preserveAssetsByDefault: true,
        noExternalScripts: true,
      },
    };
  }

  async visual(sectionId: string): Promise<{ path: string; mimeType: string } | undefined> {
    const visualIndex = await this.optionalJson(path.join(this.stitchRoot, 'visuals', 'sections.json'));
    const visual = visualFor(visualIndex, sectionId);
    if (!visual || typeof visual.path !== 'string') return undefined;
    const absolutePath = path.resolve(this.root, visual.path);
    assertInside(this.root, absolutePath);
    if (!(await exists(absolutePath))) return undefined;
    return {
      path: absolutePath,
      mimeType: typeof visual.mimeType === 'string' ? visual.mimeType : 'image/jpeg',
    };
  }

  async previewSection(sectionId: string, input: FlockPreviewInput): Promise<FlockSectionSummary> {
    return this.withMutation(sectionId, async () => {
      const current = await this.sectionRecord(sectionId);
      if (sha256(current.source) !== input.baseHash) {
        throw new FlockProjectError(
          'This section changed while local AI was working. Generate again from the current version.',
          409,
          'stale_source',
        );
      }
      const source = input.source.trim();
      const failures = await candidateFailures(current, source, input.intent);
      if (failures.length) {
        throw new FlockProjectError('The candidate did not pass Flock checks.', 422, 'candidate_invalid', failures);
      }

      if (!this.previousSource.has(sectionId)) this.previousSource.set(sectionId, current.source);
      await this.atomicWrite(current.absolutePath, `${source}\n`);
      return this.getSectionSummary(sectionId);
    });
  }

  async keepSection(sectionId: string): Promise<FlockSectionSummary> {
    return this.withMutation(sectionId, async () => {
      await this.sectionRecord(sectionId);
      this.previousSource.delete(sectionId);
      return this.getSectionSummary(sectionId);
    });
  }

  async revertSection(sectionId: string): Promise<FlockSectionSummary> {
    return this.withMutation(sectionId, async () => {
      const previous = this.previousSource.get(sectionId);
      if (previous === undefined) {
        throw new FlockProjectError('No in-session preview is available for this section.', 409, 'nothing_to_revert');
      }
      const current = await this.sectionRecord(sectionId);
      await this.atomicWrite(current.absolutePath, previous);
      this.previousSource.delete(sectionId);
      return this.getSectionSummary(sectionId);
    });
  }

  private async atomicWrite(absolutePath: string, source: string): Promise<void> {
    const temporary = `${absolutePath}.flock-${process.pid}-${Date.now()}.tmp`;
    assertInside(this.root, temporary);
    try {
      await writeFile(temporary, source, 'utf8');
      await rename(temporary, absolutePath);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private async getSectionSummary(sectionId: string): Promise<FlockSectionSummary> {
    const section = (await this.summary()).sections.find((item) => item.id === sectionId);
    if (!section) throw new FlockProjectError(`Unknown Stitch section: ${sectionId}`, 404, 'unknown_section');
    return section;
  }
}
