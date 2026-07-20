import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { transform } from "@astrojs/compiler";
import type {
  FlockAsset,
  FlockEditIntent,
  FlockPreviewInput,
  FlockProjectSummary,
  FlockSectionPacket,
  FlockSectionSummary,
  JsonObject,
} from "./types.js";

const SECTION_ID_PATTERN = /data-section-id\s*=\s*["']([^"']+)["']/;
const SECTION_ROLE_PATTERN = /data-stitch-role\s*=\s*["']section["']/;
const EXTERNAL_SCRIPT_PATTERN =
  /<script\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\//i;
const MAX_SECTION_BYTES = 160 * 1024;
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const FLOCK_ASSET_URL_PATTERN = /\/flock-assets\/[A-Za-z0-9._-]+/g;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

interface StitchRun extends JsonObject {
  kind?: string;
  version?: string;
  projectId?: string;
  status?: string;
  artifacts?: {
    contract?: string;
    designContract?: string;
    visuals?: string;
    failures?: unknown;
  };
  codegen?: JsonObject;
  publication?: JsonObject;
}

interface FlockBaselineSection {
  id: string;
  file: string;
  hash: string;
}

interface FlockBaseline {
  kind: "flock.baseline";
  version: "1.0.0";
  projectId: string;
  rendererTarget: string;
  createdAt: string;
  sections: FlockBaselineSection[];
}

interface FlockAssetRegistryEntry extends FlockAsset {
  sectionIds: string[];
}

interface FlockAssetRegistry {
  kind: "flock.assetRegistry";
  version: "1.0.0";
  assets: FlockAssetRegistryEntry[];
}

interface SectionRecord {
  id: string;
  absolutePath: string;
  relativePath: string;
  source: string;
}

interface StagedAsset {
  asset: FlockAsset;
  absolutePath: string;
  created: boolean;
}

export interface FlockAssetUploadInput {
  filename: string;
  mimeType: string;
  dataBase64: string;
}

export class FlockProjectError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "flock_error",
    readonly failures?: string[],
  ) {
    super(message);
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson<T = unknown>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
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
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

function normalizeRelative(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function assetHashHex(contentHash: string): string {
  return contentHash.startsWith("sha256:")
    ? contentHash.slice("sha256:".length)
    : contentHash;
}

function safeAssetFilename(
  filename: string,
  mimeType: FlockAsset["mimeType"],
): string {
  const extension = mimeType === "image/png" ? ".png" : ".svg";
  const basename = path
    .basename(filename || `asset${extension}`)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 90);
  const stem = (basename || "asset").replace(/\.(?:png|svg)$/i, "") || "asset";
  return `${stem}${extension}`;
}

function decodeBase64Asset(value: string): Buffer {
  const normalized = value.replace(/\s+/g, "");
  if (
    !normalized ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)
  ) {
    throw new FlockProjectError(
      "Asset data is not valid base64.",
      400,
      "invalid_asset_data",
    );
  }
  const buffer = Buffer.from(normalized, "base64");
  if (!buffer.byteLength)
    throw new FlockProjectError("Asset is empty.", 400, "empty_asset");
  if (buffer.byteLength > MAX_ASSET_BYTES) {
    throw new FlockProjectError(
      `Asset exceeds ${MAX_ASSET_BYTES / 1024 / 1024} MB.`,
      413,
      "asset_too_large",
    );
  }
  return buffer;
}

