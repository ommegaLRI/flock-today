import { createCapsuleFiles } from "@stitch/capsule";
import {
  createDefaultBrandSpec,
  createDefaultDeploymentManifest,
  adaptMigrationBootstrapToCampaignPageSpec,
  getBootstrapBuildProfile,
  getBootstrapWarnings,
  type BrandExtraction,
  type BrandSpec,
  type BuildProfile,
  type CampaignPageSpec,
  type CapturedSection,
  type ContentStrategyExtraction,
  type ContractInferenceProvider,
  type CtaSpec,
  type DeploymentManifest,
  type GeneratedFile,
  type FeedbackTransportConfig,
  type GeneratedFileManifestItem,
  type GeneratedSiteBundle,
  type ExportArtifact,
  type ExportProfile,
  type DeployPackage,
  type DeployProvider,
  type MigrationRefinement,
  type MigrationReport,
  type MigrationWarning,
  type PageCapture,
  type PublishWarning,
  type PublicExposureAudit,
  type MaterializedArtifact,
  type ArtifactFormat,
  type SectionCandidate,
  type SpecOperation,
  type InferenceRefinementTrace,
  type MigrationBootstrap,
  type BootstrapIngestionResult,
  type MigrationBootstrapValidationResult,
  type InstallPlan,
  type InstallTarget,
  type InstallWarning,
  type NextAction,
  type ProjectFileManifestItem,
  type ProjectFileRole,
  type StitchProject,
  type StitchProjectManifest,
  type SectionEditPolicy,
  type SectionElementSpec,
  type SectionSpec,
  type SectionType,
  type StrategyRole,
} from "@stitch/contract";
import { createDeployPackage, createExportArtifact, materializeExportArtifact } from "@stitch/adapters";
import {
  appendEvent,
  applySpecOperations,
  createInitialProjectState,
  createProjectInstalledEvent,
  createProjectStateFromBootstrap,
  createProvenanceRecord,
  validateBootstrapForOwnership,
  auditPublicExposure,
  createCapsuleAccessPolicy,
} from "@stitch/kernel";

export type { BuildProfile, GeneratedFile, GeneratedFileManifestItem, GeneratedSiteBundle, MigrationReport } from "@stitch/contract";


export type BootstrapBundle = GeneratedSiteBundle & {
  bootstrap: MigrationBootstrap;
  ingestion: BootstrapIngestionResult;
  validation: MigrationBootstrapValidationResult;
};


export type ProjectInstallOptions = {
  rootDir?: string;
  target?: InstallTarget;
  buildProfile?: BuildProfile;
  feedbackTransports?: FeedbackTransportConfig[];
  allowBlockedBootstrap?: boolean;
  allowProductionWithReviewWarnings?: boolean;
};

export function ingestMigrationBootstrap(bootstrap: MigrationBootstrap): BootstrapIngestionResult {
  return createProjectStateFromBootstrap(bootstrap);
}

export function compileBootstrapToBundle(bootstrap: MigrationBootstrap, options: BundleOptions = {}): BootstrapBundle {
  const validation = validateBootstrapForOwnership(bootstrap);
  const buildProfile = options.buildProfile ?? getBootstrapBuildProfile(bootstrap);
  assertBootstrapCompilationAllowed(validation, buildProfile, options);
  const ingestion = ingestMigrationBootstrap(bootstrap);
  const base = createPortableSiteBundle(ingestion.projectState.spec, {
    buildProfile,
    ...(options.feedbackTransports ? { feedbackTransports: options.feedbackTransports } : {}),
  });
  const bootstrapFiles: GeneratedFile[] = [
    { path: "stitch/migration.bootstrap.json", role: "spec", public: false, contents: JSON.stringify(bootstrap, null, 2) + "\n" },
    { path: "stitch/source.provenance.json", role: "spec", public: false, contents: JSON.stringify(bootstrap.source, null, 2) + "\n" },
    { path: "stitch/asset-manifest.json", role: "manifest", public: false, contents: JSON.stringify(bootstrap.assets, null, 2) + "\n" },
    { path: "stitch/integrations.json", role: "spec", public: false, contents: JSON.stringify(bootstrap.integrations, null, 2) + "\n" },
    { path: "stitch/project.state.json", role: "spec", public: false, contents: JSON.stringify(ingestion.projectState, null, 2) + "\n" },
  ];
  const files = upsertFiles(base.files, bootstrapFiles);
  return {
    ...base,
    files,
    manifest: createGeneratedFileManifest(files),
    warnings: [...base.warnings, ...getBootstrapWarnings(bootstrap).map((warning) => ({ code: warning.code as any, message: warning.message, severity: warning.severity }))],
    sourceStateVersion: ingestion.projectState.version,
    generatedFromEventId: ingestion.initialEvent.id,
    provenance: [
      ...(base.provenance ?? []),
      createProvenanceRecord("migration", `Compiled bootstrap ${bootstrap.id} into ${buildProfile} bundle.`, {
        eventId: ingestion.initialEvent.id,
        policy: "migration-bootstrap-compile-v0",
        inputHash: hashish(JSON.stringify(bootstrap)),
        outputHash: hashish(files.map((file) => `${file.path}:${file.contents.length}`).join("|")),
      }),
    ],
    bootstrap,
    ingestion,
    validation,
  };
}



export function createStitchProjectFromBootstrap(bootstrap: MigrationBootstrap, options: ProjectInstallOptions = {}): StitchProject {
  const spec = adaptMigrationBootstrapToCampaignPageSpec(bootstrap);
  const rootDir = options.rootDir ?? slugifyProjectRoot(spec.slug || spec.title || bootstrap.id);
  const bundle = compileBootstrapToBundle(bootstrap, {
    buildProfile: options.buildProfile ?? getBootstrapBuildProfile(bootstrap),
    ...(options.feedbackTransports ? { feedbackTransports: options.feedbackTransports } : {}),
    ...(options.allowBlockedBootstrap ? { allowBlockedBootstrap: true } : {}),
    ...(options.allowProductionWithReviewWarnings ? { allowProductionWithReviewWarnings: true } : {}),
  });
  const installPlan = createInstallPlan(bootstrap, bundle, { rootDir, target: options.target ?? "folder" });
  const installedEvent = createProjectInstalledEvent(`project-${bootstrap.id}`, installPlan);
  const state = appendEvent(bundle.ingestion.projectState, installedEvent);
  const manifest = createStitchProjectManifest(bootstrap, bundle, installPlan, rootDir);
  const project: StitchProject = {
    id: `project-${bootstrap.id}`,
    name: spec.title,
    createdAt: new Date().toISOString(),
    rootDir,
    activeProfile: bundle.buildProfile,
    bootstrap,
    state,
    bundle: {
      ...bundle,
      sourceStateVersion: state.version,
      generatedFromEventId: installedEvent.id,
    },
    manifest,
    installPlan,
  };
  return { ...project, bundle: { ...project.bundle, files: compileProjectFiles(project), manifest: createGeneratedFileManifest(compileProjectFiles(project)) } };
}

export function compileProjectFiles(project: StitchProject): GeneratedFile[] {
  const projectFiles: GeneratedFile[] = [
    { path: "stitch/project.manifest.json", role: "manifest", public: false, contents: JSON.stringify(project.manifest, null, 2) + "\n" },
    { path: "stitch/install-plan.json", role: "manifest", public: false, contents: JSON.stringify(project.installPlan, null, 2) + "\n" },
    { path: "stitch/project.state.json", role: "spec", public: false, contents: JSON.stringify(project.state, null, 2) + "\n" },
  ];
  return upsertFiles(project.bundle.files, projectFiles);
}

