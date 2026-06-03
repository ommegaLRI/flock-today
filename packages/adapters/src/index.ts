import type {
  BuildProfile,
  CampaignPageSpec,
  ChangePin,
  DeployHandoffPlan,
  DeploymentManifest,
  DeployCommand,
  DeployFile,
  DeployPackage,
  DeployProvider,
  DeployReadinessReport,
  DeployStep,
  DeployTarget,
  DeployWarning,
  ExportPlan,
  ExportArtifact,
  ExportFile,
  ExportProfile,
  ExportPrivacySummary,
  ExportReceipt,
  ExportValidationResult,
  ArtifactFormat,
  ArtifactIntegrity,
  MaterializationResult,
  MaterializationWarning,
  MaterializedArtifact,
  MaterializedArtifactFile,
  PublicExposureAudit,
  FeedbackBundle,
  FeedbackHandoff,
  FeedbackTransportConfig,
  FeedbackTransportKind,
  GeneratedFile,
  GeneratedFileManifestItem,
  GeneratedSiteBundle,
  MigrationBootstrap,
  BootstrapImportPlan,
  BootstrapDownloadHandoff,
  BootstrapIngestionResult,
  MigrationRefinement,
  PublishWarning,
  SpecOperation,
  StructuredInferenceRequest,
  StructuredInferenceResult,
  StitchProject,
  NextAction,
} from "@stitch/contract";

export type InferenceRequest = {
  task: "respond" | "structured" | "vision" | "embed";
  input: string;
  schemaName?: string;
  metadata?: Record<string, unknown>;
};

export type InferenceResponse = {
  output: string;
  provider: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
};

export type InferenceProvider = {
  id: string;
  respond(request: InferenceRequest): Promise<InferenceResponse>;
  structured<T = unknown>(request: StructuredInferenceRequest): Promise<StructuredInferenceResult<T>>;
};

export function createEchoInferenceProvider(): InferenceProvider {
  return createMockInferenceProvider("echo");
}

export function createMockInferenceProvider(id = "mock"): InferenceProvider {
  return {
    id,
    async respond(request: InferenceRequest) {
      return {
        provider: id,
        output: request.input,
        usage: {
          inputTokens: estimateTokens(request.input),
          outputTokens: estimateTokens(request.input),
        },
      };
    },
    async structured<T = unknown>(request: StructuredInferenceRequest) {
      const result = createMockStructuredResult(id, request);
      return result as StructuredInferenceResult<T>;
    },
  };
}

