export type JsonObject = Record<string, unknown>;

export interface FlockAsset {
  id: string;
  filename: string;
  mimeType: "image/png" | "image/svg+xml";
  byteLength: number;
  width?: number;
  height?: number;
  localPath: string;
  publicUrl: string;
  origin: "flock-upload";
  uploadedAt: string;
  contentHash: string;
}

export interface FlockEditIntent {
  goals: string[];
  mayChangeContent: boolean;
  mayChangeLinks: boolean;
  mayChangeAssets: boolean;
  mayChangeStructure: boolean;
}

export interface FlockSectionSummary {
  id: string;
  label?: string;
  intent?: string;
  route?: string;
  file: string;
  modified: boolean;
  originalHash?: string;
  currentHash: string;
  hasVisual: boolean;
  hasFailure: boolean;
  canRevert: boolean;
}

export type FlockInferenceProvider = "local" | "openai";

export interface FlockProjectSummary {
  kind: "flock.projectSummary";
  version: "1.0.0";
  projectId: string;
  projectName?: string;
  stitchRunStatus?: string;
  projectionStatus?: string;
  publicationStatus?: string;
  sections: FlockSectionSummary[];
  inference?: {
    openaiAvailable: boolean;
    openaiModel?: string;
  };
}

export interface FlockSectionPacket {
  kind: "flock.sectionPacket";
  version: "1.0.0";
  section: {
    id: string;
    label?: string;
    intent?: string;
    route?: string;
    file: string;
    source: string;
    baseHash: string;
  };
  visibleContent: string[];
  links: string[];
  assets: string[];
  uploadedAssets: FlockAsset[];
  contract?: JsonObject;
  facts: unknown[];
  occurrences: unknown[];
  recipes: unknown[];
  tokens?: JsonObject;
  reviewItems: unknown[];
  failure?: unknown;
  constraints: {
    framework: "astro";
    styling: "tailwind";
    replacementUnit: "complete-section-file";
    requiredSectionId: string;
    requiredRootAttribute: 'data-stitch-role="section"';
    preserveContentByDefault: true;
    preserveLinksByDefault: true;
    preserveAssetsByDefault: true;
    noExternalScripts: true;
  };
}

export interface FlockPreviewInput {
  baseHash: string;
  source: string;
  intent: FlockEditIntent;
}

export interface FlockOptions {
  /** Project root override. Astro's root is used by default. */
  root?: string;
  /** Optional connected inference. The API key defaults to OPENAI_API_KEY. */
  openai?: {
    apiKey?: string;
    model?: string;
  };
}
