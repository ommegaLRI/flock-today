import { createHash } from 'node:crypto';
import { access, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  FlockProjectSummary,
  FlockSectionContext,
  FlockSectionSummary,
  JsonObject,
} from './types.js';

const SECTION_ID_PATTERN = /data-section-id\s*=\s*["']([^"']+)["']/;
const SECTION_ROLE_PATTERN = /data-stitch-role\s*=\s*["']section["']/;

interface StitchManifest extends JsonObject {
  projectId?: string;
  version?: string;
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
    throw new Error('Resolved path escapes the project root.');
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

export class StitchProject {
  readonly root: string;
  readonly stitchRoot: string;
  private readonly previousSource = new Map<string, string>();

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
    if (!section) throw new Error(`Unknown Stitch section: ${sectionId}`);
    assertInside(this.root, section.absolutePath);
    return section;
  }

  async summary(generatorAvailable: boolean): Promise<FlockProjectSummary> {
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
      });
    }
    summaries.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

    const runObject = isObject(run) ? run : {};
    const contractProject = isObject(contract.project) ? contract.project : {};
    const contractOrigin = isObject(contract.origin) ? contract.origin : {};
    return {
      kind: 'flock.projectSummary',
      version: '0.1.0',
      projectId: manifest.projectId ?? 'unknown',
      projectName: typeof contractProject.name === 'string' ? contractProject.name : undefined,
      sourceUrl: typeof contractOrigin.sourceUrl === 'string' ? contractOrigin.sourceUrl : undefined,
      contractVersion: typeof contract.version === 'string' ? contract.version : undefined,
      contractHash: manifest.source?.contractHash,
      runHash: manifest.source?.runHash,
      stitchRunStatus: typeof runObject.status === 'string' ? runObject.status : undefined,
      projectionStatus: isObject(runObject.projection) && typeof runObject.projection.status === 'string'
        ? runObject.projection.status : undefined,
      publicationStatus: isObject(runObject.publication) && typeof runObject.publication.status === 'string'
        ? runObject.publication.status : undefined,
      generatorAvailable,
      sections: summaries,
    };
  }

  async context(sectionId: string): Promise<FlockSectionContext> {
    const [manifest, contract, provenance, visualIndex] = await Promise.all([
      this.manifest(),
      this.contract(),
      this.optionalJson(path.join(this.stitchRoot, 'provenance.json')),
      this.optionalJson(path.join(this.stitchRoot, 'visuals', 'sections.json')),
    ]);
    const sectionRecord = await this.sectionRecord(sectionId);
    const originalHash = (manifest.files ?? []).find((item) => item.path === sectionRecord.relativePath)?.hash;
    const { page, section } = findSectionContract(contract, sectionId);
    const factsRoot = isObject(contract.facts) ? contract.facts : {};
    const designSystem = isObject(contract.designSystem) ? contract.designSystem : {};
    const visual = visualFor(visualIndex, sectionId);
    const failurePath = path.join(this.stitchRoot, 'failures', 'sections', `${sectionId}.json`);

    return {
      kind: 'flock.sectionContext',
      version: '0.1.0',
      project: {
        id: manifest.projectId ?? 'unknown',
        name: isObject(contract.project) && typeof contract.project.name === 'string' ? contract.project.name : undefined,
        sourceUrl: isObject(contract.origin) && typeof contract.origin.sourceUrl === 'string' ? contract.origin.sourceUrl : undefined,
        contractVersion: typeof contract.version === 'string' ? contract.version : undefined,
        contractHash: manifest.source?.contractHash,
        runHash: manifest.source?.runHash,
        framework: manifest.target?.framework,
        rendererTarget: manifest.target?.rendererTarget,
      },
      page,
      section: {
        id: sectionId,
        label: typeof section?.label === 'string' ? section.label : undefined,
        intent: typeof section?.intent === 'string' ? section.intent : undefined,
        route: typeof page?.route === 'string' ? page.route : undefined,
        file: sectionRecord.relativePath,
        source: sectionRecord.source,
        modified: Boolean(originalHash && originalHash !== sha256(sectionRecord.source)),
        contract: section,
      },
      facts: sectionScopedItems(factsRoot.items, sectionId),
      occurrences: sectionScopedItems(factsRoot.occurrences, sectionId),
      recipes: sectionRecipes(contract, sectionId),
      tokens: designSystem.tokens,
      reviewItems: sectionReviewItems(provenance, sectionId),
      failure: await this.optionalJson(failurePath),
      visual: visual && typeof visual.path === 'string' ? {
        path: visual.path,
        mimeType: typeof visual.mimeType === 'string' ? visual.mimeType : undefined,
        width: typeof visual.width === 'number' ? visual.width : undefined,
        height: typeof visual.height === 'number' ? visual.height : undefined,
      } : undefined,
      constraints: {
        framework: 'astro',
        styling: 'tailwind',
        replacementUnit: 'complete-section-file',
        requiredSectionId: sectionId,
        requiredRootAttribute: 'data-stitch-role="section"',
        preserveProjectFilesOutsideSection: true,
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

  async replaceSection(sectionId: string, nextSource: string): Promise<FlockSectionSummary> {
    const current = await this.sectionRecord(sectionId);
    const source = nextSource.trim();
    if (!source) throw new Error('Generated section source is empty.');
    if (!SECTION_ROLE_PATTERN.test(source)) {
      throw new Error('Generated section must retain data-stitch-role="section".');
    }
    const generatedId = source.match(SECTION_ID_PATTERN)?.[1];
    if (generatedId !== sectionId) {
      throw new Error(`Generated section must retain data-section-id="${sectionId}".`);
    }

    this.previousSource.set(sectionId, current.source);
    const temporary = `${current.absolutePath}.flock-${process.pid}-${Date.now()}.tmp`;
    assertInside(this.root, temporary);
    try {
      await writeFile(temporary, `${source}\n`, 'utf8');
      await rename(temporary, current.absolutePath);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    return this.getSectionSummary(sectionId);
  }

  async revertSection(sectionId: string): Promise<FlockSectionSummary> {
    const previous = this.previousSource.get(sectionId);
    if (previous === undefined) throw new Error('No in-session version is available for this section.');
    const current = await this.sectionRecord(sectionId);
    const temporary = `${current.absolutePath}.flock-${process.pid}-${Date.now()}.tmp`;
    assertInside(this.root, temporary);
    try {
      await writeFile(temporary, previous, 'utf8');
      await rename(temporary, current.absolutePath);
      this.previousSource.delete(sectionId);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    return this.getSectionSummary(sectionId);
  }

  hasRevert(sectionId: string): boolean {
    return this.previousSource.has(sectionId);
  }

  private async getSectionSummary(sectionId: string): Promise<FlockSectionSummary> {
    const summary = await this.summary(false);
    const section = summary.sections.find((item) => item.id === sectionId);
    if (!section) throw new Error(`Unknown Stitch section: ${sectionId}`);
    return section;
  }
}