export function createInstallPlan(bootstrap: MigrationBootstrap, bundle: GeneratedSiteBundle, options: { rootDir?: string; target?: InstallTarget } = {}): InstallPlan {
  const spec = adaptMigrationBootstrapToCampaignPageSpec(bootstrap);
  const rootDir = options.rootDir ?? slugifyProjectRoot(spec.slug || spec.title || bootstrap.id);
  const target = options.target ?? "folder";
  const files = createProjectFileRoles(bundle.files);
  const warnings = createInstallWarnings(bootstrap, bundle);
  return {
    id: `install-${bootstrap.id}-${bundle.buildProfile}`,
    projectId: `project-${bootstrap.id}`,
    target,
    rootDir,
    profile: bundle.buildProfile,
    steps: [
      { id: "validate-bootstrap", title: "Validate bootstrap", description: "Check the private migration handoff against the open Stitch contract.", status: "ready" },
      { id: "write-project-files", title: "Write project files", description: `Write ${files.length} file(s) under ${rootDir}.`, status: "ready" },
      { id: "inspect-warnings", title: "Inspect warnings", description: "Review migration and install warnings before publishing.", status: warnings.length > 0 ? "manual" : "ready" },
      { id: "choose-publish-profile", title: "Choose publish profile", description: "Use production for public deploys, review for client comments, owner for private workbench use.", status: "manual" },
    ],
    files,
    warnings,
    nextActions: createInstallNextActions(bundle.buildProfile, warnings),
  };
}

function createStitchProjectManifest(bootstrap: MigrationBootstrap, bundle: GeneratedSiteBundle, installPlan: InstallPlan, rootDir: string): StitchProjectManifest {
  const fileRoles = installPlan.files;
  return {
    id: `manifest-${bootstrap.id}`,
    name: adaptMigrationBootstrapToCampaignPageSpec(bootstrap).title,
    rootDir,
    designContractVersion: bootstrap.designContractVersion,
    activeProfile: bundle.buildProfile,
    canonicalFiles: fileRoles.filter((file) => file.canonical).map((file) => file.path),
    generatedFiles: fileRoles.filter((file) => file.generated).map((file) => file.path),
    capsuleFiles: fileRoles.filter((file) => file.role === "capsule").map((file) => file.path),
    privateFiles: fileRoles.filter((file) => !file.public || file.role === "private").map((file) => file.path),
    publicFiles: fileRoles.filter((file) => file.public).map((file) => file.path),
    fileRoles,
  };
}

function createProjectFileRoles(files: GeneratedFile[]): ProjectFileManifestItem[] {
  return files.map((file) => {
    const role = projectFileRoleFor(file);
    return {
      path: file.path,
      role,
      source: file.path.includes("capsule") || file.path.includes("_stitch") || file.path.includes("review-runtime") ? "capsule" : file.path.startsWith("stitch/") ? "kernel" : "compiler",
      public: file.public ?? (file.path.startsWith("public/") || file.path === "index.html"),
      canonical: isCanonicalProjectFile(file.path),
      generated: !isCanonicalProjectFile(file.path),
    };
  });
}

function projectFileRoleFor(file: GeneratedFile): ProjectFileRole {
  if (/stitch\/(page\.spec|brand\.spec|content\.strategy|project\.state|migration\.bootstrap|events|provenance)\.json$/.test(file.path)) return "canonical";
  if (file.path.includes("_stitch") || file.path.includes("review-runtime") || file.path.includes("capsule")) return "capsule";
  if (file.path.startsWith("stitch/") && !file.public) return "private";
  if (file.path === "package.json" || file.path.includes("config") || file.path.endsWith(".toml") || file.path.endsWith(".yml")) return "config";
  if (file.public || file.path === "index.html" || file.path.startsWith("public/")) return "public";
  return "generated";
}

function isCanonicalProjectFile(path: string): boolean {
  return /^stitch\/(page\.spec|brand\.spec|content\.strategy|project\.state|migration\.bootstrap|migration\.report|source\.provenance|events|provenance)\.json$/.test(path);
}

function createInstallWarnings(bootstrap: MigrationBootstrap, bundle: GeneratedSiteBundle): InstallWarning[] {
  const warnings: InstallWarning[] = [];
  if (bundle.buildProfile === "owner") warnings.push({ code: "owner-profile-private", severity: "warning", message: "Owner profile includes /_stitch workbench assets. Keep this install private or access-controlled." });
  if (bundle.buildProfile === "review") warnings.push({ code: "review-profile-comment-only", severity: "info", message: "Review profile includes comment-only feedback runtime. It cannot edit or publish." });
  if (bundle.buildProfile === "production") warnings.push({ code: "production-profile-no-workbench", severity: "info", message: "Production profile excludes owner workbench and should be used for public publishing." });
  if (bootstrap.assets.items.some((asset) => asset.migrationPolicy === "requiresReview" || asset.migrationPolicy === "unsupported" || !asset.storageRef)) warnings.push({ code: "assets-require-download", severity: "warning", message: "Some migration assets are referenced by URL and may need downloading or replacement before production." });
  const bootstrapWarnings = getBootstrapWarnings(bootstrap);
  if (bootstrapWarnings.length > 0) warnings.push({ code: "warnings-from-migration", severity: "warning", message: `${bootstrapWarnings.length} migration warning(s) should be reviewed by the owner.` });
  warnings.push({ code: "manual-deploy-step", severity: "info", message: "Phase 10 creates an installable project; real provider API deployment remains a later phase." });
  return warnings;
}

function createInstallNextActions(profile: BuildProfile, warnings: InstallWarning[]): NextAction[] {
  const actions: NextAction[] = [
    { id: "inspect-warnings", kind: "inspectWarnings", label: "Inspect migration warnings", description: warnings.length > 0 ? "Review preserved migration/install warnings before publishing." : "No blocking install warnings were produced." },
    { id: "open-workbench", kind: "openWorkbench", label: "Open owner workbench", description: "Open /_stitch in a private owner build to review state, feedback, and spec edits.", href: "/_stitch" },
    { id: "export-zip", kind: "exportZip", label: "Export project ZIP", description: "Create a zip preserving the project file tree and write it to a user-owned repo." },
    { id: "deploy-handoff", kind: "deployHandoff", label: "Create deploy handoff", description: "Use provider-ready handoff plans for Cloudflare Pages, Netlify, Vercel, GitHub Pages, or zip export." },
  ];
  if (profile !== "review") actions.splice(2, 0, { id: "create-review-build", kind: "createReviewBuild", label: "Create review build", description: "Generate a review profile bundle so clients can leave comment-only pins." });
  return actions;
}

function assertBootstrapCompilationAllowed(
  validation: MigrationBootstrapValidationResult,
  buildProfile: BuildProfile,
  options: Pick<BundleOptions, "allowBlockedBootstrap" | "allowProductionWithReviewWarnings"> = {}
): void {
  if (validation.status === "blocked" && !options.allowBlockedBootstrap) {
    throw new Error(`Blocked MigrationBootstrap cannot be compiled: ${validation.warnings.join("; ")}`);
  }
  if (validation.status === "needsReview" && buildProfile === "production" && !options.allowProductionWithReviewWarnings) {
    throw new Error(`MigrationBootstrap needs owner review before production compilation: ${validation.warnings.join("; ")}`);
  }
}

