export type JsonObject = Record<string, unknown>;

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
}

export interface FlockProjectSummary {
  kind: 'flock.projectSummary';
  version: '0.1.0';
  projectId: string;
  projectName?: string;
  sourceUrl?: string;
  contractVersion?: string;
  contractHash?: string;
  runHash?: string;
  stitchRunStatus?: string;
  projectionStatus?: string;
  publicationStatus?: string;
  generatorAvailable: boolean;
  sections: FlockSectionSummary[];
}

export interface FlockVisualContext {
  path: string;
  mimeType?: string;
  width?: number;
  height?: number;
}

export interface FlockSectionContext {
  kind: 'flock.sectionContext';
  version: '0.1.0';
  project: {
    id: string;
    name?: string;
    sourceUrl?: string;
    contractVersion?: string;
    contractHash?: string;
    runHash?: string;
    framework?: string;
    rendererTarget?: string;
  };
  page?: JsonObject;
  section: {
    id: string;
    label?: string;
    intent?: string;
    route?: string;
    file: string;
    source: string;
    modified: boolean;
    contract?: JsonObject;
  };
  facts: unknown[];
  occurrences: unknown[];
  recipes: unknown[];
  tokens?: unknown;
  reviewItems: unknown[];
  failure?: unknown;
  visual?: FlockVisualContext;
  constraints: {
    framework: 'astro';
    styling: 'tailwind';
    replacementUnit: 'complete-section-file';
    requiredSectionId: string;
    requiredRootAttribute: 'data-stitch-role="section"';
    preserveProjectFilesOutsideSection: true;
  };
}

export interface GenerateSectionInput {
  instruction: string;
  route: string;
  context: FlockSectionContext;
}

export type GenerateSection = (input: GenerateSectionInput) => Promise<string>;

export interface FlockOptions {
  /**
   * Reserved seam for Flock's built-in AI. If absent, the capsule still installs,
   * inspects sections, and reports that generation is not available.
   */
  generateSection?: GenerateSection;
  /** Project root override. Astro's root is used by default. */
  root?: string;
}