function pngDimensions(buffer: Buffer): { width?: number; height?: number } {
  if (buffer.byteLength < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new FlockProjectError(
      "The uploaded PNG is invalid.",
      400,
      "invalid_png",
    );
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return width && height ? { width, height } : {};
}

function svgDimensions(source: string): { width?: number; height?: number } {
  const root = source.match(/<svg\b([^>]*)>/i)?.[1] ?? "";
  const numberAttribute = (name: string): number | undefined => {
    const raw = root.match(
      new RegExp(
        `\\b${name}\\s*=\\s*["']([0-9]+(?:\\.[0-9]+)?)(?:px)?["']`,
        "i",
      ),
    )?.[1];
    const parsed = raw ? Number(raw) : undefined;
    return parsed && Number.isFinite(parsed) ? parsed : undefined;
  };
  const width = numberAttribute("width");
  const height = numberAttribute("height");
  if (width && height) return { width, height };
  const viewBox = root
    .match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
    ?.trim()
    .split(/[ ,]+/)
    .map(Number);
  const viewBoxWidth = viewBox?.[2];
  const viewBoxHeight = viewBox?.[3];
  if (
    viewBox?.length === 4 &&
    viewBox.every(Number.isFinite) &&
    viewBoxWidth !== undefined &&
    viewBoxHeight !== undefined &&
    viewBoxWidth > 0 &&
    viewBoxHeight > 0
  ) {
    return { width: viewBoxWidth, height: viewBoxHeight };
  }
  return {};
}

function sanitizeSvg(buffer: Buffer): {
  buffer: Buffer;
  width?: number;
  height?: number;
} {
  let source = buffer.toString("utf8").replace(/^\uFEFF/, "");
  if (!/<svg\b/i.test(source))
    throw new FlockProjectError(
      "The uploaded SVG is invalid.",
      400,
      "invalid_svg",
    );
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new FlockProjectError(
      "SVG document types and entities are not allowed.",
      400,
      "unsafe_svg",
    );
  }
  source = source
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(
      /<(?:foreignObject|iframe|object|embed|audio|video)\b[\s\S]*?<\/(?:foreignObject|iframe|object|embed|audio|video)\s*>/gi,
      "",
    )
    .replace(
      /<(?:foreignObject|iframe|object|embed|audio|video)\b[^>]*\/?>/gi,
      "",
    )
    .replace(/\s+on[A-Za-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/@import\s+[^;]+;?/gi, "")
    .replace(/<\?xml-stylesheet[\s\S]*?\?>/gi, "");
  source = source.replace(
    /\s+(?:href|xlink:href)\s*=\s*(["'])(.*?)\1/gi,
    (attribute: string, _quote: string, value: string) => {
      const normalized = value.trim();
      return normalized.startsWith("#") ? attribute : "";
    },
  );
  if (
    /javascript\s*:/i.test(source) ||
    /url\s*\(\s*['"]?(?:https?:|\/\/|javascript:|data:text\/html)/i.test(source)
  ) {
    throw new FlockProjectError(
      "External or executable SVG references are not allowed.",
      400,
      "unsafe_svg",
    );
  }
  const sanitized = Buffer.from(source, "utf8");
  if (sanitized.byteLength > MAX_ASSET_BYTES) {
    throw new FlockProjectError(
      `Asset exceeds ${MAX_ASSET_BYTES / 1024 / 1024} MB after sanitization.`,
      413,
      "asset_too_large",
    );
  }
  return { buffer: sanitized, ...svgDimensions(source) };
}

function assertInside(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new FlockProjectError(
      "Resolved path escapes the project root.",
      403,
      "unsafe_path",
    );
  }
}

async function findAstroFiles(directory: string): Promise<string[]> {
  if (!(await exists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) return findAstroFiles(candidate);
      return entry.isFile() && entry.name.endsWith(".astro") ? [candidate] : [];
    }),
  );
  return nested.flat();
}

function findSectionContract(
  contract: unknown,
  sectionId: string,
): { page?: JsonObject; section?: JsonObject } {
  if (!isObject(contract) || !Array.isArray(contract.pages)) return {};
  for (const pageValue of contract.pages) {
    if (!isObject(pageValue) || !Array.isArray(pageValue.sections)) continue;
    const section = pageValue.sections.find(
      (candidate) => isObject(candidate) && candidate.id === sectionId,
    );
    if (isObject(section)) return { page: pageValue, section };
  }
  return {};
}

function sectionScopedItems(value: unknown, sectionId: string): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => isObject(item) && item.sectionId === sectionId);
}

function issueMatchesSection(
  item: unknown,
  sectionId: string,
  relativePath: string,
): boolean {
  if (typeof item === "string") {
    return item.includes(sectionId) || item.includes(relativePath);
  }
  if (!isObject(item)) return false;
  if (item.sectionId === sectionId) return true;
  const searchable = [
    item.path,
    item.contractPath,
    item.message,
    item.observed,
  ].filter((value): value is string => typeof value === "string");
  return searchable.some(
    (value) => value.includes(sectionId) || value.includes(relativePath),
  );
}

function sectionReviewItems(
  contract: unknown,
  run: unknown,
  sectionId: string,
  relativePath: string,
): unknown[] {
  const items: unknown[] = [];
  if (isObject(contract) && isObject(contract.sourceLedger)) {
    const adequacy = contract.sourceLedger.adequacy;
    if (isObject(adequacy) && Array.isArray(adequacy.issues)) {
      items.push(...adequacy.issues);
    }
  }
  if (isObject(run) && isObject(run.codegen)) {
    const validation = run.codegen.validation;
    if (isObject(validation) && Array.isArray(validation.issues)) {
      items.push(...validation.issues);
    }
  }
  if (
    isObject(run) &&
    isObject(run.artifacts) &&
    Array.isArray(run.artifacts.failures)
  ) {
    items.push(...run.artifacts.failures);
  }
  return items.filter((item) =>
    issueMatchesSection(item, sectionId, relativePath),
  );
}

function sectionDesignStyles(
  designContract: unknown,
  section: JsonObject | undefined,
  sectionId: string,
): unknown[] {
  if (
    !isObject(designContract) ||
    !Array.isArray(designContract.sectionStyles)
  ) {
    return [];
  }
  const provenance = isObject(section?.provenance) ? section.provenance : {};
  const packetId =
    typeof provenance.packetId === "string" ? provenance.packetId : undefined;
  return designContract.sectionStyles.filter(
    (style) =>
      isObject(style) &&
      (style.sectionId === sectionId ||
        (packetId !== undefined && style.sectionId === packetId)),
  );
}