function slugifyProjectRoot(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72);
  return slug || "stitch-campaign-site";
}

function upsertFiles(files: GeneratedFile[], additions: GeneratedFile[]): GeneratedFile[] {
  const next = [...files];
  for (const file of additions) {
    const index = next.findIndex((item) => item.path === file.path);
    if (index >= 0) next[index] = file;
    else next.push(file);
  }
  return next;
}

export type SiteBundle = {
  spec: CampaignPageSpec;
  files: GeneratedFile[];
  report: MigrationReport;
};

export type CompileOptions = {
  mode?: "semantic" | "visualFaithful" | "clone";
  title?: string;
  includeCapsule?: boolean;
  buildProfile?: BuildProfile;
  refine?: boolean;
  inferenceProvider?: ContractInferenceProvider;
};

export type BundleOptions = {
  buildProfile?: BuildProfile;
  refine?: boolean;
  inferenceProvider?: ContractInferenceProvider;
  feedbackTransports?: FeedbackTransportConfig[];
  allowBlockedBootstrap?: boolean;
  allowProductionWithReviewWarnings?: boolean;
};

type RenderOptions = {
  includeCapsule?: boolean;
  buildProfile?: BuildProfile;
  refine?: boolean;
  inferenceProvider?: ContractInferenceProvider;
};

type FormIntegrationItem = NonNullable<NonNullable<CampaignPageSpec["integrations"]>["forms"]>[number];
type AnalyticsIntegrationItem = NonNullable<NonNullable<CampaignPageSpec["integrations"]>["analytics"]>[number];

export function compileCaptureToSiteBundle(capture: PageCapture, options: CompileOptions = {}): SiteBundle {
  const spec = normalizeCaptureToCampaignSpec(capture, extractBrandSpec(capture), options);
  const buildProfile = options.buildProfile ?? (options.includeCapsule === false ? "production" : "owner");
  const bundle = createPortableSiteBundle(spec, { buildProfile });
  const report = createMigrationReport(capture, spec, options);
  return { spec, files: bundle.files, report };
}

export function compileCaptureToPortableBundle(capture: PageCapture, options: CompileOptions = {}): GeneratedSiteBundle & { report: MigrationReport } {
  const siteBundle = compileCaptureToSiteBundle(capture, options);
  const portable = createPortableSiteBundle(siteBundle.spec, { buildProfile: options.buildProfile ?? (options.includeCapsule === false ? "production" : "owner") });
  return { ...portable, report: siteBundle.report };
}

export function compileCampaignSite(spec: CampaignPageSpec, options: RenderOptions = {}): GeneratedSiteBundle {
  return createPortableSiteBundle(spec, { buildProfile: options.buildProfile ?? (options.includeCapsule === false ? "production" : "owner") });
}

export function createPortableSiteBundle(spec: CampaignPageSpec, options: BundleOptions = {}): GeneratedSiteBundle {
  const buildProfile = options.buildProfile ?? "production";
  const deployManifest: DeploymentManifest = { ...createDefaultDeploymentManifest(), profile: buildProfile };
  const files = generateReactCampaignFiles(spec, { buildProfile, ...(options.feedbackTransports ? { feedbackTransports: options.feedbackTransports } : {}) });
  const manifest = createGeneratedFileManifest(files);
  const generatedAt = new Date().toISOString();
  const provenance = [
    createProvenanceRecord("bundle", `Generated ${buildProfile} portable site bundle from CampaignPageSpec ${spec.id}.`, {
      policy: "portable-bundle-profile-v0",
      inputHash: hashish(JSON.stringify(spec)),
      outputHash: hashish(files.map((file) => `${file.path}:${file.contents.length}`).join("|")),
    }),
  ];
  return {
    spec,
    files,
    manifest,
    buildProfile,
    deployManifest,
    capsuleIncluded: files.some((file) => file.role === "capsule"),
    warnings: createBundleWarnings(spec, files, buildProfile),
    generatedAt,
    sourceStateVersion: 1,
    provenance,
    accessPolicy: createCapsuleAccessPolicy(buildProfile),
    publicExposureAudit: auditPublicExposure({ profile: buildProfile, files }),
  };
}

export function normalizeCaptureToCampaignSpec(
  capture: PageCapture,
  brand: BrandSpec = extractBrandSpec(capture),
  options: CompileOptions = {}
): CampaignPageSpec {
  const title = options.title ?? capture.title ?? inferTitle(capture) ?? "Migrated campaign page";
  const candidates = capture.sectionCandidates ?? inferSectionCandidates(capture);
  const sections = normalizeSections(capture, candidates);
  const strategy = capture.contentStrategyExtraction ?? createContentStrategyExtraction(capture, candidates);
  const primaryCTA = sections.find((section) => section.primaryCta)?.primaryCta?.label ?? strategy.ctaHints[0];
  const offer: NonNullable<CampaignPageSpec["contentStrategy"]["offer"]> = {
    promise: sections[0]?.heading ?? strategy.offerHints[0] ?? title,
  };
  if (primaryCTA) offer.primaryCTA = primaryCTA;

  return {
    id: `page-${hashish(capture.url)}`,
    title,
    slug: "/",
    goal: strategy.goal,
    brand,
    contentStrategy: {
      goal: strategy.goal,
      ...(strategy.audienceHints[0] ? { audience: { segment: strategy.audienceHints[0] } } : {}),
      offer,
    },
    seo: {
      title,
      description: sections[0]?.body ?? strategy.offerHints[1] ?? "Portable campaign page generated by Stitch.",
      canonical: capture.url,
    },
    sections,
    integrations: {
      forms: capture.detected.forms.map((form, index) => {
        const item: FormIntegrationItem = {
          id: `form-${index}`,
          provider: normalizeFormProvider(form.provider),
          protected: true,
        };
        if (form.action) item.destination = form.action;
        return item;
      }),
      analytics: capture.detected.analytics.map((analytics) => {
        const item: AnalyticsIntegrationItem = {
          provider: normalizeAnalyticsProvider(analytics.provider),
          protected: true,
        };
        if (analytics.id) item.id = analytics.id;
        return item;
      }),
    },
  };
}

export function createMigrationReport(capture: PageCapture, spec: CampaignPageSpec, options: CompileOptions = {}): MigrationReport {
  const candidates = capture.sectionCandidates ?? inferSectionCandidates(capture);
  const brand = capture.brandExtraction ?? createBrandExtraction(capture);
  const contentStrategy = capture.contentStrategyExtraction ?? createContentStrategyExtraction(capture, candidates);
  const warnings = buildMigrationWarnings(capture, candidates);
  return {
    sourceUrl: capture.url,
    mode: options.mode ?? "semantic",
    confidence: estimateMigrationConfidence(capture, spec, candidates, brand, contentStrategy),
    candidates,
    brand,
    contentStrategy,
    preserved: ["visible copy", "primary CTA intent", "forms as protected integrations", "analytics as protected metadata", "brand color/font hints", "source provenance"],
    normalized: ["section roles", "content strategy slots", "semantic brand tokens", "component recipes", "safe edit policies", "build profile boundary", "portable project state", "event history"],
    ignored: ["arbitrary wrapper divs", "platform-specific plugins", "unverified animation details", "hidden form values", "cookies/localStorage/network bodies"],
    warnings,
  };
}