export function createStitchInferenceProvider(endpoint: string, apiKey?: string): InferenceProvider {
  const base = endpoint.replace(/\/$/, "");
  return {
    id: "stitch",
    async respond(request: InferenceRequest) {
      const response = await fetch(`${base}/v1/respond`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error(`Stitch inference failed: ${response.status}`);
      return (await response.json()) as InferenceResponse;
    },
    async structured<T = unknown>(request: StructuredInferenceRequest) {
      const response = await fetch(`${base}/v1/structured`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error(`Stitch structured inference failed: ${response.status}`);
      return (await response.json()) as StructuredInferenceResult<T>;
    },
  };
}

export function createInferenceProvider(options: { provider?: "mock" | "stitch"; endpoint?: string; apiKey?: string } = {}): InferenceProvider {
  if (options.provider === "stitch") {
    if (!options.endpoint) throw new Error("createInferenceProvider({ provider: 'stitch' }) requires endpoint");
    return createStitchInferenceProvider(options.endpoint, options.apiKey);
  }
  return createMockInferenceProvider();
}

function createMockStructuredResult(provider: string, request: StructuredInferenceRequest): StructuredInferenceResult<unknown> {
  const input = isRecord(request.input) ? request.input : {};
  const spec = isCampaignSpec(input.spec) ? input.spec : isCampaignSpec(input.baseSpec) ? input.baseSpec : undefined;

  if (request.task === "refineMigration" || request.schemaName === "MigrationRefinement") {
    const operations = spec ? createMockMigrationOperations(spec) : [];
    const output: MigrationRefinement = {
      summary: operations.length > 0 ? "Mock refinement tightened the hero promise and CTA copy using contract-safe operations." : "Mock refinement had no safe spec target.",
      operations,
      confidence: operations.length > 0 ? 0.72 : 0.35,
      preserved: ["brand tokens", "form destinations", "analytics metadata", "section order"],
      warnings: operations.length > 0 ? [] : ["No CampaignPageSpec was provided to the mock refinement task."],
    };
    return {
      task: request.task,
      schemaName: request.schemaName,
      provider,
      output,
      operations,
      warnings: output.warnings,
      usage: usageForRequest(request),
      attestation: createPlaceholderAttestation(request),
    };
  }

  if (request.task === "suggestSpecPatch" || request.schemaName === "SpecOperations") {
    const operations = spec ? createMockMigrationOperations(spec).slice(0, 1) : [];
    return {
      task: request.task,
      schemaName: request.schemaName,
      provider,
      output: { operations },
      operations,
      warnings: operations.length > 0 ? [] : ["No safe mock operation was generated."],
      usage: usageForRequest(request),
      attestation: createPlaceholderAttestation(request),
    };
  }

  if (request.task === "createCampaignVariant" || request.schemaName === "CampaignVariant") {
    const base = isCampaignSpec(input.baseSpec) ? input.baseSpec : spec;
    const audience = typeof input.audience === "string" ? input.audience : "specific campaign audience";
    const operations = base ? createMockVariantOperations(base, audience) : [];
    return {
      task: request.task,
      schemaName: request.schemaName,
      provider,
      output: { operations, summary: `Mock campaign variant adapted for ${audience}.` },
      operations,
      warnings: base ? [] : ["No baseSpec was provided to createCampaignVariant."],
      usage: usageForRequest(request),
      attestation: createPlaceholderAttestation(request),
    };
  }

  return {
    task: request.task,
    schemaName: request.schemaName,
    provider,
    output: { message: "Mock provider returned a generic structured response." },
    operations: [],
    warnings: [],
    usage: usageForRequest(request),
    attestation: createPlaceholderAttestation(request),
  };
}

function createMockMigrationOperations(spec: CampaignPageSpec): SpecOperation[] {
  const hero = spec.sections.find((section) => section.type === "Hero") ?? spec.sections[0];
  if (!hero) return [];
  const operations: SpecOperation[] = [];
  if (hero.heading && !/portable|campaign|landing/i.test(hero.heading)) {
    operations.push({
      kind: "editSectionSlot",
      source: "inference",
      sectionId: hero.id,
      slot: "heading",
      value: `${hero.heading} — made campaign-ready`,
      reason: "Mock refinement makes the migrated hero promise more campaign-specific.",
    });
  }
  if (hero.primaryCta) {
    operations.push({
      kind: "editCtaLabel",
      source: "inference",
      sectionId: hero.id,
      cta: "primary",
      label: normalizeCtaLabel(hero.primaryCta.label),
      reason: "Mock refinement keeps CTA intent but normalizes the action label.",
    });
  }
  return operations;
}

function createMockVariantOperations(spec: CampaignPageSpec, audience: string): SpecOperation[] {
  const hero = spec.sections.find((section) => section.type === "Hero") ?? spec.sections[0];
  const finalCta = spec.sections.find((section) => section.type === "FinalCTA");
  const operations: SpecOperation[] = [
    {
      kind: "editContentStrategy",
      source: "inference",
      path: "/contentStrategy/audience/segment",
      value: audience,
      reason: "Campaign variant audience was provided by the owner.",
    },
  ];
  if (hero) {
    operations.push({
      kind: "editSectionSlot",
      source: "inference",
      sectionId: hero.id,
      slot: "heading",
      value: `A campaign page built for ${audience}`,
      reason: "Mock variant adapts the hero headline to the requested audience.",
    });
  }
  if (finalCta?.primaryCta) {
    operations.push({
      kind: "editCtaLabel",
      source: "inference",
      sectionId: finalCta.id,
      cta: "primary",
      label: "Book a free audit",
      reason: "Mock variant normalizes the final CTA to a lead-generation action.",
    });
  }
  return operations;
}

function normalizeCtaLabel(label: string): string {
  if (/book|audit|demo|schedule/i.test(label)) return label;
  if (/learn/i.test(label)) return "Learn more";
  return "Book a free audit";
}

function createPlaceholderAttestation(request: StructuredInferenceRequest): NonNullable<StructuredInferenceResult["attestation"]> {
  const requestHash = `mock-${hash(JSON.stringify(request).slice(0, 2000))}`;
  return { requestHash, responseHash: `${requestHash}-response`, policy: "contract-constrained-inference-v0" };
}

function usageForRequest(request: StructuredInferenceRequest): NonNullable<StructuredInferenceResult["usage"]> {
  const serialized = JSON.stringify(request.input);
  return { inputTokens: estimateTokens(serialized), outputTokens: Math.max(12, Math.ceil(estimateTokens(serialized) / 3)) };
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function hash(value: string): string {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = (result * 31 + value.charCodeAt(index)) >>> 0;
  return result.toString(16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCampaignSpec(value: unknown): value is CampaignPageSpec {
  return isRecord(value) && typeof value.id === "string" && Array.isArray(value.sections) && isRecord(value.brand);
}

export type DeployRecommendation = {
  target: DeployTarget;
  reason: string[];
  warnings: string[];
  alternatives: DeployTarget[];
};

export function recommendDeployTarget(manifest: DeploymentManifest, preference?: DeployTarget): DeployRecommendation {
  if (preference) {
    return {
      target: preference,
      reason: ["User preference was provided."],
      warnings: [],
      alternatives: (["cloudflare-pages", "netlify", "github-pages", "vercel", "zip"] as DeployTarget[]).filter((item) => item !== preference),
    };
  }

  const isStatic = manifest.type === "static-campaign-site";
  return {
    target: isStatic ? "cloudflare-pages" : "netlify",
    reason: isStatic
      ? ["Static campaign site", "Good default for cheap/free static hosting", "User owns the deployment target"]
      : ["Deployment needs are not clearly static-only"],
    warnings: manifest.redirects.length > 0 ? ["Verify redirect support on selected provider."] : [],
    alternatives: ["netlify", "github-pages", "vercel", "zip"],
  };
}

export function recommendDeployTargets(bundle: GeneratedSiteBundle): DeployRecommendation[] {
  const primary = recommendDeployTarget(bundle.deployManifest);
  const allTargets: DeployTarget[] = ["cloudflare-pages", "netlify", "vercel", "github-pages", "zip"];
  return [primary, ...allTargets.filter((target) => target !== primary.target).map((target) => recommendDeployTarget(bundle.deployManifest, target))];
}

export function createFileManifest(files: GeneratedFile[]): GeneratedFileManifestItem[] {
  return files.map((file) => ({
    path: file.path,
    bytes: new TextEncoder().encode(file.contents).length,
    role: file.role ?? inferRole(file.path),
    public: file.public ?? inferPublic(file.path),
  }));
}

export function createFileManifestExportPlan(bundle: GeneratedSiteBundle): ExportPlan {
  return createExportPlan(bundle, "file-manifest");
}

export function createZipExportPlan(bundle: GeneratedSiteBundle): ExportPlan {
  return createExportPlan(bundle, "zip-plan");
}

export function createExportPlan(bundle: GeneratedSiteBundle, kind: ExportPlan["kind"] = "file-manifest"): ExportPlan {
  return {
    id: `export-${bundle.spec.id}-${bundle.buildProfile}`,
    kind,
    profile: bundle.buildProfile,
    files: bundle.files,
    manifest: bundle.manifest.length > 0 ? bundle.manifest : createFileManifest(bundle.files),
    instructions: [...buildExportInstructions(bundle.buildProfile, kind), ...buildStateExportInstructions(bundle)],
  };
}

export function createDeployHandoffPlan(bundle: GeneratedSiteBundle, target: DeployTarget): DeployHandoffPlan {
  const configFiles = createTargetConfigFiles(bundle, target);
  return {
    target,
    profile: bundle.buildProfile,
    summary: createHandoffSummary(bundle.buildProfile, target),
    buildCommand: bundle.deployManifest.buildCommand,
    outputDir: bundle.deployManifest.outputDir,
    configFiles,
    instructions: createTargetInstructions(target, bundle.buildProfile),
    warnings: [...bundle.warnings, ...createTargetWarnings(target, bundle.buildProfile), ...createStatePrivacyWarnings(bundle)],
  };
}

export function createProviderHandoffExportPlan(bundle: GeneratedSiteBundle, target: DeployTarget): ExportPlan {
  const handoff = createDeployHandoffPlan(bundle, target);
  return {
    ...createExportPlan(bundle, "provider-handoff"),
    handoff,
    instructions: [...handoff.instructions, "This is a provider-ready handoff plan only; no provider API calls are made in Phase 4."],
  };
}

function buildExportInstructions(profile: BuildProfile, kind: ExportPlan["kind"]): string[] {
  const instructions = [
    "This is a user-owned export plan; Stitch does not host the generated site.",
    "Write each file to the listed path in the target project.",
    "Run the generated build command from stitch/deploy-manifest.json before publishing.",
  ];
  if (profile === "owner") instructions.push("Owner profile includes /_stitch workbench assets; do not publish it as a public production build.");
  if (profile === "review") instructions.push("Review profile includes comment-only review runtime for staging/client feedback.");
  if (kind === "zip-plan") instructions.push("Create a zip archive preserving relative paths. This package intentionally avoids a zip dependency for now.");
  return instructions;
}

function createTargetConfigFiles(bundle: GeneratedSiteBundle, target: DeployTarget): GeneratedFile[] {
  if (target === "netlify") {
    return [
      {
        path: "netlify.toml",
        role: "config",
        public: false,
        contents: `[build]\n  command = ${JSON.stringify(bundle.deployManifest.buildCommand)}\n  publish = ${JSON.stringify(bundle.deployManifest.outputDir)}\n`,
      },
    ];
  }
  if (target === "vercel") {
    return [
      {
        path: "vercel.json",
        role: "config",
        public: false,
        contents: JSON.stringify({ buildCommand: bundle.deployManifest.buildCommand, outputDirectory: bundle.deployManifest.outputDir }, null, 2) + "\n",
      },
    ];
  }
  if (target === "github-pages") {
    return [
      {
        path: ".github/workflows/pages.yml",
        role: "config",
        public: false,
        contents: `name: Deploy static site\non: { workflow_dispatch: {} }\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: ${bundle.deployManifest.buildCommand}\n      - run: echo "Upload ${bundle.deployManifest.outputDir} to GitHub Pages in a later deploy phase."\n`,
      },
    ];
  }
  if (target === "cloudflare-pages") {
    return [
      {
        path: "stitch/cloudflare-pages.handoff.json",
        role: "manifest",
        public: false,
        contents: JSON.stringify({ buildCommand: bundle.deployManifest.buildCommand, outputDir: bundle.deployManifest.outputDir, note: "Connect this repo to Cloudflare Pages or use Direct Upload later." }, null, 2) + "\n",
      },
    ];
  }
  return [];
}

function createHandoffSummary(profile: BuildProfile, target: DeployTarget): string {
  return `${target} handoff for a ${profile} Stitch static campaign bundle.`;
}

function createTargetInstructions(target: DeployTarget, profile: BuildProfile): string[] {
  const common = ["Keep the repo and deployment in the user's account.", "Build the project, then deploy the output directory."];
  const profileNote = profile === "production" ? "Production profile excludes owner workbench assets." : profile === "review" ? "Review profile is intended for staging/client comments." : "Owner profile is intended for private/local owner workflows.";
  if (target === "cloudflare-pages") return [profileNote, ...common, "Create or connect a Cloudflare Pages project with the listed build command/output directory."];
  if (target === "netlify") return [profileNote, ...common, "Use netlify.toml or the Netlify UI with the listed build settings."];
  if (target === "vercel") return [profileNote, ...common, "Use vercel.json or the Vercel project settings with the listed build settings."];
  if (target === "github-pages") return [profileNote, "Use a static-only output and GitHub Actions; dynamic/serverless review storage is not included."];
  return [profileNote, "Export the files as a zip and upload/deploy manually."];
}

function createTargetWarnings(target: DeployTarget, profile: BuildProfile): PublishWarning[] {
  const warnings: PublishWarning[] = [{ code: "manual-domain-step", severity: "info", message: "Custom domain and DNS are handled in the user's hosting account." }];
  if (target === "github-pages") warnings.push({ code: "static-only-target", severity: "warning", message: "GitHub Pages is static-only; no serverless feedback inbox is included." });
  if (profile === "owner" && target !== "zip" && target !== "local") warnings.push({ code: "owner-capsule-included", severity: "warning", message: "Owner capsule should not be deployed publicly without access controls." });
  return warnings;
}

export function createStateExportSummary(bundle: GeneratedSiteBundle): { stateFiles: string[]; provenanceRecords: number; sourceStateVersion: number | undefined } {
  return {
    stateFiles: bundle.files.filter((file) => /stitch\/(project\.state|events|provenance)\.json$/.test(file.path)).map((file) => file.path),
    provenanceRecords: bundle.provenance?.length ?? 0,
    sourceStateVersion: bundle.sourceStateVersion,
  };
}

function buildStateExportInstructions(bundle: GeneratedSiteBundle): string[] {
  const summary = createStateExportSummary(bundle);
  if (summary.stateFiles.length === 0) return ["No portable project state files are included in this bundle yet."];
  return [
    `Project state files included: ${summary.stateFiles.join(", ")}.`,
    "Treat stitch/project.state.json and stitch/events.json as owner-owned project history, not public marketing content.",
  ];
}

function createStatePrivacyWarnings(bundle: GeneratedSiteBundle): PublishWarning[] {
  const warnings: PublishWarning[] = [];
  const hasStateFiles = bundle.files.some((file) => /stitch\/(project\.state|events|provenance)\.json$/.test(file.path));
  if (hasStateFiles && bundle.buildProfile === "production") {
    warnings.push({ code: "owner-capsule-included", severity: "info", message: "Production bundle includes private stitch/*.json source files for the user-owned repo; do not expose them as public static assets." });
  }
  if (bundle.buildProfile === "review") {
    warnings.push({ code: "review-runtime-included", severity: "info", message: "Review profile may create local event history in the browser; reviewer comments remain untrusted until owner approval." });
  }
  if (bundle.buildProfile === "owner") {
    warnings.push({ code: "owner-capsule-included", severity: "warning", message: "Owner profile carries project history and workbench assets. Keep this bundle private or access-controlled." });
  }
  return warnings;
}

export type StorageAdapter<T> = {
  id: string;
  read(): Promise<T[]>;
  write(item: T): Promise<void>;
};

export function createMemoryStorageAdapter<T>(id = "memory"): StorageAdapter<T> {
  const items: T[] = [];
  return {
    id,
    async read() {
      return [...items];
    },
    async write(item) {
      items.push(item);
    },
  };
}

export type ReviewCapability = {
  scope: "comment:create";
  expiresAt?: string;
  allowedRoutes?: string[];
};

export type OwnerCapability = {
  scope: "owner";
  canEdit: true;
  canGeneratePatch: true;
  canPublish: true;
};

export function createReviewCapability(options: Omit<ReviewCapability, "scope"> = {}): ReviewCapability {
  return { scope: "comment:create", ...options };
}

export function createOwnerCapability(): OwnerCapability {
  return { scope: "owner", canEdit: true, canGeneratePatch: true, canPublish: true };
}

function inferRole(path: string): GeneratedFileManifestItem["role"] {
  if (path.includes("capsule") || path.includes("_stitch") || path.includes("review-runtime")) return "capsule";
  if (path.endsWith(".css")) return "style";
  if (path.includes("stitch/") && path.endsWith(".json")) return path.includes("manifest") ? "manifest" : "spec";
  if (path.endsWith("package.json") || path.endsWith(".config.js") || path.endsWith(".config.ts") || path.endsWith(".toml") || path.endsWith(".yml")) return "config";
  if (path.startsWith("public/")) return "asset";
  return "source";
}

function inferPublic(path: string): boolean {
  return path === "index.html" || path.startsWith("public/") || path.endsWith(".css");
}

export type FeedbackBundleOptions = {
  siteId: string;
  siteTitle?: string;
  siteUrl?: string;
  route?: string;
  buildProfile?: BuildProfile;
  transport?: FeedbackTransportKind;
  reviewerSessionId?: string;
  exportedBy?: string;
};

export function createFeedbackBundle(pins: ChangePin[], options: FeedbackBundleOptions): FeedbackBundle {
  const createdAt = new Date().toISOString();
  const normalizedPins = pins.map((pin) => ({ ...pin }));
  const checksum = stableTransportHash(JSON.stringify(normalizedPins.map((pin) => pin.id).sort()) + JSON.stringify(options));
  return {
    id: `feedback-${options.siteId}-${checksum.slice(0, 10)}`,
    kind: "stitch-feedback-bundle",
    version: "0.1.0",
    createdAt,
    site: {
      id: options.siteId,
      ...(options.siteTitle ? { title: options.siteTitle } : {}),
      ...(options.siteUrl ? { url: options.siteUrl } : {}),
      ...(options.route ? { route: options.route } : {}),
      ...(options.buildProfile ? { buildProfile: options.buildProfile } : {}),
    },
    source: {
      transport: options.transport ?? "download",
      ...(options.reviewerSessionId ? { reviewerSessionId: options.reviewerSessionId } : {}),
      ...(options.exportedBy ? { exportedBy: options.exportedBy } : {}),
    },
    pins: normalizedPins,
    checksum,
  };
}

export function createDownloadFeedbackHandoff(bundle: FeedbackBundle, fileName = "stitch-feedback.json"): FeedbackHandoff {
  return {
    kind: "download",
    label: "Download feedback JSON",
    bundle: { ...bundle, source: { ...bundle.source, transport: "download" } },
    payload: JSON.stringify({ ...bundle, source: { ...bundle.source, transport: "download" } }, null, 2),
    instructions: [
      `Download ${fileName}.`,
      "Send the file to the site owner or import it in the private /_stitch workbench.",
      "Imported feedback remains untrusted until an owner reviews it.",
    ],
  };
}

export function createMailtoFeedbackHandoff(bundle: FeedbackBundle, options: { to?: string; subject?: string } = {}): FeedbackHandoff {
  const subject = options.subject ?? `Stitch feedback for ${bundle.site.title ?? bundle.site.id}`;
  const payload = JSON.stringify({ ...bundle, source: { ...bundle.source, transport: "mailto" } }, null, 2);
  const body = [
    "Stitch feedback bundle:",
    "",
    payload,
    "",
    "Import this JSON in the private /_stitch workbench. Feedback cannot edit or publish anything by itself.",
  ].join("\n");
  const href = `mailto:${encodeURIComponent(options.to ?? "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return {
    kind: "mailto",
    label: "Email feedback bundle",
    bundle: { ...bundle, source: { ...bundle.source, transport: "mailto" } },
    href,
    payload,
    instructions: ["Open the email draft.", "Send the feedback payload to the owner.", "The owner imports the bundle into user-owned project state."],
  };
}

export function createPostFeedbackHandoff(bundle: FeedbackBundle, endpoint: string, headers: Record<string, string> = {}): FeedbackHandoff {
  const body = JSON.stringify({ ...bundle, source: { ...bundle.source, transport: "post" } });
  return {
    kind: "post",
    label: "POST feedback to user-owned endpoint",
    bundle: { ...bundle, source: { ...bundle.source, transport: "post" } },
    request: {
      method: "POST",
      url: endpoint,
      headers: { "content-type": "application/json", ...headers },
      body,
    },
    payload: body,
    instructions: [
      "Send this request to a user-owned endpoint such as a Cloudflare Worker, Netlify Function, Vercel Function, or custom inbox.",
      "Stitch does not host the inbox endpoint.",
    ],
  };
}

export function createGitHubIssueFeedbackHandoff(bundle: FeedbackBundle, options: { repositoryUrl: string; labels?: string[] } ): FeedbackHandoff {
  const repo = options.repositoryUrl.replace(/\/$/, "");
  const title = `Website feedback: ${bundle.site.title ?? bundle.site.id}`;
  const body = [
    "## Stitch feedback bundle",
    "",
    "Paste/import this JSON in the private Stitch workbench.",
    "",
    "```json",
    JSON.stringify({ ...bundle, source: { ...bundle.source, transport: "githubIssueUrl" } }, null, 2),
    "```",
  ].join("\n");
  const labels = options.labels && options.labels.length > 0 ? `&labels=${encodeURIComponent(options.labels.join(","))}` : "";
  const href = `${repo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}${labels}`;
  return {
    kind: "githubIssueUrl",
    label: "Open prefilled GitHub issue",
    bundle: { ...bundle, source: { ...bundle.source, transport: "githubIssueUrl" } },
    href,
    payload: body,
    instructions: ["Open the issue URL in the user-owned repository.", "Create the issue.", "The owner can import the feedback bundle from the issue body."],
  };
}

export function createFeedbackHandoff(bundle: FeedbackBundle, config: FeedbackTransportConfig): FeedbackHandoff {
  if (config.kind === "local") {
    return {
      kind: "local",
      label: "Store feedback locally",
      bundle: { ...bundle, source: { ...bundle.source, transport: "local" } },
      payload: JSON.stringify({ ...bundle, source: { ...bundle.source, transport: "local" } }, null, 2),
      instructions: [`Store bundle pins under ${config.localPinsKey}.`, "Local feedback is only visible in the same browser."],
    };
  }
  if (config.kind === "download") return createDownloadFeedbackHandoff(bundle, config.fileName ?? "stitch-feedback.json");
  if (config.kind === "mailto") return createMailtoFeedbackHandoff(bundle, { ...(config.to ? { to: config.to } : {}), ...(config.subject ? { subject: config.subject } : {}) });
  if (config.kind === "post") return createPostFeedbackHandoff(bundle, config.endpoint, config.headers ?? {});
  return createGitHubIssueFeedbackHandoff(bundle, { repositoryUrl: config.repositoryUrl, labels: config.labels ?? ["stitch-feedback"] });
}

export function recommendFeedbackTransports(options: { hasEndpoint?: boolean; repositoryUrl?: string; reviewerIsTechnical?: boolean } = {}): FeedbackTransportConfig[] {
  const transports: FeedbackTransportConfig[] = [
    { kind: "local", localPinsKey: "stitch:pins" },
    { kind: "download", fileName: "stitch-feedback.json" },
    { kind: "mailto" },
  ];
  if (options.repositoryUrl) transports.push({ kind: "githubIssueUrl", repositoryUrl: options.repositoryUrl, labels: ["stitch-feedback"] });
  if (options.hasEndpoint) transports.push({ kind: "post", endpoint: "/api/stitch/pins" });
  if (options.reviewerIsTechnical) return transports;
  return transports.filter((transport) => transport.kind !== "local" || transports.length === 1);
}

function stableTransportHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}



export function createBootstrapSummary(bootstrap: MigrationBootstrap): string {
  const source = bootstrap.source.originalUrl ?? bootstrap.source.sourceKind;
  const sections = bootstrap.page.sections.length;
  const warnings = bootstrap.warnings.length;
  return `Bootstrap ${bootstrap.id} from ${source}: ${sections} section(s), ${warnings} warning(s), recommended profile ${bootstrap.recommendedProfile}.`;
}

export function createBootstrapImportPlan(bootstrap: MigrationBootstrap, ingestion?: BootstrapIngestionResult): BootstrapImportPlan {
  const warnings = [...bootstrap.warnings.map((warning) => warning.message), ...(ingestion?.warnings ?? [])];
  return {
    id: `bootstrap-import-${bootstrap.id}`,
    bootstrapId: bootstrap.id,
    summary: createBootstrapSummary(bootstrap),
    warnings,
    instructions: [
      "Validate the MigrationBootstrap against the open Stitch contract.",
      "Create user-owned StitchProjectState from the bootstrap payload.",
      "Compile the CampaignPageSpec into a profile-aware portable bundle.",
      "From this point forward, edits, feedback, patching, history, and publishing are owned by the generated site/repo.",
    ],
  };
}

export function createBootstrapDownloadHandoff(bootstrap: MigrationBootstrap, fileName = "stitch-migration-bootstrap.json"): BootstrapDownloadHandoff {
  return {
    kind: "migration-bootstrap-download",
    fileName,
    payload: JSON.stringify(bootstrap, null, 2),
    instructions: [
      `Download ${fileName} from the private migration endpoint.`,
      "Import it into the open-source Stitch compiler/capsule system.",
      "The bootstrap is portable; Stitch does not need to host project state after this handoff.",
    ],
  };
}


export function createProjectExportPlan(project: StitchProject): ExportPlan {
  return {
    ...createExportPlan(project.bundle, "file-manifest"),
    id: `project-export-${project.id}`,
    instructions: [
      `Write the project under ${project.rootDir}.`,
      "Canonical files live under stitch/*.json and should be committed with the generated site.",
      "Generated React files can be regenerated from the canonical CampaignPageSpec.",
      ...project.installPlan.steps.map((step) => `${step.title}: ${step.description}`),
    ],
  };
}

export function createProjectZipPlan(project: StitchProject): ExportPlan {
  return {
    ...createZipExportPlan(project.bundle),
    id: `project-zip-${project.id}`,
    instructions: [
      `Create a zip archive rooted at ${project.rootDir}.`,
      "Include canonical stitch/*.json files, generated source files, and capsule assets for the selected profile.",
      "This plan intentionally does not create a binary zip yet; it describes the user-owned artifact boundary.",
    ],
  };
}

export function createProjectNextActions(project: StitchProject): NextAction[] {
  const base = project.installPlan.nextActions;
  const hasWarnings = project.installPlan.warnings.some((warning) => warning.severity !== "info");
  if (!hasWarnings) return base;
  return [
    { id: "review-install-warnings", kind: "inspectWarnings", label: "Review install warnings", description: `${project.installPlan.warnings.length} warning(s) came from migration/install and should be checked before publishing.` },
    ...base.filter((action) => action.id !== "inspect-warnings"),
  ];
}


export type ExportArtifactOptions = {
  profile?: ExportProfile;
  project?: StitchProject;
  downloadFileName?: string;
};

export function createExportArtifact(bundle: GeneratedSiteBundle, options: ExportArtifactOptions = {}): ExportArtifact {
  const profile = options.profile ?? exportProfileForBuild(bundle.buildProfile);
  const files = selectFilesForExportProfile(bundle.files, profile).map((file) => toExportFile(file, profile));
  const manifest = createFileManifest(files);
  const privacy = createExportPrivacySummary(files, profile);
  const validation = validateExportPrivacy(privacy);
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const artifactId = `export-${options.project?.id ?? bundle.spec.id}-${profile}-${stableTransportHash(files.map((file) => `${file.path}:${file.bytes}`).join("|"))}`;
  const receipt = {
    id: `receipt-${artifactId}`,
    artifactId,
    createdAt: new Date().toISOString(),
    profile,
    fileCount: files.length,
    totalBytes,
    summary: `${profile} export with ${files.length} file(s) and ${privacy.privateFileCount} private file(s).`,
  };
  const exposureAudit = createPublicExposureAuditFromFiles(profile, files);
  const warnings = [...validation.warnings, ...exposureAudit.findings.filter((finding) => finding.severity !== "info").map((finding) => finding.message), ...bundle.warnings.map((warning) => warning.message)];
  return {
    id: artifactId,
    kind: "stitch-export-artifact",
    version: "0.1.0",
    ...(options.project ? { projectId: options.project.id, projectName: options.project.name } : {}),
    createdAt: receipt.createdAt,
    profile,
    buildProfile: bundle.buildProfile,
    files,
    manifest,
    privacy,
    validation,
    receipt,
    nextActions: options.project ? createProjectNextActions(options.project) : createArtifactNextActions(profile, validation),
    warnings,
    publicExposureAudit: exposureAudit,
    zipReady: true,
    downloadFileName: options.downloadFileName ?? `${slugifyArtifactName(options.project?.name ?? bundle.spec.slug ?? bundle.spec.id)}-${profile}.zip`,
  };
}

export function createZipReadyArtifact(bundle: GeneratedSiteBundle, options: ExportArtifactOptions = {}): ExportArtifact {
  return createExportArtifact(bundle, options);
}

export function createBrowserDownloadArtifact(bundle: GeneratedSiteBundle, options: ExportArtifactOptions = {}): ExportArtifact {
  return createExportArtifact(bundle, options);
}

export function validateExportArtifact(artifact: ExportArtifact): ExportValidationResult {
  const privacyValidation = validateExportPrivacy(artifact.privacy);
  const hasFiles = artifact.files.length > 0;
  return {
    valid: hasFiles && privacyValidation.valid,
    status: !hasFiles ? "blocked" : privacyValidation.status,
    warnings: [...(!hasFiles ? ["Export artifact has no files."] : []), ...privacyValidation.warnings],
    privacy: artifact.privacy,
  };
}

export function createExportPrivacySummary(files: ExportFile[], profile: ExportProfile): ExportPrivacySummary {
  const paths = files.map((file) => file.path);
  const includesOwnerWorkbench = paths.some((path) => path.includes("_stitch"));
  const includesReviewRuntime = paths.some((path) => path.includes("review-runtime"));
  const includesProjectState = paths.some((path) => path.endsWith("project.state.json"));
  const includesEventHistory = paths.some((path) => path.endsWith("events.json") || path.endsWith("project.state.json"));
  const includesMigrationBootstrap = paths.some((path) => path.endsWith("migration.bootstrap.json"));
  const privateFileCount = files.filter((file) => file.private).length;
  const publicFileCount = files.length - privateFileCount;
  const notes: string[] = [];
  if (profile === "production") notes.push("Production exports are intended to exclude owner workbench and private history.");
  if (profile === "review") notes.push("Review exports may include comment-only runtime but must not include owner patch tools.");
  if (profile === "owner" || profile === "source") notes.push("Owner/source exports can include private state and should stay in user-owned/private storage.");
  return { profile, includesOwnerWorkbench, includesReviewRuntime, includesProjectState, includesEventHistory, includesMigrationBootstrap, privateFileCount, publicFileCount, notes };
}

function validateExportPrivacy(privacy: ExportPrivacySummary): ExportValidationResult {
  const warnings: string[] = [];
  let status: ExportValidationResult["status"] = "ready";
  if (privacy.profile === "production" && privacy.includesOwnerWorkbench) {
    warnings.push("Production export includes owner workbench assets; use an owner export only for private workflows.");
    status = "blocked";
  }
  if (privacy.profile === "production" && privacy.includesEventHistory) {
    warnings.push("Production export includes project event history; remove private state before public deploy.");
    status = status === "blocked" ? "blocked" : "needsReview";
  }
  if (privacy.profile === "review" && privacy.includesOwnerWorkbench) {
    warnings.push("Review export includes owner workbench assets; reviewers should only get comment-only runtime.");
    status = "blocked";
  }
  if ((privacy.profile === "owner" || privacy.profile === "source") && privacy.privateFileCount > 0) {
    warnings.push("Owner/source export includes private project state and should be kept in user-owned private storage.");
    status = status === "ready" ? "needsReview" : status;
  }
  return { valid: status !== "blocked", status, warnings, privacy };
}

function selectFilesForExportProfile(files: GeneratedFile[], profile: ExportProfile): GeneratedFile[] {
  if (profile === "source" || profile === "owner") return files;
  if (profile === "review") {
    return files.filter((file) => !isOwnerOnlyFile(file.path) && !file.path.endsWith("project.state.json") && !file.path.endsWith("events.json"));
  }
  return files.filter((file) => isProductionExportFile(file.path));
}

function toExportFile(file: GeneratedFile, profile: ExportProfile): ExportFile {
  const bytes = new TextEncoder().encode(file.contents).length;
  const roleHint = exportRoleFor(file.path, file.public ?? false);
  const privateFile = !isProductionExportFile(file.path) || roleHint === "private" || roleHint === "canonical";
  return { ...file, bytes, roleHint, includedIn: includedProfilesFor(file.path), private: profile === "production" ? false : privateFile };
}

function exportRoleFor(path: string, isPublic: boolean): ExportFile["roleHint"] {
  if (/stitch\/(page\.spec|brand\.spec|content\.strategy|project\.state|migration\.bootstrap|events|provenance)\.json$/.test(path)) return "canonical";
  if (path.includes("_stitch") || path.includes("review-runtime") || path.includes("capsule")) return "capsule";
  if (path.startsWith("stitch/")) return "private";
  if (path.endsWith(".json") || path.endsWith(".toml") || path.endsWith(".yml") || path.includes("config")) return "config";
  if (isPublic || path.startsWith("public/")) return "public";
  return "generated";
}

function includedProfilesFor(path: string): ExportProfile[] {
  if (isOwnerOnlyFile(path)) return ["owner", "source"];
  if (path.includes("review-runtime")) return ["review", "owner", "source"];
  if (path.startsWith("stitch/")) return ["owner", "source"];
  return ["production", "review", "owner", "source"];
}

function isOwnerOnlyFile(path: string): boolean {
  return path.includes("_stitch") || path.endsWith("project.state.json") || path.endsWith("events.json") || path.endsWith("migration.bootstrap.json") || path.endsWith("source.provenance.json");
}

function isProductionExportFile(path: string): boolean {
  if (path.includes("_stitch") || path.includes("review-runtime") || path.includes("capsule")) return false;
  if (path.startsWith("stitch/")) return false;
  return true;
}

function exportProfileForBuild(profile: BuildProfile): ExportProfile {
  return profile;
}

function createArtifactNextActions(profile: ExportProfile, validation: ExportValidationResult): NextAction[] {
  const actions: NextAction[] = [
    { id: "download-export", kind: "exportZip", label: "Download/export artifact", description: "Write the artifact files into a user-owned folder, repo, or zip." },
    { id: "inspect-export-privacy", kind: "inspectWarnings", label: "Inspect export privacy", description: validation.warnings.length > 0 ? validation.warnings.join(" ") : "No blocking export privacy warnings." },
  ];
  if (profile !== "production") actions.push({ id: "create-production-export", kind: "deployHandoff", label: "Create production export", description: "Generate a production profile before public deployment." });
  return actions;
}

function slugifyArtifactName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "stitch-site";
}

export type DeployPackageOptions = {
  provider?: DeployProvider;
  project?: StitchProject;
};

export function createDeployPackage(artifact: ExportArtifact, options: DeployPackageOptions = {}): DeployPackage {
  const provider = options.provider ?? "manualStatic";
  if (provider === "cloudflarePages") return createCloudflarePagesDeployPackage(artifact, options.project);
  return createManualStaticDeployPackage(artifact, provider, options.project);
}

export function createCloudflarePagesDeployPackage(artifact: ExportArtifact, project?: StitchProject): DeployPackage {
  const buildCommand = "npm run build";
  const outputDirectory = "dist";
  const providerFile: DeployFile = {
    path: "stitch/deploy.cloudflare-pages.json",
    contents: JSON.stringify(
      {
        provider: "cloudflarePages",
        buildCommand,
        outputDirectory,
        profile: artifact.profile,
        artifactId: artifact.id,
        note: "Provider-ready handoff only. Connect this project in the user's Cloudflare account or use Cloudflare Pages Direct Upload later.",
      },
      null,
      2
    ) + "\n",
    role: "manifest",
    public: false,
    purpose: "providerConfig",
  };
  return createDeployPackageBase({ artifact, provider: "cloudflarePages", ...(project ? { project } : {}), buildCommand, outputDirectory, providerFiles: [providerFile] });
}

export function createManualStaticDeployPackage(artifact: ExportArtifact, provider: DeployProvider = "manualStatic", project?: StitchProject): DeployPackage {
  const buildCommand = "npm run build";
  const outputDirectory = "dist";
  const providerFile: DeployFile = {
    path: "stitch/deploy.manual-static.json",
    contents: JSON.stringify(
      {
        provider,
        buildCommand,
        outputDirectory,
        profile: artifact.profile,
        artifactId: artifact.id,
        note: "Build locally and upload the output directory to any static host owned by the user.",
      },
      null,
      2
    ) + "\n",
    role: "manifest",
    public: false,
    purpose: "providerConfig",
  };
  return createDeployPackageBase({ artifact, provider, ...(project ? { project } : {}), buildCommand, outputDirectory, providerFiles: [providerFile] });
}

export function validateDeployPackage(pkg: DeployPackage): DeployReadinessReport {
  const hasFiles = pkg.files.length > 0;
  const readiness = validateDeployReadinessForArtifact({
    provider: pkg.provider,
    artifact: {
      id: pkg.artifactId,
      profile: pkg.profile,
      privacy: pkg.readiness ? ({ profile: pkg.profile, includesOwnerWorkbench: false, includesReviewRuntime: false, includesProjectState: false, includesEventHistory: false, includesMigrationBootstrap: false, privateFileCount: 0, publicFileCount: 0, notes: [] } as ExportPrivacySummary) : pkg.readiness,
    } as unknown as ExportArtifact,
    buildCommand: pkg.buildCommand,
    outputDirectory: pkg.outputDirectory,
  });
  return {
    ...readiness,
    status: !hasFiles ? "blocked" : pkg.readiness.status,
    warnings: [...(!hasFiles ? ([{ code: "unsupported-feature", severity: "blocked", message: "Deploy package has no files." }] as DeployWarning[]) : []), ...pkg.warnings],
    summary: !hasFiles ? "Deploy package is blocked because no files were included." : pkg.readiness.summary,
  };
}

export function summarizeDeployPackage(pkg: DeployPackage): string {
  return `${pkg.provider} ${pkg.profile} deploy package: ${pkg.readiness.status}. Build '${pkg.buildCommand}' and publish '${pkg.outputDirectory}'. ${pkg.warnings.length} warning(s).`;
}

function createDeployPackageBase(options: {
  artifact: ExportArtifact;
  provider: DeployProvider;
  project?: StitchProject;
  buildCommand: string;
  outputDirectory: string;
  providerFiles: DeployFile[];
}): DeployPackage {
  const { artifact, provider, project, buildCommand, outputDirectory, providerFiles } = options;
  const projectFiles: DeployFile[] = artifact.files.map((file) => ({ ...file, purpose: "projectFile" }));
  const readiness = validateDeployReadinessForArtifact({ provider, artifact, buildCommand, outputDirectory });
  const commands = createDeployCommands(provider, buildCommand, project?.rootDir);
  const steps = createDeploySteps(provider, artifact.profile);
  const manualSteps = createDeployManualSteps(provider, artifact.profile, buildCommand, outputDirectory);
  return {
    id: `deploy-${provider}-${artifact.id}`,
    kind: "stitch-deploy-package",
    version: "0.1.0",
    provider,
    artifactId: artifact.id,
    ...(project ? { projectId: project.id } : {}),
    profile: artifact.profile,
    createdAt: new Date().toISOString(),
    buildCommand,
    outputDirectory,
    files: [...projectFiles, ...providerFiles],
    commands,
    steps,
    readiness,
    manualSteps,
    environmentNotes: createDeployEnvironmentNotes(provider),
    unsupportedFeatures: createUnsupportedFeatureNotes(provider, artifact.profile),
    warnings: readiness.warnings,
  };
}

function validateDeployReadinessForArtifact(options: {
  provider: DeployProvider;
  artifact: ExportArtifact;
  buildCommand: string;
  outputDirectory: string;
}): DeployReadinessReport {
  const { provider, artifact, buildCommand, outputDirectory } = options;
  const warnings: DeployWarning[] = [];
  if (artifact.profile === "owner") {
    warnings.push({ code: "owner-profile-public-risk", severity: "warning", message: "Owner exports include the private workbench/history and should not be deployed publicly." });
  }
  if (artifact.profile === "review" || artifact.privacy.includesReviewRuntime) {
    warnings.push({ code: "review-runtime-included", severity: "info", message: "Review runtime is comment-only and intended for staging/client review." });
  }
  if (artifact.profile === "production" && (artifact.privacy.includesOwnerWorkbench || artifact.privacy.includesEventHistory || artifact.privacy.includesProjectState)) {
    warnings.push({ code: "private-state-in-public-package", severity: "blocked", message: "Production deploy package includes private owner state/workbench files." });
  }
  if (artifact.publicExposureAudit?.findings.some((finding) => finding.severity === "blocked")) {
    warnings.push({ code: "private-state-in-public-package", severity: "blocked", message: "Public exposure audit blocked this deploy package." });
  }
  if (artifact.warnings.some((warning) => /form destination/i.test(warning))) {
    warnings.push({ code: "unknown-form-destination", severity: "warning", message: "One or more form destinations require owner review before production deployment." });
  }
  if (artifact.files.some((file) => /_stitch|project\.state|events\.json/.test(file.path)) && artifact.profile === "production") {
    warnings.push({ code: "private-state-in-public-package", severity: "blocked", message: "Private capsule/state file appeared in production artifact." });
  }
  warnings.push({ code: "manual-domain-step", severity: "info", message: "Custom domains and DNS remain in the user's hosting account." });
  warnings.push({ code: "provider-api-not-called", severity: "info", message: "Phase 12 prepares a provider-ready package only; no hosting API calls are made." });
  const hasBlocked = warnings.some((warning) => warning.severity === "blocked") || artifact.validation.status === "blocked";
  const hasNeedsReview = warnings.some((warning) => warning.severity === "warning") || artifact.validation.status === "needsReview";
  return {
    provider,
    profile: artifact.profile,
    status: hasBlocked ? "blocked" : hasNeedsReview ? "needsReview" : "ready",
    buildCommand,
    outputDirectory,
    warnings,
    summary: `${provider} package for ${artifact.profile} export. ${hasBlocked ? "Blocked by privacy/readiness issues." : hasNeedsReview ? "Ready after owner review." : "Ready for user-owned hosting."}`,
  };
}

function createDeployCommands(provider: DeployProvider, buildCommand: string, workingDirectory?: string): DeployCommand[] {
  const commands: DeployCommand[] = [{ label: "Install dependencies", command: "npm install", ...(workingDirectory ? { workingDirectory } : {}) }, { label: "Build static site", command: buildCommand, ...(workingDirectory ? { workingDirectory } : {}) }];
  if (provider === "cloudflarePages") commands.push({ label: "Cloudflare Pages setting", command: "Set build command to npm run build and output directory to dist in Cloudflare Pages.", ...(workingDirectory ? { workingDirectory } : {}) });
  if (provider === "manualStatic") commands.push({ label: "Upload output", command: "Upload the dist directory to your static host.", ...(workingDirectory ? { workingDirectory } : {}) });
  return commands;
}

function createDeploySteps(provider: DeployProvider, profile: ExportProfile): DeployStep[] {
  return [
    { id: "inspect-export", title: "Inspect export privacy", description: `Confirm the ${profile} export matches the intended audience.`, required: true },
    { id: "write-files", title: "Write project files", description: "Write the export artifact files into the user-owned project/repo.", required: true },
    { id: "build", title: "Build static output", description: "Run the package build command and verify the dist output.", command: "npm run build", required: true },
    { id: "connect-provider", title: `Connect ${provider}`, description: "Connect the project in the user's hosting provider account. Stitch does not host or publish it.", required: true },
  ];
}

function createDeployManualSteps(provider: DeployProvider, profile: ExportProfile, buildCommand: string, outputDirectory: string): string[] {
  if (provider === "cloudflarePages") {
    return [
      "Create or open a Cloudflare Pages project in the user's Cloudflare account.",
      `Use build command: ${buildCommand}`,
      `Use output directory: ${outputDirectory}`,
      profile === "review" ? "Use this as a staging/review deployment because it includes comment-only review runtime." : "Use production exports for public pages.",
      "Configure custom domains and DNS inside Cloudflare when ready.",
    ];
  }
  return [
    "Write the project files to user-owned storage or a repo.",
    `Run ${buildCommand}.`,
    `Upload ${outputDirectory} to the chosen static host.`,
    "Keep owner/source exports private unless access controls are configured.",
  ];
}

function createDeployEnvironmentNotes(provider: DeployProvider): string[] {
  if (provider === "cloudflarePages") return ["No Stitch-hosted project state is required.", "Cloudflare account, project, custom domains, and DNS remain user-owned.", "Serverless feedback inboxes are intentionally not configured in this phase."];
  return ["No provider API is called by this package.", "The artifact can be moved to any static host that supports the generated build output."];
}

function createUnsupportedFeatureNotes(provider: DeployProvider, profile: ExportProfile): string[] {
  const notes = ["Automatic provider project creation is not included in Phase 12.", "Automatic domain configuration is not included in Phase 12."];
  if (provider === "manualStatic" && profile === "review") notes.push("Review feedback transport may require download/mailto/post handoff because manual static hosts may not provide serverless inbox storage.");
  return notes;
}

export function createPublicExposureAuditFromFiles(profile: ExportProfile, files: Array<{ path: string }>): PublicExposureAudit {
  const paths = files.map((file) => file.path);
  const includesOwnerTools = paths.some((path) => path.includes("/_stitch") || path.includes("public/_stitch"));
  const includesReviewRuntime = paths.some((path) => path.includes("review-runtime"));
  const includesProjectState = paths.some((path) => path.endsWith("project.state.json"));
  const includesEventHistory = paths.some((path) => path.endsWith("events.json") || path.endsWith("project.state.json"));
  const includesMigrationBootstrap = paths.some((path) => path.endsWith("migration.bootstrap.json"));
  const findings: PublicExposureAudit["findings"] = [];
  if (includesOwnerTools) findings.push({ code: "owner-tools-exposed", severity: profile === "production" || profile === "review" ? "blocked" : "warning", message: "Owner workbench files are included.", filePaths: paths.filter((path) => path.includes("_stitch")) });
  if (includesReviewRuntime) findings.push({ code: "review-runtime-exposed", severity: profile === "production" ? "warning" : "info", message: "Comment-only review runtime is included.", filePaths: paths.filter((path) => path.includes("review-runtime")) });
  if (includesProjectState) findings.push({ code: "private-state-exposed", severity: profile === "production" || profile === "review" ? "blocked" : "warning", message: "Project state is included.", filePaths: paths.filter((path) => path.endsWith("project.state.json")) });
  if (includesEventHistory) findings.push({ code: "event-history-exposed", severity: profile === "production" || profile === "review" ? "blocked" : "warning", message: "Event history is included.", filePaths: paths.filter((path) => path.endsWith("events.json") || path.endsWith("project.state.json")) });
  if (includesMigrationBootstrap) findings.push({ code: "migration-bootstrap-exposed", severity: profile === "production" ? "warning" : "info", message: "Migration bootstrap provenance is included.", filePaths: paths.filter((path) => path.endsWith("migration.bootstrap.json")) });
  if (profile === "production" && findings.every((finding) => finding.severity !== "blocked")) findings.push({ code: "production-public-safe", severity: "info", message: "Production export passes the basic public exposure audit." });
  if (profile === "review") findings.push({ code: "review-profile-comment-only", severity: "info", message: "Review profile is comment-only and should not include owner tools." });
  if (profile === "owner" || profile === "source") findings.push({ code: "owner-profile-public-risk", severity: "warning", message: "Owner/source exports are private by default." });
  const blocked = findings.some((finding) => finding.severity === "blocked");
  const warning = findings.some((finding) => finding.severity === "warning");
  return {
    id: `export-audit-${profile}-${Date.now()}`,
    createdAt: new Date().toISOString(),
    profile,
    safeForPublic: profile === "production" && !blocked,
    includesOwnerTools,
    includesReviewRuntime,
    includesProjectState,
    includesEventHistory,
    includesMigrationBootstrap,
    findings,
    summary: blocked ? "Export is blocked by public exposure rules." : warning ? "Export requires owner review before sharing." : "Export exposure audit is ready.",
  };
}


// Phase 14: materialize profile-aware export artifacts into concrete, download-ready payloads.
export type MaterializeExportOptions = {
  format?: ArtifactFormat;
  fileName?: string;
};

export function materializeExportArtifact(artifact: ExportArtifact, options: MaterializeExportOptions = {}): MaterializedArtifact {
  const format = options.format ?? "stitchBundleJson";
  const files = artifact.files.map(toMaterializedArtifactFile);
  const integrity = createArtifactIntegrity(files);
  const validation = validateExportArtifact(artifact);
  const warnings = createMaterializationWarnings(artifact, format, validation);
  const blocked = warnings.some((warning) => warning.severity === "blocked") || validation.status === "blocked";
  const payloadObject = {
    kind: "stitch-materialized-artifact-payload",
    version: "0.1.0",
    artifactId: artifact.id,
    profile: artifact.profile,
    createdAt: artifact.createdAt,
    files: files.map((file) => ({ path: file.path, encoding: file.encoding, contents: file.contents, private: file.private, roleHint: file.roleHint })),
    integrity,
    privacy: artifact.privacy,
    receipt: artifact.receipt,
  };
  const payload = JSON.stringify(payloadObject, null, 2);
  const materialized: MaterializedArtifact = {
    id: `materialized-${artifact.id}-${simpleArtifactHash(`${artifact.id}:${format}:${integrity.hash}`)}`,
    kind: "stitch-materialized-artifact",
    version: "0.1.0",
    artifactId: artifact.id,
    ...(artifact.projectId ? { projectId: artifact.projectId } : {}),
    profile: artifact.profile,
    format,
    createdAt: new Date().toISOString(),
    fileName: options.fileName ?? defaultMaterializedFileName(artifact, format),
    mimeType: format === "stitchBundleJson" ? "application/vnd.stitch.bundle+json" : "application/json",
    files,
    payload,
    payloadEncoding: "utf8",
    integrity,
    privacy: artifact.privacy,
    validation,
    ...(artifact.publicExposureAudit ? { publicExposureAudit: artifact.publicExposureAudit } : {}),
    receipt: artifact.receipt,
    warnings,
    downloadReady: !blocked,
    summary: blocked
      ? `${artifact.profile} artifact materialization is blocked by privacy/export validation.`
      : `${artifact.profile} artifact materialized as ${format} with ${files.length} file(s) and ${integrity.totalBytes} byte(s).`,
  };
  return materialized;
}

export function materializeAsStitchBundleJson(artifact: ExportArtifact, options: Omit<MaterializeExportOptions, "format"> = {}): MaterializedArtifact {
  return materializeExportArtifact(artifact, { ...options, format: "stitchBundleJson" });
}

export function validateMaterializedArtifact(artifact: MaterializedArtifact): MaterializationResult {
  const warnings = [...artifact.warnings];
  if (artifact.files.length === 0) warnings.push({ code: "artifact-empty", severity: "blocked", message: "Materialized artifact contains no files." });
  const recomputed = createArtifactIntegrity(artifact.files);
  if (recomputed.hash !== artifact.integrity.hash) {
    warnings.push({ code: "zip-not-compressed", severity: "warning", message: "Artifact integrity changed from its recorded receipt; recreate the artifact before sharing." });
  }
  const blocked = warnings.some((warning) => warning.severity === "blocked") || artifact.validation.status === "blocked";
  const needsReview = warnings.some((warning) => warning.severity === "warning") || artifact.validation.status === "needsReview";
  return { status: blocked ? "blocked" : needsReview ? "needsReview" : "ready", artifact, warnings, integrity: recomputed };
}

export function createDownloadReceipt(artifact: MaterializedArtifact): ExportReceipt {
  return {
    id: `download-${artifact.id}`,
    artifactId: artifact.artifactId,
    createdAt: artifact.createdAt,
    profile: artifact.profile,
    fileCount: artifact.files.length,
    totalBytes: artifact.integrity.totalBytes,
    summary: `${artifact.fileName} is ${artifact.downloadReady ? "ready" : "not ready"} for download as ${artifact.format}.`,
  };
}

export function createArtifactIntegrity(files: MaterializedArtifactFile[]): ArtifactIntegrity {
  const fileHashes = files.map((file) => ({ path: file.path, bytes: file.bytes, hash: simpleArtifactHash(`${file.path}
${file.contents}`) }));
  const totalBytes = fileHashes.reduce((sum, file) => sum + file.bytes, 0);
  return { algorithm: "stitch-simple-hash-v1", hash: simpleArtifactHash(fileHashes.map((file) => `${file.path}:${file.hash}:${file.bytes}`).join("|")), fileHashes, totalBytes };
}

function toMaterializedArtifactFile(file: ExportFile): MaterializedArtifactFile {
  return { path: file.path, contents: file.contents, encoding: "utf8", bytes: file.bytes, private: file.private, roleHint: file.roleHint };
}

function createMaterializationWarnings(artifact: ExportArtifact, format: ArtifactFormat, validation: ExportValidationResult): MaterializationWarning[] {
  const warnings: MaterializationWarning[] = [];
  if (format !== "zipBase64") warnings.push({ code: "zip-not-compressed", severity: "info", message: "Phase 14 materializes a deterministic bundle payload; binary ZIP compression can be layered on later." });
  if (artifact.profile === "owner") warnings.push({ code: "owner-artifact-private", severity: "warning", message: "Owner artifacts include private capsule/state and should stay in user-owned private storage." });
  if (artifact.profile === "source") warnings.push({ code: "source-artifact-private", severity: "warning", message: "Source artifacts may include migration provenance and event history." });
  if (artifact.profile === "production" && artifact.files.some((file) => file.private)) warnings.push({ code: "production-private-file-blocked", severity: "blocked", message: "Production materialization includes private files." });
  if (artifact.profile === "review" && artifact.files.some((file) => file.path.includes("/_stitch") || file.path.includes("project.state"))) warnings.push({ code: "review-owner-tools-blocked", severity: "blocked", message: "Review materialization includes owner tools or private state." });
  if (artifact.privacy.includesProjectState || artifact.privacy.includesEventHistory) warnings.push({ code: "private-state-included", severity: artifact.profile === "owner" || artifact.profile === "source" ? "warning" : "blocked", message: "Artifact includes private project state or event history." });
  for (const message of validation.warnings) warnings.push({ code: "private-state-included", severity: validation.status === "blocked" ? "blocked" : "warning", message });
  return warnings;
}

function defaultMaterializedFileName(artifact: ExportArtifact, format: ArtifactFormat): string {
  const extension = format === "zipBase64" ? "zip.b64" : format === "directoryManifest" ? "manifest.json" : "stitch-bundle.json";
  return artifact.downloadFileName.replace(/\.zip$/, `.${extension}`);
}

function simpleArtifactHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