function designTokenRoot(designContract: unknown): JsonObject | undefined {
  if (!isObject(designContract)) return undefined;
  const tokens: JsonObject = {};
  for (const key of [
    "palette",
    "typography",
    "geometry",
    "spatial",
    "treatments",
    "production",
  ]) {
    if (isObject(designContract[key])) tokens[key] = designContract[key];
  }
  return Object.keys(tokens).length ? tokens : undefined;
}

function visualFor(
  visualIndex: unknown,
  sectionId: string,
): JsonObject | undefined {
  if (!isObject(visualIndex) || !Array.isArray(visualIndex.sections))
    return undefined;
  return visualIndex.sections.find(
    (entry) => isObject(entry) && entry.sectionId === sectionId,
  ) as JsonObject | undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function sourceAttributes(source: string, attributes: string[]): string[] {
  const values: string[] = [];
  for (const attribute of attributes) {
    const pattern = new RegExp(
      `\\b${attribute}\\s*=\\s*["']([^"']+)["']`,
      "gi",
    );
    for (const match of source.matchAll(pattern))
      if (match[1]) values.push(match[1]);
  }
  return unique(values);
}

function sourceVisibleContent(source: string): string[] {
  const body = source
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<!--([\s\S]*?)-->/g, "")
    .replace(/\{[\s\S]*?\}/g, "");
  const values: string[] = [];
  for (const match of body.matchAll(/>([^<]+)</g)) {
    const text = match[1]?.replace(/\s+/g, " ").trim();
    if (text && text.length > 1) values.push(text);
  }
  return unique(values);
}

function collectHintedStrings(
  value: unknown,
  keyPattern: RegExp,
  output: string[],
  parentKey = "",
): void {
  if (typeof value === "string") {
    if (keyPattern.test(parentKey)) output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value)
      collectHintedStrings(item, keyPattern, output, parentKey);
    return;
  }
  if (!isObject(value)) return;
  for (const [key, item] of Object.entries(value))
    collectHintedStrings(item, keyPattern, output, key);
}

function compactVisibleContent(...values: unknown[]): string[] {
  const output: string[] = [];
  for (const value of values)
    collectHintedStrings(
      value,
      /^(text|copy|content|title|heading|label|body|eyebrow|caption)$/i,
      output,
    );
  return unique(output)
    .filter((item) => item.length <= 500)
    .slice(0, 120);
}

function compactLinks(...values: unknown[]): string[] {
  const output: string[] = [];
  for (const value of values)
    collectHintedStrings(
      value,
      /^(href|url|destination|targetUrl|action)$/i,
      output,
    );
  return unique(output).slice(0, 80);
}

function compactAssets(...values: unknown[]): string[] {
  const output: string[] = [];
  for (const value of values)
    collectHintedStrings(
      value,
      /^(src|asset|assetPath|image|poster|media)$/i,
      output,
    );
  return unique(output).slice(0, 80);
}

function flattenTokens(
  value: unknown,
  pathParts: string[] = [],
  output: Array<[string, unknown]> = [],
): Array<[string, unknown]> {
  if (!isObject(value)) {
    if (pathParts.length) output.push([pathParts.join("."), value]);
    return output;
  }
  for (const [key, item] of Object.entries(value))
    flattenTokens(item, [...pathParts, key], output);
  return output;
}

function referencedTokens(
  tokens: unknown,
  references: unknown[],
): JsonObject | undefined {
  if (!isObject(tokens)) return undefined;
  const haystack = JSON.stringify(references).toLowerCase();
  const selected = flattenTokens(tokens)
    .filter(([tokenPath, value]) => {
      const leaf = tokenPath.split(".").at(-1) ?? tokenPath;
      const valueString = typeof value === "string" ? value : "";
      return (
        haystack.includes(tokenPath.toLowerCase()) ||
        (leaf.length > 3 && haystack.includes(leaf.toLowerCase())) ||
        (valueString.startsWith("var(") &&
          haystack.includes(valueString.toLowerCase()))
      );
    })
    .slice(0, 80);
  return selected.length ? Object.fromEntries(selected) : undefined;
}

function missingValues(required: string[], candidate: string): string[] {
  return required.filter((value) => !candidate.includes(value));
}