export function extractBrandSpec(capture: PageCapture): BrandSpec {
  const extraction = capture.brandExtraction ?? createBrandExtraction(capture);
  const brand = createDefaultBrandSpec(inferDomainName(capture.url));
  const [primaryColor] = extraction.colors;
  if (primaryColor) {
    brand.colors.brand = primaryColor;
    brand.colors.accent = primaryColor;
  }
  const [font] = extraction.fonts;
  if (font) {
    brand.typography.body = font;
    brand.typography.heading = font;
    brand.typography.display = font;
  }
  return brand;
}

export function generateReactCampaignFiles(spec: CampaignPageSpec, options: RenderOptions & { feedbackTransports?: FeedbackTransportConfig[] } = {}): GeneratedFile[] {
  const buildProfile = options.buildProfile ?? (options.includeCapsule === false ? "production" : "owner");
  const packageJson = {
    name: slugify(spec.title),
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
    dependencies: {
      "@vitejs/plugin-react": "latest",
      vite: "latest",
      typescript: "latest",
      react: "latest",
      "react-dom": "latest",
    },
    devDependencies: {},
  };

  const deployManifest = { ...createDefaultDeploymentManifest(), profile: buildProfile };
  const feedbackConfig = createFeedbackTransportConfig(options.feedbackTransports, buildProfile);
  const projectState = createInitialProjectState(spec);
  const files: GeneratedFile[] = [
    { path: "package.json", role: "config", public: false, contents: JSON.stringify(packageJson, null, 2) + "\n" },
    { path: "index.html", role: "source", public: true, contents: renderIndexHtml(buildProfile) },
    { path: "src/main.jsx", role: "source", public: false, contents: renderMainSource() },
    { path: "src/Page.jsx", role: "source", public: false, contents: renderPageComponent(spec) },
    { path: "src/styles.css", role: "style", public: true, contents: renderCss(spec.brand) },
    { path: "stitch/page.spec.json", role: "spec", public: false, contents: JSON.stringify(spec, null, 2) + "\n" },
    { path: "stitch/brand.spec.json", role: "spec", public: false, contents: JSON.stringify(spec.brand, null, 2) + "\n" },
    { path: "stitch/content.strategy.json", role: "spec", public: false, contents: JSON.stringify(spec.contentStrategy, null, 2) + "\n" },
    { path: "stitch/project.state.json", role: "spec", public: false, contents: JSON.stringify(projectState, null, 2) + "\n" },
    { path: "stitch/events.json", role: "spec", public: false, contents: JSON.stringify(projectState.events, null, 2) + "\n" },
    { path: "stitch/provenance.json", role: "spec", public: false, contents: JSON.stringify(projectState.provenance, null, 2) + "\n" },
    { path: "stitch/deploy-manifest.json", role: "manifest", public: false, contents: JSON.stringify(deployManifest, null, 2) + "\n" },
    { path: "stitch/feedback-transports.json", role: "manifest", public: false, contents: JSON.stringify(feedbackConfig, null, 2) + "\n" },
  ];

  files.push(
    ...createCapsuleFiles(spec, deployManifest, { buildProfile }).map((file) => ({
      ...file,
      role: inferFileRole(file.path),
      public: isPublicFile(file.path, buildProfile),
    }))
  );

  return files;
}

export function regenerateReactFromSpec(spec: CampaignPageSpec, options: RenderOptions = {}): GeneratedFile[] {
  return generateReactCampaignFiles(spec, options);
}

export function renderReactFilesFromSpec(spec: CampaignPageSpec): GeneratedFile[] {
  return generateReactCampaignFiles(spec, { buildProfile: "production" }).filter((file) => file.path.startsWith("src/") || file.path === "index.html");
}

export function createGeneratedFileManifest(input: CampaignPageSpec | GeneratedFile[]): GeneratedFileManifestItem[] {
  const files = Array.isArray(input) ? input : generateReactCampaignFiles(input, { buildProfile: "owner" });
  return files.map((file) => ({
    path: file.path,
    bytes: new TextEncoder().encode(file.contents).length,
    role: file.role ?? inferFileRole(file.path),
    public: file.public ?? isPublicFile(file.path, "owner"),
  }));
}

export function renderPageHtmlFromSpec(spec: CampaignPageSpec): string {
  return spec.sections.map((section) => renderSection(section)).join("\n");
}

function normalizeSections(capture: PageCapture, candidates: SectionCandidate[]): SectionSpec[] {
  const capturedSections = capture.sections ?? [];
  const specs: SectionSpec[] = [];
  const usedTypes = new Set<string>();

  for (const candidate of candidates) {
    const captured = capturedSections.find((section) => section.id === candidate.capturedSectionId);
    const spec = captured ? createSectionFromCandidate(capture, captured, candidate) : undefined;
    if (!spec) continue;
    const key = `${spec.type}:${spec.heading ?? spec.body ?? spec.id}`;
    if (usedTypes.has(key)) continue;
    usedTypes.add(key);
    specs.push(withSectionDefaults(spec));
  }

  if (specs.length === 0) return fallbackSections(capture);
  const hasHero = specs.some((section) => section.type === "Hero");
  if (!hasHero) specs.unshift(fallbackHero(capture));
  const hasFinalCta = specs.some((section) => section.type === "FinalCTA");
  if (!hasFinalCta) specs.push(fallbackFinalCta(capture, specs[0]));
  return specs.slice(0, 12);
}

function createSectionFromCandidate(capture: PageCapture, section: CapturedSection, candidate: SectionCandidate): SectionSpec | undefined {
  const heading = section.heading ?? section.text[0];
  const body = section.text.find((text) => text !== heading && text.length > 32) ?? section.text.find((text) => text !== heading);
  const cta = findCta(section, capture);
  const base = {
    id: sectionId(candidate.type, section.index),
    type: candidate.type,
    strategyRoles: candidate.strategyRoles,
    source: {
      originalUrl: capture.url,
      originalDomPath: section.domPath,
      originalText: section.text.join("\n"),
      capturedSectionId: section.id,
      migrationConfidence: candidate.confidence,
      migrationReason: candidate.reason,
    },
  } satisfies Pick<SectionSpec, "id" | "type" | "strategyRoles" | "source">;

  if (candidate.type === "Hero") {
    return cleanSection({ ...base, variant: section.images.length > 0 ? "splitMediaRight" : "centered", heading, body, primaryCta: cta });
  }
  if (candidate.type === "LogoCloud") {
    return cleanSection({ ...base, variant: "grid", heading: heading ?? "Trusted by teams", items: section.images.map((image, index) => ({ id: `logo-${index + 1}`, name: image.alt ?? `Logo ${index + 1}`, image: image.src })) });
  }
  if (candidate.type === "Benefits" || candidate.type === "FeatureGrid") {
    return cleanSection({ ...base, variant: candidate.type === "Benefits" ? "cards" : "threeColumn", heading: heading ?? (candidate.type === "Benefits" ? "Benefits" : "Features"), body, items: createCardItems(section) });
  }
  if (candidate.type === "Testimonials") {
    return cleanSection({ ...base, variant: "cards", heading: heading ?? "What customers say", items: section.text.slice(0, 3).map((quote, index) => ({ id: `testimonial-${index + 1}`, quote, personName: "Customer", company: "Migrated source" })) });
  }
  if (candidate.type === "FAQ") {
    return cleanSection({ ...base, variant: "accordion", heading: heading ?? "Questions", items: createFaqItems(section) });
  }
  if (candidate.type === "FinalCTA") {
    return cleanSection({ ...base, variant: "contrast", heading: heading ?? "Ready to get started?", body, primaryCta: cta });
  }
  if (candidate.type === "Footer") {
    return cleanSection({ ...base, variant: "minimal", heading: heading ?? "Footer", items: section.links.map((link, index) => ({ id: `footer-link-${index + 1}`, label: link.label, href: link.href })) });
  }
  return cleanSection({ ...base, variant: "default", heading, body, items: createCardItems(section) });
}

function createCardItems(section: CapturedSection): Array<Record<string, unknown>> {
  const texts = section.text.filter((text) => text !== section.heading).slice(0, 6);
  const items: Array<Record<string, unknown>> = [];
  for (let index = 0; index < texts.length; index += 2) {
    const title = texts[index];
    if (!title) continue;
    const description = texts[index + 1] ?? "Migrated supporting detail pending owner review.";
    items.push({ id: `item-${items.length + 1}`, title: title.length < 90 ? title : `Item ${items.length + 1}`, description });
  }
  return items.length > 0 ? items : [{ id: "item-1", title: section.heading ?? "Migrated item", description: section.text[0] ?? "Migrated supporting detail." }];
}

function createFaqItems(section: CapturedSection): Array<Record<string, unknown>> {
  const questions = section.text.filter((text) => text.includes("?")).slice(0, 6);
  if (questions.length === 0) return [{ id: "faq-1", question: section.heading ?? "Question", answer: "Migrated answer pending owner review." }];
  return questions.map((question, index) => ({ id: `faq-${index + 1}`, question, answer: "Migrated answer pending owner review." }));
}

function findCta(section: CapturedSection, capture: PageCapture): CtaSpec {
  const link = section.links.find((item) => /get|start|book|contact|download|try|join|learn|audit|demo|sign up|schedule/i.test(item.label));
  if (link) return { label: link.label, href: link.href, variant: "primary" };
  const text = section.text.find((value) => /get|start|book|contact|download|try|join|learn|audit|demo|sign up|schedule/i.test(value));
  return { label: text ?? "Get started", href: capture.detected.forms[0]?.action ?? "#contact", variant: "primary" };
}

function fallbackSections(capture: PageCapture): SectionSpec[] {
  const hero = fallbackHero(capture);
  return [hero, fallbackFinalCta(capture, hero)];
}

function fallbackHero(capture: PageCapture): SectionSpec {
  const heading = capture.visibleText[0] ?? capture.title ?? "Campaign headline";
  const body = capture.visibleText.find((text) => text !== heading && text.length > 30) ?? capture.visibleText[1];
  return withSectionDefaults(cleanSection({
    id: "hero",
    type: "Hero",
    variant: "centered",
    strategyRoles: ["audience", "promise", "cta"],
    heading,
    body,
    primaryCta: { label: capture.contentStrategyExtraction?.ctaHints[0] ?? "Get started", href: capture.detected.forms[0]?.action ?? "#contact", variant: "primary" },
    source: { originalUrl: capture.url, originalText: capture.visibleText.slice(0, 4).join("\n"), migrationConfidence: 0.42, migrationReason: "Fallback hero from first visible text." },
  }));
}

function fallbackFinalCta(capture: PageCapture, hero?: SectionSpec): SectionSpec {
  return withSectionDefaults(cleanSection({
    id: "final-cta",
    type: "FinalCTA",
    variant: "contrast",
    strategyRoles: ["promise", "cta", "riskReversal"],
    heading: hero?.heading ?? capture.visibleText[0] ?? "Ready to get started?",
    body: "Take the next step with this campaign.",
    primaryCta: hero?.primaryCta ?? { label: "Get started", href: capture.detected.forms[0]?.action ?? "#contact", variant: "primary" },
    source: { originalUrl: capture.url, migrationConfidence: 0.5, migrationReason: "Fallback final CTA generated from page CTA hints." },
  }));
}

function inferSectionCandidates(capture: PageCapture): SectionCandidate[] {
  const sections = capture.sections ?? [];
  if (sections.length === 0) {
    return [
      { id: "candidate-fallback-hero", type: "Hero", confidence: 0.42, reason: "No captured sections; fallback hero from visible text.", strategyRoles: ["audience", "promise", "cta"], sourceText: capture.visibleText.slice(0, 5) },
    ];
  }
  return sections.map((section, index) => {
    if (index === 0) return makeCandidate(section, "Hero", 0.82, "First substantial captured section.", ["audience", "promise", "cta"]);
    if (section.hints.hasQuestions) return makeCandidate(section, "FAQ", 0.76, "Question-like copy detected.", ["objection", "trust"]);
    if (section.hints.hasQuote) return makeCandidate(section, "Testimonials", 0.72, "Proof/testimonial language detected.", ["proof", "trust"]);
    if (section.images.length >= 3 && section.text.length <= 6) return makeCandidate(section, "LogoCloud", 0.68, "Repeated images with limited text.", ["trust", "proof"]);
    if (section.hints.hasCards) return makeCandidate(section, index < 3 ? "Benefits" : "FeatureGrid", 0.64, "Repeated content suggests benefits/features.", ["benefit", "outcome", "differentiator"]);
    if (section.hints.hasCta || index === sections.length - 1) return makeCandidate(section, "FinalCTA", 0.62, "CTA language or final section position.", ["promise", "cta", "riskReversal"]);
    return makeCandidate(section, "Custom", 0.42, "Captured but not confidently canonical.", []);
  });
}

function makeCandidate(section: CapturedSection, type: SectionType, confidence: number, reason: string, strategyRoles: StrategyRole[]): SectionCandidate {
  return { id: `candidate-${section.id}`, capturedSectionId: section.id, type, confidence, reason, strategyRoles, sourceText: section.text.slice(0, 8) };
}

function createBrandExtraction(capture: PageCapture): BrandExtraction {
  return {
    colors: capture.styles.colors,
    fonts: capture.styles.fonts,
    classNames: capture.styles.classNames,
    confidence: Number((0.35 + Math.min(0.4, capture.styles.colors.length / 10) + Math.min(0.25, capture.styles.fonts.length / 4)).toFixed(2)),
    warnings: capture.styles.colors.length === 0 ? ["No explicit color hints found."] : [],
  };
}

function createContentStrategyExtraction(capture: PageCapture, candidates: SectionCandidate[]): ContentStrategyExtraction {
  const ctaHints = capture.visibleText.filter((text) => /get|start|book|contact|download|try|join|learn|audit|demo|sign up|schedule/i.test(text)).slice(0, 6);
  const proofHints = capture.visibleText.filter((text) => /trusted|customer|client|results|case study|testimonial|loved/i.test(text)).slice(0, 6);
  return {
    goal: ctaHints.some((text) => /book|demo|audit|contact|schedule/i.test(text)) ? "bookCall" : "lead",
    audienceHints: capture.visibleText.filter((text) => /for\s+|teams|agencies|founders|marketers|developers/i.test(text)).slice(0, 4),
    offerHints: capture.visibleText.slice(0, 6),
    ctaHints,
    proofHints,
    confidence: Number((0.4 + Math.min(0.25, ctaHints.length / 8) + Math.min(0.2, candidates.length / 8) + Math.min(0.15, proofHints.length / 8)).toFixed(2)),
  };
}