async function candidateFailures(
  root: string,
  current: SectionRecord,
  source: string,
  intent: FlockEditIntent,
): Promise<string[]> {
  const failures: string[] = [];
  if (!source.trim()) failures.push("Candidate source is empty.");
  if (Buffer.byteLength(source, "utf8") > MAX_SECTION_BYTES)
    failures.push(`Candidate exceeds ${MAX_SECTION_BYTES / 1024} KB.`);
  if (!SECTION_ROLE_PATTERN.test(source))
    failures.push('Required data-stitch-role="section" is missing.');
  if (source.match(SECTION_ID_PATTERN)?.[1] !== current.id)
    failures.push(
      `Required data-section-id="${current.id}" is missing or changed.`,
    );
  if (EXTERNAL_SCRIPT_PATTERN.test(source))
    failures.push("External scripts are not allowed.");

  for (const publicUrl of unique(source.match(FLOCK_ASSET_URL_PATTERN) ?? [])) {
    const absolutePath = path.resolve(root, "public", publicUrl.slice(1));
    assertInside(root, absolutePath);
    if (!(await exists(absolutePath)))
      failures.push(`Uploaded asset does not exist: ${publicUrl}`);
  }

  if (!intent.mayChangeContent) {
    const missing = missingValues(sourceVisibleContent(current.source), source);
    if (missing.length)
      failures.push(
        `Visible content disappeared: ${missing.slice(0, 6).join(" | ")}`,
      );
  }
  if (!intent.mayChangeLinks) {
    const missing = missingValues(
      sourceAttributes(current.source, ["href", "action"]),
      source,
    );
    if (missing.length)
      failures.push(
        `Required links disappeared: ${missing.slice(0, 6).join(" | ")}`,
      );
  }
  if (!intent.mayChangeAssets) {
    const missing = missingValues(
      sourceAttributes(current.source, ["src", "poster"]),
      source,
    );
    if (missing.length)
      failures.push(
        `Required assets disappeared: ${missing.slice(0, 6).join(" | ")}`,
      );
  }

  if (!failures.length) {
    try {
      const result = await transform(source, {
        filename: current.absolutePath,
        sourcemap: false,
      });
      const errors = result.diagnostics.filter(
        (diagnostic: { severity: number }) => diagnostic.severity === 1,
      );
      for (const diagnostic of errors.slice(0, 8)) {
        failures.push(
          `Astro compiler: ${diagnostic.text} (${diagnostic.location.line}:${diagnostic.location.column})`,
        );
      }
      for (const styleError of result.styleError.slice(0, 4))
        failures.push(`Style compiler: ${styleError}`);
    } catch (error) {
      failures.push(
        `Astro compiler: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return failures;
}

export class StitchProject {
  readonly root: string;
  readonly stitchRoot: string;
  readonly flockRoot: string;
  private readonly previousSource = new Map<string, string>();
  private readonly stagedAssets = new Map<string, Map<string, StagedAsset>>();
  private readonly mutationTails = new Map<string, Promise<unknown>>();

  private constructor(root: string) {
    this.root = path.resolve(root);
    this.stitchRoot = path.join(this.root, ".stitch");
    this.flockRoot = path.join(this.root, ".flock");
  }

  static async open(root: string): Promise<StitchProject> {
    const project = new StitchProject(root);
    const runPath = path.join(project.stitchRoot, "run.json");
    if (!(await exists(runPath))) {
      throw new Error(
        `Not a Stitch project: missing ${normalizeRelative(path.relative(project.root, runPath))}`,
      );
    }
    const run = await project.run();
    const contract = await project.contract(run);
    const rendererTarget =
      isObject(contract.profiles) &&
      typeof contract.profiles.rendererTarget === "string"
        ? contract.profiles.rendererTarget
        : undefined;
    if (rendererTarget !== "astroStatic.v0") {
      throw new Error(
        `Unsupported Stitch renderer target: ${String(rendererTarget ?? "unknown")}`,
      );
    }
    await project.designContract(run);
    const sections = await project.scanSections();
    if (!sections.size) {
      throw new Error(
        'Not a compatible Stitch project: no Astro sections with data-stitch-role="section" and data-section-id were found.',
      );
    }
    await project.ensureBaseline(run, rendererTarget, sections);
    return project;
  }

  private async run(): Promise<StitchRun> {
    const run = await readJson<StitchRun>(path.join(this.stitchRoot, "run.json"));
    if (run.kind !== "stitch.run") {
      throw new Error(
        `Unsupported Stitch run metadata: expected kind "stitch.run", received ${String(run.kind ?? "unknown")}.`,
      );
    }
    return run;
  }

  private artifactPath(
    run: StitchRun,
    artifact: "contract" | "designContract" | "visuals",
    required = true,
  ): string | undefined {
    const relativePath = run.artifacts?.[artifact];
    if (typeof relativePath !== "string" || !relativePath.trim()) {
      if (!required) return undefined;
      throw new Error(`Stitch run metadata is missing artifacts.${artifact}.`);
    }
    const absolutePath = path.resolve(this.root, relativePath);
    assertInside(this.root, absolutePath);
    return absolutePath;
  }

  private async contract(run?: StitchRun): Promise<JsonObject> {
    const resolvedRun = run ?? (await this.run());
    const contractPath = this.artifactPath(resolvedRun, "contract")!;
    if (!(await exists(contractPath))) {
      throw new Error(
        `Stitch application contract is missing: ${normalizeRelative(path.relative(this.root, contractPath))}`,
      );
    }
    return readJson<JsonObject>(contractPath);
  }

  private async designContract(run?: StitchRun): Promise<JsonObject> {
    const resolvedRun = run ?? (await this.run());
    const designContractPath = this.artifactPath(
      resolvedRun,
      "designContract",
    )!;
    if (!(await exists(designContractPath))) {
      throw new Error(
        `Stitch design contract is missing: ${normalizeRelative(path.relative(this.root, designContractPath))}`,
      );
    }
    return readJson<JsonObject>(designContractPath);
  }

  private async optionalJson(filePath: string): Promise<unknown | undefined> {
    return (await exists(filePath)) ? readJson(filePath) : undefined;
  }

  private async ensureBaseline(
    run: StitchRun,
    rendererTarget: string,
    sections: Map<string, SectionRecord>,
  ): Promise<void> {
    await mkdir(this.flockRoot, { recursive: true });
    const baselinePath = path.join(this.flockRoot, "baseline.json");
    const current = await this.optionalJson(baselinePath);
    const projectId = run.projectId ?? "unknown";
    const validCurrent =
      isObject(current) &&
      current.kind === "flock.baseline" &&
      current.projectId === projectId &&
      Array.isArray(current.sections);
    const priorSections = new Map<string, FlockBaselineSection>();
    if (validCurrent) {
      for (const value of current.sections as unknown[]) {
        if (
          isObject(value) &&
          typeof value.id === "string" &&
          typeof value.file === "string" &&
          typeof value.hash === "string"
        ) {
          priorSections.set(value.id, {
            id: value.id,
            file: value.file,
            hash: value.hash,
          });
        }
      }
    }
    for (const section of sections.values()) {
      const prior = priorSections.get(section.id);
      priorSections.set(section.id, {
        id: section.id,
        file: section.relativePath,
        hash: prior?.hash ?? sha256(section.source),
      });
    }
    const baseline: FlockBaseline = {
      kind: "flock.baseline",
      version: "1.0.0",
      projectId,
      rendererTarget,
      createdAt:
        validCurrent && typeof current.createdAt === "string"
          ? current.createdAt
          : new Date().toISOString(),
      sections: [...priorSections.values()].sort((a, b) =>
        a.id.localeCompare(b.id, undefined, { numeric: true }),
      ),
    };
    await this.atomicWrite(
      baselinePath,
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
  }

  private async baseline(): Promise<FlockBaseline> {
    const baselinePath = path.join(this.flockRoot, "baseline.json");
    const baseline = await readJson<FlockBaseline>(baselinePath);
    if (
      baseline.kind !== "flock.baseline" ||
      !Array.isArray(baseline.sections)
    ) {
      throw new Error("Flock baseline metadata is invalid.");
    }
    return baseline;
  }

  private async assetRegistry(): Promise<FlockAssetRegistry> {
    const registryPath = path.join(this.flockRoot, "assets.json");
    const value = await this.optionalJson(registryPath);
    if (
      !isObject(value) ||
      value.kind !== "flock.assetRegistry" ||
      !Array.isArray(value.assets)
    ) {
      return { kind: "flock.assetRegistry", version: "1.0.0", assets: [] };
    }
    const assets: FlockAssetRegistryEntry[] = [];
    for (const entry of value.assets) {
      if (
        !isObject(entry) ||
        typeof entry.id !== "string" ||
        typeof entry.filename !== "string" ||
        (entry.mimeType !== "image/png" &&
          entry.mimeType !== "image/svg+xml") ||
        typeof entry.byteLength !== "number" ||
        typeof entry.localPath !== "string" ||
        typeof entry.publicUrl !== "string" ||
        entry.origin !== "flock-upload" ||
        typeof entry.uploadedAt !== "string" ||
        typeof entry.contentHash !== "string" ||
        !Array.isArray(entry.sectionIds)
      ) {
        continue;
      }
      assets.push({
        id: entry.id,
        filename: entry.filename,
        mimeType: entry.mimeType,
        byteLength: entry.byteLength,
        width: typeof entry.width === "number" ? entry.width : undefined,
        height: typeof entry.height === "number" ? entry.height : undefined,
        localPath: entry.localPath,
        publicUrl: entry.publicUrl,
        origin: "flock-upload",
        uploadedAt: entry.uploadedAt,
        contentHash: entry.contentHash,
        sectionIds: entry.sectionIds.filter(
          (sectionId): sectionId is string => typeof sectionId === "string",
        ),
      });
    }
    return { kind: "flock.assetRegistry", version: "1.0.0", assets };
  }

  private async writeAssetRegistry(
    registry: FlockAssetRegistry,
  ): Promise<void> {
    await mkdir(this.flockRoot, { recursive: true });
    await this.atomicWrite(
      path.join(this.flockRoot, "assets.json"),
      `${JSON.stringify(registry, null, 2)}\n`,
    );
  }

  private async scanSections(): Promise<Map<string, SectionRecord>> {
    const files = await findAstroFiles(path.join(this.root, "src"));
    const sections = new Map<string, SectionRecord>();
    for (const absolutePath of files) {
      const source = await readFile(absolutePath, "utf8");
      const id = source.match(SECTION_ID_PATTERN)?.[1];
      if (!id || !SECTION_ROLE_PATTERN.test(source)) continue;
      if (sections.has(id))
        throw new Error(`Duplicate Stitch section ID: ${id}`);
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
    if (!section)
      throw new FlockProjectError(
        `Unknown Stitch section: ${sectionId}`,
        404,
        "unknown_section",
      );
    assertInside(this.root, section.absolutePath);
    return section;
  }

  private async withMutation<T>(
    sectionId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.mutationTails.get(sectionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.mutationTails.set(sectionId, current);
    try {
      return await current;
    } finally {
      if (this.mutationTails.get(sectionId) === current)
        this.mutationTails.delete(sectionId);
    }
  }

  async summary(): Promise<FlockProjectSummary> {
    const run = await this.run();
    const contractPath = this.artifactPath(run, "contract")!;
    const visualIndexPath = this.artifactPath(run, "visuals", false);
    const [contract, visualIndex, sections, baseline] = await Promise.all([
      readJson<JsonObject>(contractPath),
      visualIndexPath ? this.optionalJson(visualIndexPath) : undefined,
      this.scanSections(),
      this.baseline(),
    ]);
    const baselineHashes = new Map(
      baseline.sections.map((section) => [section.id, section.hash]),
    );

    const summaries: FlockSectionSummary[] = [];
    for (const section of sections.values()) {
      const currentHash = sha256(section.source);
      const originalHash = baselineHashes.get(section.id);
      const contractEntry = findSectionContract(contract, section.id);
      const visual = visualFor(visualIndex, section.id);
      const reviewItems = sectionReviewItems(
        contract,
        run,
        section.id,
        section.relativePath,
      );
      summaries.push({
        id: section.id,
        label:
          typeof contractEntry.section?.label === "string"
            ? contractEntry.section.label
            : undefined,
        intent:
          typeof contractEntry.section?.intent === "string"
            ? contractEntry.section.intent
            : undefined,
        route:
          typeof contractEntry.page?.route === "string"
            ? contractEntry.page.route
            : undefined,
        file: section.relativePath,
        modified: Boolean(originalHash && originalHash !== currentHash),
        originalHash,
        currentHash,
        hasVisual: Boolean(visual?.path),
        hasFailure: reviewItems.length > 0,
        canRevert: this.previousSource.has(section.id),
      });
    }
    summaries.sort((a, b) =>
      a.id.localeCompare(b.id, undefined, { numeric: true }),
    );

    const contractProject = isObject(contract.project) ? contract.project : {};
    const codegen = isObject(run.codegen) ? run.codegen : {};
    const validation = isObject(codegen.validation) ? codegen.validation : {};
    const publication = isObject(run.publication) ? run.publication : {};
    return {
      kind: "flock.projectSummary",
      version: "1.0.0",
      projectId: run.projectId ?? "unknown",
      projectName:
        typeof contractProject.name === "string"
          ? contractProject.name
          : undefined,
      stitchRunStatus: typeof run.status === "string" ? run.status : undefined,
      projectionStatus:
        typeof codegen.status === "string"
          ? codegen.status
          : typeof validation.status === "string"
            ? validation.status
            : undefined,
      publicationStatus:
        typeof publication.status === "string"
          ? publication.status
          : undefined,
      sections: summaries,
    };
  }

  async packet(sectionId: string): Promise<FlockSectionPacket> {
    const run = await this.run();
    const [contract, designContract, registry] = await Promise.all([
      this.contract(run),
      this.designContract(run),
      this.assetRegistry(),
    ]);
    const record = await this.sectionRecord(sectionId);
    const { page, section } = findSectionContract(contract, sectionId);
    const sourceLedger = isObject(contract.sourceLedger)
      ? contract.sourceLedger
      : {};
    const facts = sectionScopedItems(sourceLedger.items, sectionId);
    const occurrences = sectionScopedItems(sourceLedger.occurrences, sectionId);
    const recipes = sectionDesignStyles(designContract, section, sectionId);
    const stagedAssets = [
      ...(this.stagedAssets.get(sectionId)?.values() ?? []),
    ].map((entry) => entry.asset);
    const registeredAssets = registry.assets
      .filter((asset) => asset.sectionIds.includes(sectionId))
      .map(({ sectionIds: _sectionIds, ...asset }) => asset);
    const uploadedAssets = [
      ...new Map(
        [...registeredAssets, ...stagedAssets].map((asset) => [asset.id, asset]),
      ).values(),
    ];
    const reviewItems = sectionReviewItems(
      contract,
      run,
      sectionId,
      record.relativePath,
    );
    const tokenRoot = designTokenRoot(designContract);

    return {
      kind: "flock.sectionPacket",
      version: "1.0.0",
      section: {
        id: sectionId,
        label: typeof section?.label === "string" ? section.label : undefined,
        intent:
          typeof section?.intent === "string" ? section.intent : undefined,
        route: typeof page?.route === "string" ? page.route : undefined,
        file: record.relativePath,
        source: record.source,
        baseHash: sha256(record.source),
      },
      visibleContent: unique([
        ...sourceVisibleContent(record.source),
        ...compactVisibleContent(section, facts, occurrences),
      ]).slice(0, 160),
      links: unique([
        ...sourceAttributes(record.source, ["href", "action"]),
        ...compactLinks(section, facts, occurrences),
      ]).slice(0, 100),
      assets: unique([
        ...sourceAttributes(record.source, ["src", "poster"]),
        ...compactAssets(section, facts, occurrences),
        ...uploadedAssets.map((asset) => asset.publicUrl),
      ]).slice(0, 100),
      uploadedAssets,
      contract: section,
      facts,
      occurrences,
      recipes,
      tokens:
        referencedTokens(tokenRoot, [record.source, section, recipes]) ??
        tokenRoot,
      reviewItems,
      failure: reviewItems.length ? { issues: reviewItems } : undefined,
      constraints: {
        framework: "astro",
        styling: "tailwind",
        replacementUnit: "complete-section-file",
        requiredSectionId: sectionId,
        requiredRootAttribute: 'data-stitch-role="section"',
        preserveContentByDefault: true,
        preserveLinksByDefault: true,
        preserveAssetsByDefault: true,
        noExternalScripts: true,
      },
    };
  }

  async visual(
    sectionId: string,
  ): Promise<{ path: string; mimeType: string } | undefined> {
    const run = await this.run();
    const visualIndexPath = this.artifactPath(run, "visuals", false);
    if (!visualIndexPath) return undefined;
    const visualIndex = await this.optionalJson(visualIndexPath);
    const visual = visualFor(visualIndex, sectionId);
    if (!visual || typeof visual.path !== "string") return undefined;
    const absolutePath = path.resolve(this.root, visual.path);
    assertInside(this.root, absolutePath);
    if (!(await exists(absolutePath))) return undefined;
    return {
      path: absolutePath,
      mimeType:
        typeof visual.mimeType === "string" ? visual.mimeType : "image/jpeg",
    };
  }

  async previewSection(
    sectionId: string,
    input: FlockPreviewInput,
  ): Promise<FlockSectionSummary> {
    return this.withMutation(sectionId, async () => {
      const current = await this.sectionRecord(sectionId);
      if (sha256(current.source) !== input.baseHash) {
        throw new FlockProjectError(
          "This section changed while local AI was working. Generate again from the current version.",
          409,
          "stale_source",
        );
      }
      const source = input.source.trim();
      const failures = await candidateFailures(
        this.root,
        current,
        source,
        input.intent,
      );
      if (failures.length) {
        throw new FlockProjectError(
          "The candidate did not pass Flock checks.",
          422,
          "candidate_invalid",
          failures,
        );
      }

      if (!this.previousSource.has(sectionId))
        this.previousSource.set(sectionId, current.source);
      await this.atomicWrite(current.absolutePath, `${source}\n`);
      return this.getSectionSummary(sectionId);
    });
  }

  async stageAsset(
    sectionId: string,
    input: FlockAssetUploadInput,
  ): Promise<FlockAsset> {
    return this.withMutation(sectionId, async () => {
      await this.sectionRecord(sectionId);
      const mimeType =
        input.mimeType === "image/png" || input.mimeType === "image/svg+xml"
          ? input.mimeType
          : undefined;
      if (!mimeType)
        throw new FlockProjectError(
          "Only PNG and SVG assets are supported.",
          415,
          "unsupported_asset_type",
        );

      const decoded = decodeBase64Asset(input.dataBase64);
      const processed =
        mimeType === "image/png"
          ? { buffer: decoded, ...pngDimensions(decoded) }
          : sanitizeSvg(decoded);
      const contentHash = sha256(processed.buffer);
      const safeFilename = safeAssetFilename(input.filename, mimeType);
      const storedFilename = `${assetHashHex(contentHash).slice(0, 16)}-${safeFilename}`;
      const localPath = normalizeRelative(
        path.join("public", "flock-assets", storedFilename),
      );
      const publicUrl = `/flock-assets/${storedFilename}`;
      const absolutePath = path.resolve(this.root, localPath);
      assertInside(this.root, absolutePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      const created = !(await exists(absolutePath));
      if (created) await this.atomicWriteBuffer(absolutePath, processed.buffer);

      const id = `flock_asset_${createHash("sha256").update(`${contentHash}:${storedFilename}`).digest("hex").slice(0, 16)}`;
      const asset: FlockAsset = {
        id,
        filename: safeFilename,
        mimeType,
        byteLength: processed.buffer.byteLength,
        width: processed.width,
        height: processed.height,
        localPath,
        publicUrl,
        origin: "flock-upload",
        uploadedAt: new Date().toISOString(),
        contentHash,
      };
      const sectionAssets =
        this.stagedAssets.get(sectionId) ?? new Map<string, StagedAsset>();
      const previouslyStaged = sectionAssets.get(id);
      sectionAssets.set(id, { asset, absolutePath, created: previouslyStaged?.created ?? created });
      this.stagedAssets.set(sectionId, sectionAssets);
      return asset;
    });
  }

  async discardStagedAssets(sectionId: string): Promise<void> {
    return this.withMutation(sectionId, async () => {
      await this.sectionRecord(sectionId);
      if (this.previousSource.has(sectionId)) {
        throw new FlockProjectError(
          "Revert the active preview before discarding its assets.",
          409,
          "preview_active",
        );
      }
      await this.cleanupStagedAssets(sectionId, new Set());
    });
  }

  async keepSection(sectionId: string): Promise<FlockSectionSummary> {
    return this.withMutation(sectionId, async () => {
      const current = await this.sectionRecord(sectionId);
      await this.finalizeStagedAssets(sectionId, current.source);
      this.previousSource.delete(sectionId);
      return this.getSectionSummary(sectionId);
    });
  }

  async revertSection(sectionId: string): Promise<FlockSectionSummary> {
    return this.withMutation(sectionId, async () => {
      const previous = this.previousSource.get(sectionId);
      if (previous === undefined) {
        throw new FlockProjectError(
          "No in-session preview is available for this section.",
          409,
          "nothing_to_revert",
        );
      }
      const current = await this.sectionRecord(sectionId);
      await this.atomicWrite(current.absolutePath, previous);
      await this.cleanupStagedAssets(sectionId, new Set());
      this.previousSource.delete(sectionId);
      return this.getSectionSummary(sectionId);
    });
  }

  private async finalizeStagedAssets(
    sectionId: string,
    source: string,
  ): Promise<void> {
    const staged = [...(this.stagedAssets.get(sectionId)?.values() ?? [])];
    const usedStaged = staged.filter(({ asset }) =>
      source.includes(asset.publicUrl),
    );
    const registry = await this.assetRegistry();
    const assetsById = new Map(
      registry.assets.map((asset) => [asset.id, asset] as const),
    );
    for (const { asset } of usedStaged) {
      const existing = assetsById.get(asset.id);
      assetsById.set(asset.id, {
        ...existing,
        ...asset,
        sectionIds: unique([...(existing?.sectionIds ?? []), sectionId]),
      });
    }

    const sections = await this.scanSections();
    const retained: FlockAssetRegistryEntry[] = [];
    for (const asset of assetsById.values()) {
      const sectionIds = [...sections.values()]
        .filter((section) => section.source.includes(asset.publicUrl))
        .map((section) => section.id);
      if (sectionIds.length) {
        retained.push({ ...asset, sectionIds });
        continue;
      }
      if (asset.localPath.startsWith("public/flock-assets/")) {
        const absolutePath = path.resolve(this.root, asset.localPath);
        assertInside(this.root, absolutePath);
        await unlink(absolutePath).catch(() => undefined);
      }
    }
    retained.sort((a, b) => a.id.localeCompare(b.id));
    await this.writeAssetRegistry({
      kind: "flock.assetRegistry",
      version: "1.0.0",
      assets: retained,
    });
    await this.cleanupStagedAssets(
      sectionId,
      new Set(usedStaged.map(({ asset }) => asset.id)),
    );
  }

  private async cleanupStagedAssets(
    sectionId: string,
    retainedIds: Set<string>,
  ): Promise<void> {
    const staged = this.stagedAssets.get(sectionId);
    if (!staged) return;
    for (const [assetId, entry] of staged) {
      if (retainedIds.has(assetId)) continue;
      if (
        entry.created &&
        !(await this.assetReferenced(entry.asset.publicUrl))
      ) {
        await unlink(entry.absolutePath).catch(() => undefined);
      }
    }
    this.stagedAssets.delete(sectionId);
  }

  private async assetReferenced(publicUrl: string): Promise<boolean> {
    const sections = await this.scanSections();
    return [...sections.values()].some((section) =>
      section.source.includes(publicUrl),
    );
  }

  private async atomicWrite(
    absolutePath: string,
    source: string,
  ): Promise<void> {
    const temporary = `${absolutePath}.flock-${process.pid}-${Date.now()}.tmp`;
    assertInside(this.root, temporary);
    try {
      await writeFile(temporary, source, "utf8");
      await rename(temporary, absolutePath);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private async atomicWriteBuffer(
    absolutePath: string,
    buffer: Buffer,
  ): Promise<void> {
    const temporary = `${absolutePath}.flock-${process.pid}-${Date.now()}.tmp`;
    assertInside(this.root, temporary);
    try {
      await writeFile(temporary, buffer);
      await rename(temporary, absolutePath);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private async getSectionSummary(
    sectionId: string,
  ): Promise<FlockSectionSummary> {
    const section = (await this.summary()).sections.find(
      (item) => item.id === sectionId,
    );
    if (!section)
      throw new FlockProjectError(
        `Unknown Stitch section: ${sectionId}`,
        404,
        "unknown_section",
      );
    return section;
  }
}