function createFeedbackTransportConfig(transports: FeedbackTransportConfig[] | undefined, buildProfile: BuildProfile): { enabled: boolean; transports: FeedbackTransportConfig[]; notes: string[] } {
  if (buildProfile === "production") {
    return { enabled: false, transports: [], notes: ["Production bundles do not enable review feedback transport by default."] };
  }
  const defaults: FeedbackTransportConfig[] = [
    { kind: "local", localPinsKey: "stitch:pins" },
    { kind: "download", fileName: "stitch-feedback.json" },
    { kind: "mailto" },
  ];
  return {
    enabled: true,
    transports: transports && transports.length > 0 ? transports : defaults,
    notes: [
      "Feedback transport is user-owned. Stitch does not host a review inbox.",
      "Imported feedback remains untrusted until the owner reviews it in the capsule.",
    ],
  };
}

function createBundleWarnings(spec: CampaignPageSpec, files: GeneratedFile[], buildProfile: BuildProfile): PublishWarning[] {
  const warnings: PublishWarning[] = [];
  if (buildProfile === "owner") warnings.push({ code: "owner-capsule-included", severity: "warning", message: "Owner workbench is included. Use this profile only for private preview or local owner workflows." });
  if (buildProfile === "review") warnings.push({ code: "review-runtime-included", severity: "info", message: "Review runtime is included for comment-only feedback capture." });
  for (const form of spec.integrations?.forms ?? []) if (!form.destination) warnings.push({ code: "unknown-form-destination", severity: "warning", message: `Form ${form.id} has no verified destination.` });
  for (const section of spec.sections) if (section.primaryCta && (!section.primaryCta.href || section.primaryCta.href === "#")) warnings.push({ code: "missing-cta-href", severity: "warning", message: `CTA in section ${section.id} has no final href.` });
  if (files.some((file) => /<script(?! type="module"| defer src="\/stitch\/review-runtime\.js")/i.test(file.contents))) warnings.push({ code: "external-script", severity: "warning", message: "Generated files contain script tags. Review before publishing." });
  return warnings;
}

function buildMigrationWarnings(capture: PageCapture, candidates: SectionCandidate[]): MigrationWarning[] {
  const warnings: MigrationWarning[] = [{ code: "pixel-perfect-not-guaranteed", severity: "info", message: "Phase 5 performs semantic migration, not pixel-perfect cloning." }];
  if (capture.visibleText.length < 4) warnings.push({ code: "low-text", severity: "warning", message: "Low visible text count; migration confidence may be limited." });
  if (capture.detected.forms.some((form) => !form.action)) warnings.push({ code: "unknown-form-destination", severity: "warning", message: "A form was detected without a verified destination." });
  if (capture.detected.analytics.length > 0) warnings.push({ code: "analytics-detected", severity: "info", message: "Analytics were detected and preserved as protected integration metadata." });
  if (capture.assets.some((asset) => asset.type === "image")) warnings.push({ code: "assets-not-downloaded", severity: "info", message: "Image assets are referenced but not downloaded in Phase 5." });
  if (candidates.some((candidate) => candidate.confidence < 0.5)) warnings.push({ code: "low-section-confidence", severity: "warning", message: "Some captured sections could not be confidently mapped to canonical recipes." });
  return warnings;
}

function withSectionDefaults(section: SectionSpec): SectionSpec {
  return { ...section, elements: createSectionElements(section), editPolicy: createSectionEditPolicy(section) };
}

function createSectionElements(section: SectionSpec): SectionElementSpec[] {
  const elements: SectionElementSpec[] = [];
  if (section.eyebrow) elements.push({ id: `${section.id}.eyebrow`, role: "eyebrow", type: "Badge", text: section.eyebrow, sourceField: "eyebrow" });
  if (section.heading) elements.push({ id: `${section.id}.heading`, role: "heading", type: "Heading", text: section.heading, sourceField: "heading" });
  if (section.body) elements.push({ id: `${section.id}.body`, role: "body", type: "Text", text: section.body, sourceField: "body" });
  if (section.primaryCta) elements.push({ id: `${section.id}.primaryCta`, role: "primaryCta", type: "Button", label: section.primaryCta.label, sourceField: "primaryCta.label" });
  if (section.secondaryCta) elements.push({ id: `${section.id}.secondaryCta`, role: "secondaryCta", type: "Button", label: section.secondaryCta.label, sourceField: "secondaryCta.label" });
  return elements;
}

function createSectionEditPolicy(section: SectionSpec): SectionEditPolicy {
  return {
    safeOperations: section.type === "Pricing" ? ["editCopy", "changeCtaLabel", "changeVariant"] : ["editCopy", "changeCtaLabel", "changeVariant", "changeEmphasis", "reorderItems"],
    requiresApproval: section.type === "Pricing" ? ["editHref", "editPrice", "changeIntegration"] : ["editHref", "replaceMedia", "editPrice", "editLegal", "changeIntegration"],
    blockedOperations: ["injectScript", "javascriptHref", "hiddenDataCapture", "unauthorizedPublish"],
  };
}

function renderIndexHtml(buildProfile: BuildProfile): string {
  const reviewScript = buildProfile === "production" ? "" : '<script defer src="/stitch/review-runtime.js"></script>';
  return `<div id="root"></div><script type="module" src="/src/main.jsx"></script>${reviewScript}\n`;
}

function renderMainSource(): string {
  return `import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { Page } from './Page.jsx';\nimport './styles.css';\n\ncreateRoot(document.getElementById('root')).render(<Page />);\n`;
}

function renderPageComponent(spec: CampaignPageSpec): string {
  return `export function Page() {\n  return (\n    <main data-stitch-page-id=${JSON.stringify(spec.id)} data-stitch-contract-version="0.1.0">\n${spec.sections.map(renderSection).join("\n")}\n    </main>\n  );\n}\n`;
}

function renderSection(section: SectionSpec): string {
  const variant = section.variant ?? "default";
  const items = section.items ?? [];
  return `      <section className="section section-${escapeAttribute(section.type.toLowerCase())} variant-${escapeAttribute(variant)}" data-stitch-section-id=${JSON.stringify(section.id)} data-stitch-section-type=${JSON.stringify(section.type)}>
        <div className="container">
${section.eyebrow ? `          <p className="eyebrow" data-stitch-element-id="eyebrow" data-stitch-element-type="Badge">${escapeJsx(section.eyebrow)}</p>\n` : ""}${section.heading ? `          <h2 data-stitch-element-id="heading" data-stitch-element-type="Heading">${escapeJsx(section.heading)}</h2>\n` : ""}${section.body ? `          <p className="lead" data-stitch-element-id="body" data-stitch-element-type="Text">${escapeJsx(section.body)}</p>\n` : ""}${renderItems(section, items)}${section.primaryCta ? renderCta(section.primaryCta, "primaryCta") : ""}${section.secondaryCta ? renderCta(section.secondaryCta, "secondaryCta") : ""}        </div>
      </section>`;
}

function renderItems(section: SectionSpec, items: Array<Record<string, unknown>>): string {
  if (items.length === 0) return "";
  return `          <div className="grid" data-stitch-element-id="items" data-stitch-element-type="List">\n${items.map((item, index) => renderItem(section, item, index)).join("\n")}\n          </div>\n`;
}

function renderItem(section: SectionSpec, item: Record<string, unknown>, index: number): string {
  const title = String(item.title ?? item.question ?? item.personName ?? item.value ?? item.name ?? `Item ${index + 1}`);
  const description = String(item.description ?? item.answer ?? item.quote ?? item.label ?? "");
  return `            <article className="card" data-stitch-element-id="item-${index + 1}" data-stitch-element-type="Card" data-stitch-section-type=${JSON.stringify(section.type)}>
              <h3>${escapeJsx(title)}</h3>
              ${description ? `<p>${escapeJsx(description)}</p>` : ""}
            </article>`;
}

function renderCta(cta: CtaSpec, elementId: "primaryCta" | "secondaryCta"): string {
  const variant = cta.variant ?? (elementId === "primaryCta" ? "primary" : "secondary");
  return `          <a className="button button-${variant}" href=${JSON.stringify(cta.href)} data-stitch-element-id=${JSON.stringify(elementId)} data-stitch-element-type="Button">${escapeJsx(cta.label)}</a>\n`;
}

function renderCss(brand: BrandSpec): string {
  const colors = brand.colors;
  return `:root {
  --stitch-canvas: ${colors.canvas ?? "#ffffff"};
  --stitch-surface: ${colors.surface ?? "#ffffff"};
  --stitch-surface-alt: ${colors.surfaceAlt ?? "#f8fafc"};
  --stitch-text: ${colors.text ?? "#0f172a"};
  --stitch-muted: ${colors.textMuted ?? "#475569"};
  --stitch-border: ${colors.border ?? "#e2e8f0"};
  --stitch-brand: ${colors.brand ?? "#2563eb"};
  --stitch-brand-contrast: ${colors.brandContrast ?? "#ffffff"};
  font-family: ${JSON.stringify(brand.typography.body ?? "Inter")}, system-ui, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--stitch-canvas); color: var(--stitch-text); }
.section { padding: 88px 24px; border-bottom: 1px solid var(--stitch-border); }
.variant-muted { background: var(--stitch-surface-alt); }
.variant-brand, .variant-featured, .variant-contrast { background: var(--stitch-brand); color: var(--stitch-brand-contrast); }
.container { max-width: 1120px; margin: 0 auto; }
h2 { font-size: clamp(2rem, 5vw, 4.5rem); line-height: .95; letter-spacing: -0.05em; margin: 0 0 20px; }
h3 { margin: 0 0 8px; }
.lead { max-width: 720px; color: var(--stitch-muted); font-size: 1.25rem; line-height: 1.6; }
.variant-brand .lead, .variant-featured .lead, .variant-contrast .lead { color: inherit; opacity: .9; }
.eyebrow { font-size: .78rem; text-transform: uppercase; letter-spacing: .14em; color: var(--stitch-brand); font-weight: 700; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; margin: 32px 0; }
.card { border: 1px solid var(--stitch-border); border-radius: 18px; padding: 24px; background: var(--stitch-surface); color: var(--stitch-text); }
.button { display: inline-flex; align-items: center; justify-content: center; margin-top: 18px; margin-right: 12px; min-height: 44px; padding: 0 18px; border-radius: 999px; text-decoration: none; font-weight: 700; border: 1px solid var(--stitch-brand); }
.button-primary { background: var(--stitch-brand); color: var(--stitch-brand-contrast); }
.button-secondary, .button-neutral, .button-ghost { color: var(--stitch-brand); background: transparent; }
`;
}

function estimateMigrationConfidence(capture: PageCapture, spec: CampaignPageSpec, candidates: SectionCandidate[], brand: BrandExtraction, strategy: ContentStrategyExtraction): number {
  const textScore = Math.min(0.25, capture.visibleText.length / 80);
  const sectionScore = Math.min(0.25, candidates.reduce((sum, candidate) => sum + candidate.confidence, 0) / Math.max(1, candidates.length) / 4);
  const specScore = Math.min(0.2, spec.sections.length / 30);
  const brandScore = brand.confidence * 0.15;
  const strategyScore = strategy.confidence * 0.15;
  return Number((textScore + sectionScore + specScore + brandScore + strategyScore).toFixed(2));
}

function inferTitle(capture: PageCapture): string | undefined {
  return capture.visibleText.find((value) => value.length > 4 && value.length < 90);
}

function inferDomainName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Migrated Brand";
  }
}

function normalizeAnalyticsProvider(provider: string): AnalyticsIntegrationItem["provider"] {
  if (/ga4|google/i.test(provider)) return "ga4";
  if (/plausible/i.test(provider)) return "plausible";
  if (/posthog/i.test(provider)) return "posthog";
  if (/meta|facebook/i.test(provider)) return "meta";
  if (/linkedin/i.test(provider)) return "linkedin";
  return "unknown";
}

function normalizeFormProvider(provider: string): FormIntegrationItem["provider"] {
  if (/hubspot/i.test(provider)) return "hubspot";
  if (/typeform/i.test(provider)) return "typeform";
  if (/formspree/i.test(provider)) return "formspree";
  if (/netlify/i.test(provider)) return "netlify";
  if (/html/i.test(provider)) return "html";
  return "unknown";
}

function cleanSection(section: SectionSpec): SectionSpec {
  const next: SectionSpec = { ...section };
  if (!next.heading) delete next.heading;
  if (!next.body) delete next.body;
  if (!next.items || next.items.length === 0) delete next.items;
  if (!next.primaryCta) delete next.primaryCta;
  return next;
}

function sectionId(type: SectionType, index: number): string {
  return `${type.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}-${index}`;
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "stitch-campaign-site";
}

function hashish(value: string): string {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash.toString(16);
}

function escapeJsx(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

function inferFileRole(path: string): NonNullable<GeneratedFile["role"]> {
  if (path.includes("capsule") || path.includes("_stitch") || path.includes("review-runtime")) return "capsule";
  if (path.endsWith(".css")) return "style";
  if (path.includes("stitch/") && path.endsWith(".json")) return path.includes("manifest") ? "manifest" : "spec";
  if (path.endsWith("package.json") || path.endsWith(".config.js") || path.endsWith(".config.ts")) return "config";
  if (path.startsWith("public/") && !path.includes("_stitch") && !path.includes("review-runtime")) return "asset";
  return "source";
}

function isPublicFile(path: string, profile: BuildProfile): boolean {
  if (path.startsWith("public/_stitch")) return profile === "owner";
  if (path.includes("review-runtime")) return profile === "review" || profile === "owner";
  if (path.startsWith("stitch/")) return false;
  if (path.startsWith("src/")) return false;
  if (path === "package.json") return false;
  return true;
}

export type RefinedMigrationBundle = GeneratedSiteBundle & {
  report: MigrationReport;
  deterministicSpec: CampaignPageSpec;
  refinedSpec: CampaignPageSpec;
  refinement?: MigrationRefinement;
  appliedOperations: SpecOperation[];
  rejectedOperations: SpecOperation[];
  inferenceTrace?: InferenceRefinementTrace;
};

export async function compileCaptureWithInference(capture: PageCapture, options: CompileOptions = {}): Promise<RefinedMigrationBundle> {
  const deterministicSpec = normalizeCaptureToCampaignSpec(capture, extractBrandSpec(capture), options);
  const report = createMigrationReport(capture, deterministicSpec, options);

  if (!options.refine || !options.inferenceProvider) {
    const portable = createPortableSiteBundle(deterministicSpec, { buildProfile: options.buildProfile ?? "owner" });
    return {
      ...portable,
      report,
      deterministicSpec,
      refinedSpec: deterministicSpec,
      appliedOperations: [],
      rejectedOperations: [],
    };
  }

  const refinementResult = await refineMigrationWithInference(capture, deterministicSpec, report, options.inferenceProvider);
  const portable = createPortableSiteBundle(refinementResult.refinedSpec, { buildProfile: options.buildProfile ?? "owner" });
  return {
    ...portable,
    report,
    deterministicSpec,
    refinedSpec: refinementResult.refinedSpec,
    refinement: refinementResult.refinement,
    appliedOperations: refinementResult.appliedOperations,
    rejectedOperations: refinementResult.rejectedOperations,
    inferenceTrace: refinementResult.trace,
  };
}

export async function refineMigrationWithInference(
  capture: PageCapture,
  spec: CampaignPageSpec,
  report: MigrationReport,
  inferenceProvider: ContractInferenceProvider
): Promise<{
  refinedSpec: CampaignPageSpec;
  refinement: MigrationRefinement;
  appliedOperations: SpecOperation[];
  rejectedOperations: SpecOperation[];
  trace: InferenceRefinementTrace;
}> {
  const response = await inferenceProvider.structured<MigrationRefinement>({
    task: "refineMigration",
    schemaName: "MigrationRefinement",
    input: {
      captureSummary: {
        url: capture.url,
        title: capture.title,
        visibleText: capture.visibleText.slice(0, 40),
        sectionCandidates: report.candidates,
        brand: report.brand,
        contentStrategy: report.contentStrategy,
      },
      spec,
      report,
    },
    instructions: [
      "Return only contract-safe SpecOperation objects.",
      "Prefer copy, CTA label, SEO description, and content strategy refinements.",
      "Never propose form destination, analytics, script, pricing, or legal changes.",
    ].join("\n"),
    metadata: { contract: "design-contract.v0", policy: "contract-constrained-inference-v0" },
  });

  const refinement = normalizeMigrationRefinement(response.output, response.operations ?? []);
  const applied = applySpecOperations(spec, refinement.operations);
  return {
    refinedSpec: applied.spec,
    refinement,
    appliedOperations: applied.accepted,
    rejectedOperations: applied.rejected,
    trace: {
      provider: response.provider,
      task: response.task,
      acceptedOperations: applied.accepted.length,
      rejectedOperations: applied.rejected.length,
      warnings: [...response.warnings, ...refinement.warnings],
    },
  };
}

function normalizeMigrationRefinement(output: MigrationRefinement | unknown, fallbackOperations: SpecOperation[]): MigrationRefinement {
  if (isMigrationRefinement(output)) return output;
  return {
    summary: "Inference provider did not return a complete MigrationRefinement shape; using operations attached to the response.",
    operations: fallbackOperations,
    confidence: fallbackOperations.length > 0 ? 0.5 : 0,
    preserved: ["brand", "integrations", "section order"],
    warnings: fallbackOperations.length > 0 ? [] : ["No valid refinement operations were returned."],
  };
}

function isMigrationRefinement(value: unknown): value is MigrationRefinement {
  return typeof value === "object" && value !== null && Array.isArray((value as { operations?: unknown }).operations) && typeof (value as { summary?: unknown }).summary === "string";
}


export function compileProjectToExportArtifact(project: StitchProject, profile: ExportProfile = project.activeProfile): ExportArtifact {
  const bundle = profile === project.bundle.buildProfile ? project.bundle : createPortableSiteBundle(project.state.spec, { buildProfile: profile === "source" ? "owner" : profile });
  const latestEventId = project.state.events.at(-1)?.id;
  const hydratedBundle = {
    ...bundle,
    sourceStateVersion: project.state.version,
    ...(latestEventId ? { generatedFromEventId: latestEventId } : {}),
    provenance: project.state.provenance,
  };
  return createExportArtifact(hydratedBundle, { profile, project });
}

export function compileBootstrapToExportArtifact(bootstrap: MigrationBootstrap, options: ProjectInstallOptions & { exportProfile?: ExportProfile } = {}): ExportArtifact {
  const exportProfile = options.exportProfile ?? getBootstrapBuildProfile(bootstrap);
  const validation = validateBootstrapForOwnership(bootstrap);
  assertBootstrapCompilationAllowed(validation, exportProfile === "source" ? "owner" : exportProfile, options);
  const project = createStitchProjectFromBootstrap(bootstrap, options);
  return compileProjectToExportArtifact(project, exportProfile);
}

export function compileExportArtifactToDeployPackage(artifact: ExportArtifact, provider: DeployProvider = "cloudflarePages", project?: StitchProject): DeployPackage {
  return createDeployPackage(artifact, { provider, ...(project ? { project } : {}) });
}

export function compileProjectToDeployPackage(project: StitchProject, provider: DeployProvider = "cloudflarePages", profile: ExportProfile = "production"): DeployPackage {
  const artifact = compileProjectToExportArtifact(project, profile);
  return compileExportArtifactToDeployPackage(artifact, provider, project);
}

export function compileBootstrapToDeployPackage(
  bootstrap: MigrationBootstrap,
  options: ProjectInstallOptions & { exportProfile?: ExportProfile; provider?: DeployProvider } = {}
): DeployPackage {
  const exportProfile = options.exportProfile ?? "production";
  const validation = validateBootstrapForOwnership(bootstrap);
  assertBootstrapCompilationAllowed(validation, exportProfile === "source" ? "owner" : exportProfile, options);
  const project = createStitchProjectFromBootstrap(bootstrap, options);
  return compileProjectToDeployPackage(project, options.provider ?? "cloudflarePages", exportProfile);
}

export function compileProjectToPublicExposureAudit(project: StitchProject, profile: ExportProfile = project.activeProfile): PublicExposureAudit {
  const artifact = compileProjectToExportArtifact(project, profile);
  return auditPublicExposure({ profile, files: artifact.files });
}

export function compileBootstrapToPublicExposureAudit(
  bootstrap: MigrationBootstrap,
  options: ProjectInstallOptions & { exportProfile?: ExportProfile } = {}
): PublicExposureAudit {
  const project = createStitchProjectFromBootstrap(bootstrap, options);
  return compileProjectToPublicExposureAudit(project, options.exportProfile ?? project.activeProfile);
}


// Phase 14: compiler-level materialization helpers.
export function compileExportArtifactToMaterializedArtifact(artifact: ExportArtifact, options: { format?: ArtifactFormat; fileName?: string } = {}): MaterializedArtifact {
  return materializeExportArtifact(artifact, options);
}

export function compileProjectToMaterializedArtifact(
  project: StitchProject,
  profile: ExportProfile = "production",
  options: { format?: ArtifactFormat; fileName?: string } = {}
): MaterializedArtifact {
  const artifact = compileProjectToExportArtifact(project, profile);
  return compileExportArtifactToMaterializedArtifact(artifact, options);
}

export function compileBootstrapToMaterializedArtifact(
  bootstrap: MigrationBootstrap,
  options: ProjectInstallOptions & { exportProfile?: ExportProfile; format?: ArtifactFormat; fileName?: string } = {}
): MaterializedArtifact {
  const exportProfile = options.exportProfile ?? "production";
  const validation = validateBootstrapForOwnership(bootstrap);
  assertBootstrapCompilationAllowed(validation, exportProfile === "source" ? "owner" : exportProfile, options);
  const project = createStitchProjectFromBootstrap(bootstrap, options);
  return compileProjectToMaterializedArtifact(project, exportProfile, options);
}
