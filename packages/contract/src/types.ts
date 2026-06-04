export type Id = string;
export type ISODateString = string;

export type PageGoal =
  | "lead"
  | "signup"
  | "bookCall"
  | "purchase"
  | "download"
  | "waitlist"
  | "awareness"
  | "eventRegistration";

export type SectionType =
  | "Hero"
  | "LogoCloud"
  | "Problem"
  | "Benefits"
  | "FeatureGrid"
  | "HowItWorks"
  | "Testimonials"
  | "Stats"
  | "Offer"
  | "Pricing"
  | "FAQ"
  | "FinalCTA"
  | "Footer"
  | "Custom";

export type StrategyRole =
  | "audience"
  | "pain"
  | "promise"
  | "outcome"
  | "mechanism"
  | "benefit"
  | "differentiator"
  | "proof"
  | "objection"
  | "riskReversal"
  | "urgency"
  | "cta"
  | "trust"
  | "offer";

export type RiskLevel = "low" | "medium" | "high" | "blocked";

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Viewport = {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  label?: "mobile" | "tablet" | "desktop" | "unknown";
};

export type BrandSpec = {
  id: Id;
  name: string;
  colors: Record<string, string>;
  typography: {
    display?: string;
    heading?: string | undefined;
    body?: string | undefined;
    label?: string;
    mono?: string;
  };
  spacingDensity: "compact" | "comfortable" | "spacious";
  radius: "none" | "sm" | "md" | "lg" | "xl" | "full";
  voice: {
    formality: "casual" | "neutral" | "formal";
    energy: "calm" | "confident" | "urgent" | "bold";
    clarity: "plainspoken" | "specific" | "technical" | "aspirational";
    personality: "friendly" | "expert" | "premium" | "playful" | "direct";
  };
};

export type ContentStrategy = {
  goal: PageGoal;
  audience?: {
    segment?: string;
    role?: string;
    industry?: string;
    awarenessLevel?: "unaware" | "problemAware" | "solutionAware" | "productAware" | "mostAware";
    primaryPain?: string;
    desiredOutcome?: string;
    objections?: string[];
  };
  offer?: {
    type?: string;
    promise?: string;
    mechanism?: string;
    deliverable?: string;
    incentive?: string;
    urgency?: string;
    riskReversal?: string;
    primaryCTA?: string;
    secondaryCTA?: string;
  };
  channel?:
    | "googleAds"
    | "linkedinAds"
    | "metaAds"
    | "email"
    | "organicSearch"
    | "partner"
    | "event"
    | "salesOutbound"
    | "direct";
};

export type CtaSpec = {
  label: string;
  href: string;
  variant?: "primary" | "secondary" | "neutral" | "ghost" | "link";
};

export type SectionElementRole =
  | "eyebrow"
  | "heading"
  | "body"
  | "primaryCta"
  | "secondaryCta"
  | "media"
  | "item"
  | "testimonial"
  | "faqItem"
  | "link";

export type SectionElementType = "Heading" | "Text" | "Button" | "Link" | "Image" | "Badge" | "Card" | "List" | "Form" | "Icon" | "Unknown";

export type SectionElementSpec = {
  id: Id;
  role: SectionElementRole;
  type?: SectionElementType;
  label?: string;
  text?: string;
  sourceField?: string;
};

export type SectionEditPolicy = {
  safeOperations: Array<"editCopy" | "changeCtaLabel" | "changeVariant" | "changeEmphasis" | "reorderItems">;
  requiresApproval: Array<"editHref" | "replaceMedia" | "editPrice" | "editLegal" | "changeIntegration">;
  blockedOperations: Array<"injectScript" | "javascriptHref" | "hiddenDataCapture" | "unauthorizedPublish">;
};

export type SectionSpec = {
  id: Id;
  type: SectionType;
  variant?: string | undefined;
  strategyRoles?: StrategyRole[];
  eyebrow?: string | undefined;
  heading?: string | undefined;
  body?: string | undefined;
  primaryCta?: CtaSpec;
  secondaryCta?: CtaSpec;
  media?: {
    src: string;
    alt?: string;
    role?: "product" | "people" | "abstract" | "illustration" | "screenshot" | "logo" | "icon" | "background";
  };
  items?: Array<Record<string, unknown>>;
  elements?: SectionElementSpec[];
  editPolicy?: SectionEditPolicy;
  source?: {
    originalUrl?: string | undefined;
    originalDomPath?: string | undefined;
    originalText?: string | undefined;
    capturedSectionId?: Id | undefined;
    migrationConfidence?: number;
    migrationReason?: string | undefined;
  };
};

export type IntegrationManifest = {
  forms?: Array<{
    id: Id;
    provider: "unknown" | "html" | "hubspot" | "typeform" | "formspree" | "netlify" | "custom";
    destination?: string;
    protected: boolean;
  }>;
  analytics?: Array<{
    provider: "unknown" | "ga4" | "plausible" | "posthog" | "meta" | "linkedin" | "custom";
    id?: string;
    protected: boolean;
  }>;
};

export type CampaignPageSpec = {
  id: Id;
  title: string;
  slug: string;
  goal: PageGoal;
  brand: BrandSpec;
  contentStrategy: ContentStrategy;
  seo: {
    title: string;
    description: string;
    canonical?: string;
  };
  sections: SectionSpec[];
  integrations?: IntegrationManifest;
};

export type CapturedElementKind = "heading" | "text" | "link" | "button" | "image" | "form" | "listItem" | "unknown";

export type CapturedElement = {
  id: Id;
  kind: CapturedElementKind;
  tag: string;
  text?: string;
  href?: string;
  src?: string;
  alt?: string;
  className?: string;
  domPath?: string;
};

export type CapturedSection = {
  id: Id;
  index: number;
  domPath?: string;
  heading?: string | undefined;
  text: string[];
  links: Array<{ label: string; href: string }>;
  images: Array<{ src: string; alt?: string }>;
  elements: CapturedElement[];
  hints: {
    hasCta: boolean;
    hasCards: boolean;
    hasQuote: boolean;
    hasQuestions: boolean;
    hasForm: boolean;
  };
};

export type SectionCandidate = {
  id: Id;
  capturedSectionId?: Id | undefined;
  type: SectionType;
  confidence: number;
  reason: string;
  strategyRoles: StrategyRole[];
  sourceText: string[];
};

export type BrandExtraction = {
  colors: string[];
  fonts: string[];
  classNames: string[];
  confidence: number;
  warnings: string[];
};

export type ContentStrategyExtraction = {
  goal: PageGoal;
  audienceHints: string[];
  offerHints: string[];
  ctaHints: string[];
  proofHints: string[];
  confidence: number;
};

export type MigrationWarning = {
  code:
    | "low-text"
    | "unknown-form-destination"
    | "analytics-detected"
    | "low-section-confidence"
    | "assets-not-downloaded"
    | "pixel-perfect-not-guaranteed";
  message: string;
  severity: "info" | "warning" | "blocked";
};

export type MigrationReport = {
  sourceUrl: string;
  mode: "semantic" | "visualFaithful" | "clone";
  confidence: number;
  candidates: SectionCandidate[];
  brand: BrandExtraction;
  contentStrategy: ContentStrategyExtraction;
  preserved: string[];
  normalized: string[];
  ignored: string[];
  warnings: MigrationWarning[];
};

export type CapturedNode = {
  id: Id;
  tag: string;
  text?: string;
  role?: string;
  href?: string;
  src?: string;
  alt?: string;
  className?: string;
  domPath?: string;
  boundingBox?: Rect;
  children?: CapturedNode[];
};

export type PageCapture = {
  url: string;
  title?: string | undefined;
  viewport: Viewport;
  capturedAt: ISODateString;
  dom: CapturedNode[];
  visibleText: string[];
  sections?: CapturedSection[] | undefined;
  sectionCandidates?: SectionCandidate[] | undefined;
  brandExtraction?: BrandExtraction | undefined;
  contentStrategyExtraction?: ContentStrategyExtraction | undefined;
  assets: Array<{ url: string; type: "image" | "font" | "script" | "style" | "unknown"; alt?: string }>;
  styles: {
    colors: string[];
    fonts: string[];
    classNames: string[];
  };
  detected: {
    forms: Array<{ provider: string; action?: string; method?: string }>;
    analytics: Array<{ provider: string; id?: string }>;
  };
  privacy: {
    cookiesCaptured: false;
    localStorageCaptured: false;
    formValuesCaptured: false;
    networkBodiesCaptured: false;
  };
};

export type ChangePin = {
  id: Id;
  route: string;
  createdAt: ISODateString;
  author?: {
    name?: string;
    email?: string;
  };
  comment: string;
  target: {
    selector?: string;
    text?: string;
    role?: string;
    boundingBox?: Rect;
    sectionId?: Id;
    sectionType?: SectionType | string;
    elementId?: Id;
    elementType?: SectionElementType | string;
  };
  context: {
    selectedText?: string;
    pageTitle?: string;
    nearbyText: string[];
    className?: string;
    computedStyles?: Record<string, string>;
    screenshotCrop?: string;
    viewport: Viewport;
  };
  permissions: {
    canComment: true;
    canEdit: false;
    canGeneratePatch: false;
    canPublish: false;
  };
};

export type JsonPatchOperation =
  | { op: "replace"; path: string; value: unknown }
  | { op: "add"; path: string; value: unknown }
  | { op: "remove"; path: string };

export type SafetyReport = {
  risk: RiskLevel;
  reasons: string[];
  touchedFiles: string[];
  forbiddenChanges: boolean;
  requiresOwnerApproval: boolean;
  publishAllowed: boolean;
};

export type PatchOperationSummary = {
  kind: "specPatch" | "codePatch" | "manualReview";
  description: string;
  path?: string;
};

export type PatchPlan = {
  id: Id;
  status: "proposed" | "blocked" | "needsOwnerReview" | "applied";
  source: "pin" | "campaignVariant" | "manualEdit" | "migrationRepair";
  intent: {
    kind: "copy" | "style" | "layout" | "image" | "link" | "section" | "unknown";
    summary: string;
  };
  target: {
    specPath?: string;
    sectionId?: Id;
    elementId?: Id;
    filePath?: string;
    allowedRanges?: Array<{ start: number; end: number }>;
  };
  operations?: PatchOperationSummary[];
  proposedChange: {
    specPatch?: JsonPatchOperation[];
    codePatch?: string;
  };
  safety: SafetyReport;
};

export type BuildProfile = "production" | "review" | "owner";

export type DeployTarget = "cloudflare-pages" | "netlify" | "vercel" | "github-pages" | "zip" | "local";

export type DeploymentManifest = {
  type: "static-campaign-site";
  buildCommand: string;
  outputDir: string;
  routes: Array<{ path: string; file: string }>;
  redirects: Array<{ from: string; to: string; status: 301 | 302 | 307 | 308 }>;
  headers: Array<{ path: string; headers: Record<string, string> }>;
  profile?: BuildProfile;
};

export type GeneratedFile = {
  path: string;
  contents: string;
  role?: "source" | "style" | "asset" | "spec" | "capsule" | "config" | "manifest";
  public?: boolean;
};

export type GeneratedFileManifestItem = {
  path: string;
  bytes: number;
  role: "source" | "style" | "asset" | "spec" | "capsule" | "config" | "manifest";
  public: boolean;
};

export type PublishWarning = {
  code:
    | "owner-capsule-included"
    | "review-runtime-included"
    | "unknown-form-destination"
    | "missing-cta-href"
    | "external-script"
    | "manual-domain-step"
    | "static-only-target";
  message: string;
  severity: "info" | "warning" | "blocked";
};

export type DeployHandoffPlan = {
  target: DeployTarget;
  profile: BuildProfile;
  summary: string;
  buildCommand: string;
  outputDir: string;
  configFiles: GeneratedFile[];
  instructions: string[];
  warnings: PublishWarning[];
};

export type ExportPlan = {
  id: string;
  kind: "file-manifest" | "zip-plan" | "provider-handoff";
  profile: BuildProfile;
  files: GeneratedFile[];
  manifest: GeneratedFileManifestItem[];
  instructions: string[];
  handoff?: DeployHandoffPlan;
};


export type ExportProfile = "source" | "production" | "review" | "owner";

export type ExportFileRole =
  | "canonical"
  | "generated"
  | "capsule"
  | "private"
  | "public"
  | "config"
  | "handoff";

export type ExportFile = GeneratedFile & {
  bytes: number;
  roleHint: ExportFileRole;
  includedIn: ExportProfile[];
  private: boolean;
};

export type ExportPrivacySummary = {
  profile: ExportProfile;
  includesOwnerWorkbench: boolean;
  includesReviewRuntime: boolean;
  includesProjectState: boolean;
  includesEventHistory: boolean;
  includesMigrationBootstrap: boolean;
  privateFileCount: number;
  publicFileCount: number;
  notes: string[];
};

export type ExportValidationResult = {
  valid: boolean;
  status: "ready" | "needsReview" | "blocked";
  warnings: string[];
  privacy: ExportPrivacySummary;
};

export type ExportReceipt = {
  id: Id;
  artifactId: Id;
  createdAt: ISODateString;
  profile: ExportProfile;
  fileCount: number;
  totalBytes: number;
  summary: string;
};

export type ExportArtifact = {
  id: Id;
  kind: "stitch-export-artifact";
  version: "0.1.0";
  projectId?: Id;
  projectName?: string;
  createdAt: ISODateString;
  profile: ExportProfile;
  buildProfile: BuildProfile;
  files: ExportFile[];
  manifest: GeneratedFileManifestItem[];
  privacy: ExportPrivacySummary;
  validation: ExportValidationResult;
  publicExposureAudit?: PublicExposureAudit;
  receipt: ExportReceipt;
  nextActions: NextAction[];
  warnings: string[];
  zipReady: boolean;
  downloadFileName: string;
};

export type GeneratedSiteBundle = {
  spec: CampaignPageSpec;
  files: GeneratedFile[];
  manifest: GeneratedFileManifestItem[];
  buildProfile: BuildProfile;
  deployManifest: DeploymentManifest;
  capsuleIncluded: boolean;
  warnings: PublishWarning[];
  generatedAt?: ISODateString;
  sourceStateVersion?: number;
  generatedFromEventId?: Id;
  provenance?: ProvenanceRecord[];
  accessPolicy?: CapsuleAccessPolicy;
  publicExposureAudit?: PublicExposureAudit;
};

export type PortableSiteBundle = GeneratedSiteBundle;

export type SpecEditOperation = {
  id?: Id;
  source: "owner" | "pin" | "system";
  op: "replace" | "add" | "remove";
  path: string;
  value?: unknown;
  label?: string;
};

export type SpecEditResult = {
  status: "applied" | "blocked" | "needsOwnerReview";
  operation: SpecEditOperation;
  spec: CampaignPageSpec;
  patch: JsonPatchOperation[];
  safety: SafetyReport;
};

export type PublishReadiness = {
  status: "ready" | "needsReview" | "blocked";
  profile: BuildProfile;
  warnings: PublishWarning[];
  safety: SafetyReport;
};

export type SpecOperationKind =
  | "editSectionSlot"
  | "editCtaLabel"
  | "editCtaHref"
  | "changeSectionVariant"
  | "addSection"
  | "removeSection"
  | "editContentStrategy"
  | "editSeo";

export type SectionSlot = "eyebrow" | "heading" | "body" | "variant";

export type SpecOperation =
  | {
      id?: Id;
      kind: "editSectionSlot";
      source: "owner" | "pin" | "inference" | "system";
      sectionId: Id;
      slot: SectionSlot;
      value: string;
      reason?: string;
    }
  | {
      id?: Id;
      kind: "editCtaLabel";
      source: "owner" | "pin" | "inference" | "system";
      sectionId: Id;
      cta: "primary" | "secondary";
      label: string;
      reason?: string;
    }
  | {
      id?: Id;
      kind: "editCtaHref";
      source: "owner" | "pin" | "inference" | "system";
      sectionId: Id;
      cta: "primary" | "secondary";
      href: string;
      reason?: string;
    }
  | {
      id?: Id;
      kind: "changeSectionVariant";
      source: "owner" | "pin" | "inference" | "system";
      sectionId: Id;
      variant: string;
      reason?: string;
    }
  | {
      id?: Id;
      kind: "addSection";
      source: "owner" | "inference" | "system";
      section: SectionSpec;
      afterSectionId?: Id;
      reason?: string;
    }
  | {
      id?: Id;
      kind: "removeSection";
      source: "owner" | "inference" | "system";
      sectionId: Id;
      reason?: string;
    }
  | {
      id?: Id;
      kind: "editContentStrategy";
      source: "owner" | "inference" | "system";
      path: "/contentStrategy/audience/segment" | "/contentStrategy/offer/promise" | "/contentStrategy/offer/primaryCTA";
      value: string;
      reason?: string;
    }
  | {
      id?: Id;
      kind: "editSeo";
      source: "owner" | "inference" | "system";
      path: "/seo/title" | "/seo/description";
      value: string;
      reason?: string;
    };

export type SpecOperationResult = {
  status: "applied" | "blocked" | "needsOwnerReview";
  operation: SpecOperation;
  patch: JsonPatchOperation[];
  safety: SafetyReport;
  spec: CampaignPageSpec;
};

export type InferenceTask =
  | "respond"
  | "structured"
  | "vision"
  | "embed"
  | "refineMigration"
  | "classifySection"
  | "extractContentStrategy"
  | "suggestSpecPatch"
  | "createCampaignVariant"
  | "rewriteCopy";

export type StructuredInferenceRequest = {
  task: InferenceTask;
  schemaName: "MigrationRefinement" | "SpecOperations" | "CampaignVariant" | "CopyRewrite" | string;
  input: unknown;
  instructions?: string;
  metadata?: Record<string, unknown>;
};

export type StructuredInferenceResult<T = unknown> = {
  task: InferenceTask;
  schemaName: string;
  provider: string;
  output: T;
  operations?: SpecOperation[];
  warnings: string[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  attestation?: {
    requestHash?: string;
    responseHash?: string;
    policy?: string;
  };
};

export type ContractInferenceProvider = {
  id: string;
  structured<T = unknown>(request: StructuredInferenceRequest): Promise<StructuredInferenceResult<T>>;
};

export type MigrationRefinement = {
  summary: string;
  operations: SpecOperation[];
  confidence: number;
  preserved: string[];
  warnings: string[];
};

export type CampaignVariantRequest = {
  baseSpec: CampaignPageSpec;
  audience?: string;
  channel?: ContentStrategy["channel"];
  offer?: string;
  tone?: string;
  preserveBrand?: boolean;
  preserveIntegrations?: boolean;
};

export type CampaignVariantResult = {
  variantSpec: CampaignPageSpec;
  operations: SpecOperation[];
  safety: SafetyReport;
  summary: string;
};

export type InferenceRefinementTrace = {
  provider: string;
  task: InferenceTask;
  acceptedOperations: number;
  rejectedOperations: number;
  warnings: string[];
};


export type ChangeSource = "migration" | "pin" | "owner" | "inference" | "system" | "bundle" | "publish" | "storage";

export type StitchEventKind =
  | "project.created"
  | "project.installed"
  | "migration.created"
  | "migration.bootstrap.ingested"
  | "pin.created"
  | "patchPlan.created"
  | "specOperation.proposed"
  | "specOperation.approved"
  | "specOperation.applied"
  | "specEdit.applied"
  | "bundle.generated"
  | "export.created"
  | "publish.handoffCreated"
  | "snapshot.created"
  | "snapshot.restored"
  | "state.imported";

export type StitchEvent = {
  id: Id;
  kind: StitchEventKind;
  createdAt: ISODateString;
  source: ChangeSource;
  summary: string;
  actor?: {
    name?: string;
    email?: string;
    role?: "owner" | "reviewer" | "system";
  };
  relatedPinId?: Id;
  relatedPatchPlanId?: Id;
  relatedSnapshotId?: Id;
  relatedOperationIds?: Id[];
  data?: Record<string, unknown>;
};

export type ProvenanceRecord = {
  id: Id;
  createdAt: ISODateString;
  source: ChangeSource;
  summary: string;
  eventId?: Id;
  inputHash?: string;
  outputHash?: string;
  policy?: string;
  model?: {
    provider: string;
    task: InferenceTask;
    schemaName?: string;
  };
};

export type StateSnapshot = {
  id: Id;
  createdAt: ISODateString;
  stateVersion: number;
  eventId?: Id;
  label: string;
  spec: CampaignPageSpec;
  checksum: string;
};

export type StitchProjectState = {
  id: Id;
  version: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  spec: CampaignPageSpec;
  brand: BrandSpec;
  contentStrategy: ContentStrategy;
  pins: ChangePin[];
  patchPlans: PatchPlan[];
  appliedOperations: SpecOperationResult[];
  events: StitchEvent[];
  snapshots: StateSnapshot[];
  provenance: ProvenanceRecord[];
  migrationReport?: MigrationReport;
  currentBundle?: GeneratedSiteBundle;
};

export type UndoPlan = {
  id: Id;
  createdAt: ISODateString;
  fromStateVersion: number;
  toSnapshotId: Id;
  reversible: boolean;
  summary: string;
  warnings: string[];
};

export type StateReductionResult = {
  state: StitchProjectState;
  events: StitchEvent[];
  snapshot?: StateSnapshot;
};

export type FeedbackTransportKind = "local" | "download" | "mailto" | "post" | "githubIssueUrl";

export type FeedbackTransportConfig =
  | {
      kind: "local";
      localPinsKey: string;
    }
  | {
      kind: "download";
      fileName?: string;
    }
  | {
      kind: "mailto";
      to?: string;
      subject?: string;
    }
  | {
      kind: "post";
      endpoint: string;
      headers?: Record<string, string>;
    }
  | {
      kind: "githubIssueUrl";
      repositoryUrl: string;
      labels?: string[];
    };

export type FeedbackBundle = {
  id: Id;
  kind: "stitch-feedback-bundle";
  version: "0.1.0";
  createdAt: ISODateString;
  site: {
    id: Id;
    title?: string;
    url?: string;
    route?: string;
    buildProfile?: BuildProfile;
  };
  source: {
    transport: FeedbackTransportKind;
    reviewerSessionId?: Id;
    exportedBy?: string;
  };
  pins: ChangePin[];
  checksum: string;
};

export type FeedbackHandoff = {
  kind: FeedbackTransportKind;
  label: string;
  instructions: string[];
  bundle: FeedbackBundle;
  href?: string;
  payload?: string;
  request?: {
    method: "POST";
    url: string;
    headers: Record<string, string>;
    body: string;
  };
};

export type FeedbackImportResult = {
  status: "imported" | "partial" | "blocked";
  bundleId: Id;
  importedPins: ChangePin[];
  duplicatePins: ChangePin[];
  rejectedPins: Array<{ pin?: ChangePin; reason: string }>;
  events: StitchEvent[];
  state?: StitchProjectState;
  warnings: string[];
};

export type ReviewInbox = {
  id: Id;
  source: "local" | "imported" | "transport";
  pins: ChangePin[];
  bundles: FeedbackBundle[];
  lastImportedAt?: ISODateString;
};

export type ReviewSubmissionReceipt = {
  id: Id;
  createdAt: ISODateString;
  status: "stored-locally" | "download-ready" | "mailto-ready" | "post-ready" | "github-issue-ready" | "failed";
  transport: FeedbackTransportKind;
  bundleId?: Id;
  message: string;
};



export type BootstrapColorToken = {
  value: string;
  role: string;
  confidence: number;
  sourceRefs?: Id[];
};

export type BootstrapFontToken = {
  family: string;
  fallback?: string;
  confidence: number;
  sourceRefs?: Id[];
};

export type BootstrapBrandSpec = {
  name?: string;
  logoAssetId?: Id;
  colors: {
    canvas?: BootstrapColorToken;
    surface?: BootstrapColorToken;
    surfaceAlt?: BootstrapColorToken;
    text?: BootstrapColorToken;
    mutedText?: BootstrapColorToken;
    brand?: BootstrapColorToken;
    accent?: BootstrapColorToken;
    border?: BootstrapColorToken;
  };
  typography: {
    headingFont?: BootstrapFontToken;
    bodyFont?: BootstrapFontToken;
    monospaceFont?: BootstrapFontToken;
    scale?: "compact" | "standard" | "large" | "display";
  };
  shape: {
    radius?: "none" | "sm" | "md" | "lg" | "xl" | "pill";
    cardStyle?: "flat" | "bordered" | "shadowed" | "elevated";
  };
  spacing: {
    density?: "compact" | "standard" | "spacious";
    sectionGap?: "sm" | "md" | "lg" | "xl";
  };
  visualPersonality?: Array<"minimal" | "technical" | "premium" | "playful" | "corporate" | "editorial" | "bold" | "friendly" | "luxury" | "startup">;
  voice?: {
    tone?: string[];
    notes?: string;
  };
};

export type BootstrapGoal = "bookCall" | "startTrial" | "buy" | "signup" | "download" | "contact" | "learnMore" | "unknown";

export type BootstrapCta = {
  id: Id;
  label: string;
  href?: string;
  role: "primary" | "secondary" | "tertiary";
  intent?: BootstrapGoal;
  preserveHref: boolean;
  sourceRefs?: Id[];
  confidence: number;
};

export type BootstrapTextField = {
  value: string;
  sourceRefs?: Id[];
  confidence: number;
};

export type BootstrapImageRef = {
  assetId: Id;
  alt?: string;
  role?: "logo" | "heroMedia" | "icon" | "avatar" | "customerLogo" | "background";
  sourceRefs?: Id[];
  confidence: number;
};

export type BootstrapContentStrategy = {
  audience?: string;
  offer?: string;
  primaryGoal: BootstrapGoal;
  primaryCta?: BootstrapCta;
  secondaryCtas?: BootstrapCta[];
  promise?: string;
  painPoints?: string[];
  proofPoints?: string[];
  objections?: string[];
  trustSignals?: Array<{
    type: "logoCloud" | "testimonial" | "stat" | "rating" | "press" | "certification" | "caseStudy";
    label?: string;
    sectionId?: Id;
    confidence: number;
  }>;
  confidence: number;
};

export type BootstrapSectionType = "Nav" | "Hero" | "LogoCloud" | "FeatureGrid" | "Stats" | "Testimonials" | "Pricing" | "FAQ" | "FinalCTA" | "Footer" | "Form" | "Embed" | "UnknownSection";

export type BootstrapSectionContent = Record<string, unknown> & {
  eyebrow?: BootstrapTextField | string;
  headline?: BootstrapTextField | string;
  heading?: BootstrapTextField | string;
  subheadline?: BootstrapTextField | string;
  body?: BootstrapTextField | string;
  primaryCta?: BootstrapCta;
  secondaryCta?: BootstrapCta;
  media?: BootstrapImageRef;
  items?: Array<Record<string, unknown>>;
  links?: BootstrapCta[];
};

export type BootstrapCampaignSection = {
  id: Id;
  type: BootstrapSectionType;
  label?: string;
  role?: "navigation" | "hero" | "proof" | "education" | "conversion" | "footer";
  variant?: string;
  layout: {
    recipe: string;
    container?: "narrow" | "standard" | "wide" | "full";
    alignment?: "left" | "center" | "right" | "split" | "grid";
    density?: "compact" | "standard" | "spacious";
  };
  content: BootstrapSectionContent;
  styleRefs?: Id[];
  assetRefs?: Id[];
  sourceRefs: Id[];
  confidence: number;
  warnings?: BootstrapWarning[];
};

export type BootstrapResponsiveSummary = {
  sectionOrder?: Id[];
  hiddenSectionIds?: Id[];
  notes?: string[];
};

export type BootstrapCampaignPageSpec = {
  id: Id;
  type: "singlePageCampaign";
  route: "/" | string;
  title?: string;
  description?: string;
  sections: BootstrapCampaignSection[];
  globalCtas?: BootstrapCta[];
  responsive?: {
    desktop: BootstrapResponsiveSummary;
    mobile?: BootstrapResponsiveSummary;
  };
};

export type AssetManifest = {
  items: Array<{
    id: Id;
    type: "image" | "logo" | "icon" | "font" | "video" | "favicon" | "unknown";
    usage: "brandLogo" | "heroMedia" | "sectionImage" | "customerLogo" | "testimonialAvatar" | "icon" | "background" | "font" | "metadata" | "unknown";
    originalUrl?: string;
    resolvedUrl?: string;
    storageRef?: string;
    alt?: string;
    dimensions?: { width?: number; height?: number };
    mimeType?: string;
    hash?: string;
    sectionRefs?: Id[];
    sourceRefs?: Id[];
    migrationPolicy: "preserve" | "replace" | "requiresReview" | "unsupported";
    confidence: number;
    warnings?: BootstrapWarning[];
  }>;
};

export type BootstrapFormIntegration = {
  id: Id;
  sectionId?: Id;
  provider: "native" | "hubspot" | "typeform" | "calendly" | "mailchimp" | "marketo" | "custom" | "unknown";
  action?: string;
  method?: "GET" | "POST" | "unknown";
  fields: Array<{ name?: string; label?: string; type?: string; required?: boolean }>;
  submitLabel?: string;
  migrationPolicy: "preserve" | "requiresReview" | "unsupported";
  risk: "low" | "medium" | "high";
  sourceRefs?: Id[];
  confidence: number;
};

export type BootstrapScriptIntegration = {
  id: Id;
  provider: "ga4" | "gtm" | "plausible" | "posthog" | "segment" | "metaPixel" | "linkedinInsight" | "hotjar" | "hubspot" | "intercom" | "unknown";
  category: "analytics" | "pixel" | "embed" | "chat" | "form" | "unknown";
  migrationPolicy: "detectOnly" | "preserve" | "requiresReview" | "unsupported";
  sourceRefs?: Id[];
  confidence: number;
};

export type BootstrapEmbedIntegration = {
  id: Id;
  provider?: string;
  sourceUrl?: string;
  sectionId?: Id;
  migrationPolicy: "preserve" | "requiresReview" | "unsupported";
  risk: "low" | "medium" | "high";
  sourceRefs?: Id[];
  confidence: number;
};

export type BootstrapIntegrationManifest = {
  forms: BootstrapFormIntegration[];
  embeds: BootstrapEmbedIntegration[];
  analytics: BootstrapScriptIntegration[];
  pixels: BootstrapScriptIntegration[];
  otherScripts: BootstrapScriptIntegration[];
  warnings?: BootstrapWarning[];
};

export type SeoMetadata = {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  robots?: string;
  openGraph?: {
    title?: string;
    description?: string;
    imageAssetId?: Id;
    url?: string;
    type?: string;
  };
  twitter?: {
    card?: string;
    title?: string;
    description?: string;
    imageAssetId?: Id;
  };
  structuredData?: Array<{
    type?: string;
    summary: string;
    migrationPolicy: "preserve" | "requiresReview" | "unsupported";
  }>;
  sourceRefs?: Id[];
  confidence: number;
};

export type SourceProvenance = {
  refs: Array<{
    id: Id;
    kind: "vision" | "dom" | "computedStyle" | "asset" | "link" | "form" | "script" | "seo" | "manual" | "inferred";
    viewport?: "desktop" | "mobile" | "tablet";
    selector?: string;
    bbox?: Rect;
    textHash?: string;
    valueHash?: string;
    confidence: number;
    notes?: string;
  }>;
};

export type BootstrapWarning = {
  id: Id;
  severity: "info" | "warning" | "error" | "blocked";
  code: string;
  message: string;
  path?: string;
  sourceRefs?: Id[];
};

export type BootstrapMigrationReport = {
  readiness: "excellent" | "good" | "fair" | "poor" | "unsupported";
  score: number;
  summary: string;
  preserved: string[];
  normalized: string[];
  requiresReview: string[];
  unsupported: string[];
  warnings: BootstrapWarning[];
  stats: {
    sectionCount: number;
    assetCount: number;
    formCount: number;
    integrationCount: number;
    averageSectionConfidence: number;
  };
};

export type BootstrapGenerator = {
  name: "stitch-migrate" | string;
  version: string;
  environment?: "local" | "staging" | "production";
  modelProviders?: Array<{
    role: "vision" | "normalization" | "classification";
    name: string;
    model?: string;
  }>;
};

export type BootstrapSourceSummary = {
  requestedUrl: string;
  finalUrl: string;
  origin: string;
  capturedAt: ISODateString;
  captureMode: "url";
  pageType: "singlePageCampaign" | "unknown";
  viewports: Array<{
    id: "desktop" | "mobile" | "tablet";
    width: number;
    height: number;
    deviceScaleFactor?: number;
    screenshotRef?: string;
    screenshotHash?: string;
  }>;
  evidence: {
    visualMapHash?: string;
    domSummaryHash?: string;
    computedStyleSummaryHash?: string;
    assetManifestHash?: string;
  };
  limitations?: string[];
};

export type BootstrapProjectSeed = {
  name: string;
  slug: string;
  locale?: string;
  description?: string;
  recommendedBuildProfile: BuildProfile | "source";
  initialStatus: "readyForReview" | "needsOwnerReview" | "partial";
  tags?: string[];
};

export type BootstrapHandoffPlan = {
  recommendedNextAction: "review" | "generate" | "fixWarnings" | "unsupported";
  recommendedBuildProfile: BuildProfile | "source";
  nextActions: Array<{
    id: Id;
    label: string;
    priority: "low" | "medium" | "high";
    reason?: string;
  }>;
  privacySummary: {
    containsRawDom: boolean;
    containsScreenshots: boolean;
    containsFullCss: boolean;
    containsScripts: boolean;
    containsSecrets: boolean;
  };
  ingestionHints?: {
    preferredRenderer?: "react-tailwind";
    preserveLinksByDefault?: boolean;
    requireOwnerReviewBeforeProduction?: boolean;
  };
};

export type MigrationBootstrap = {
  kind: "stitch.migrationBootstrap";
  schemaVersion: string;
  designContractVersion: string;
  id: Id;
  createdAt: ISODateString;
  generator: BootstrapGenerator;
  source: BootstrapSourceSummary;
  project: BootstrapProjectSeed;
  design: {
    brand: BootstrapBrandSpec;
    contentStrategy: BootstrapContentStrategy;
    page: BootstrapCampaignPageSpec;
  };
  assets: AssetManifest;
  integrations: BootstrapIntegrationManifest;
  seo: SeoMetadata;
  provenance: SourceProvenance;
  report: BootstrapMigrationReport;
  handoff: BootstrapHandoffPlan;
};

export type MigrationBootstrapValidationResult = {
  valid: boolean;
  status: "accepted" | "needsReview" | "blocked";
  warnings: string[];
  normalizedFields: string[];
};

export type BootstrapIngestionResult = {
  status: "ingested" | "needsReview" | "blocked";
  bootstrapId: Id;
  validation: MigrationBootstrapValidationResult;
  projectState: StitchProjectState;
  initialEvent: StitchEvent;
  warnings: string[];
};

export type BootstrapImportPlan = {
  id: Id;
  bootstrapId: Id;
  summary: string;
  instructions: string[];
  warnings: string[];
};

export type BootstrapDownloadHandoff = {
  kind: "migration-bootstrap-download";
  fileName: string;
  payload: string;
  instructions: string[];
};


export type ProjectFileRole =
  | "canonical"
  | "generated"
  | "capsule"
  | "private"
  | "public"
  | "config"
  | "handoff";

export type InstallTarget = "folder" | "zip" | "repo" | "memory";

export type InstallWarning = {
  code:
    | "owner-profile-private"
    | "review-profile-comment-only"
    | "production-profile-no-workbench"
    | "assets-require-download"
    | "warnings-from-migration"
    | "manual-deploy-step";
  message: string;
  severity: "info" | "warning" | "blocked";
};

export type InstallStep = {
  id: Id;
  title: string;
  description: string;
  status: "planned" | "ready" | "manual";
};

export type NextAction = {
  id: Id;
  label: string;
  description: string;
  kind: "openWorkbench" | "exportZip" | "createReviewBuild" | "inspectWarnings" | "deployHandoff" | "editSpec";
  href?: string;
};

export type ProjectFileManifestItem = {
  path: string;
  role: ProjectFileRole;
  source: "bootstrap" | "compiler" | "capsule" | "kernel" | "adapter";
  public: boolean;
  canonical: boolean;
  generated: boolean;
};

export type StitchProjectManifest = {
  id: Id;
  name: string;
  rootDir: string;
  designContractVersion: string;
  activeProfile: BuildProfile;
  canonicalFiles: string[];
  generatedFiles: string[];
  capsuleFiles: string[];
  privateFiles: string[];
  publicFiles: string[];
  fileRoles: ProjectFileManifestItem[];
};

export type InstallPlan = {
  id: Id;
  projectId: Id;
  target: InstallTarget;
  rootDir: string;
  profile: BuildProfile;
  steps: InstallStep[];
  files: ProjectFileManifestItem[];
  warnings: InstallWarning[];
  nextActions: NextAction[];
};

export type StitchProject = {
  id: Id;
  name: string;
  createdAt: ISODateString;
  rootDir: string;
  activeProfile: BuildProfile;
  bootstrap: MigrationBootstrap;
  state: StitchProjectState;
  bundle: GeneratedSiteBundle;
  manifest: StitchProjectManifest;
  installPlan: InstallPlan;
};

export type DeployProvider = "cloudflarePages" | "netlify" | "vercel" | "githubPages" | "manualStatic";

export type DeployStep = {
  id: Id;
  title: string;
  description: string;
  command?: string;
  url?: string;
  required: boolean;
};

export type DeployCommand = {
  label: string;
  command: string;
  workingDirectory?: string;
};

export type DeployFile = GeneratedFile & {
  purpose: "providerConfig" | "instructions" | "manifest" | "projectFile";
};

export type DeployWarning = {
  code:
    | "owner-profile-public-risk"
    | "review-runtime-included"
    | "private-state-in-public-package"
    | "unknown-form-destination"
    | "unknown-analytics"
    | "missing-cta-href"
    | "manual-domain-step"
    | "provider-api-not-called"
    | "static-only"
    | "unsupported-feature";
  message: string;
  severity: "info" | "warning" | "blocked";
};

export type DeployReadinessReport = {
  provider: DeployProvider;
  profile: ExportProfile;
  status: "ready" | "needsReview" | "blocked";
  buildCommand: string;
  outputDirectory: string;
  warnings: DeployWarning[];
  summary: string;
};

export type DeployPackage = {
  id: Id;
  kind: "stitch-deploy-package";
  version: "0.1.0";
  provider: DeployProvider;
  artifactId: Id;
  projectId?: Id;
  profile: ExportProfile;
  createdAt: ISODateString;
  buildCommand: string;
  outputDirectory: string;
  files: DeployFile[];
  commands: DeployCommand[];
  steps: DeployStep[];
  readiness: DeployReadinessReport;
  manualSteps: string[];
  environmentNotes: string[];
  unsupportedFeatures: string[];
  warnings: DeployWarning[];
};

export type AccessMode = "visitor" | "reviewer" | "owner";

export type CapabilityScope =
  | "site:view"
  | "comment:create"
  | "feedback:export"
  | "feedback:import"
  | "spec:view"
  | "spec:edit"
  | "patch:plan"
  | "patch:apply"
  | "history:view"
  | "history:restore"
  | "bundle:export"
  | "deploy:handoff";

export type CapabilityToken = {
  id: Id;
  mode: AccessMode;
  scopes: CapabilityScope[];
  issuedAt: ISODateString;
  expiresAt?: ISODateString;
  subject?: string;
  reviewSessionId?: Id;
  note?: string;
};

export type OwnerUnlock = {
  required: boolean;
  method: "none" | "passphrase" | "localKey" | "hostAccess" | "external";
  storageKey?: string;
  warning?: string;
};

export type CapsuleAccessPolicy = {
  profile: BuildProfile;
  publicMode: AccessMode;
  allowedModes: AccessMode[];
  scopesByMode: Record<AccessMode, CapabilityScope[]>;
  ownerUnlock: OwnerUnlock;
  tokenRequiredFor: CapabilityScope[];
  notes: string[];
};

export type AccessValidationResult = {
  allowed: boolean;
  mode: AccessMode;
  scope: CapabilityScope;
  reasons: string[];
  requiredScopes: CapabilityScope[];
  publicSafe: boolean;
};

export type PublicExposureFinding = {
  code:
    | "owner-tools-exposed"
    | "review-runtime-exposed"
    | "private-state-exposed"
    | "event-history-exposed"
    | "migration-bootstrap-exposed"
    | "owner-profile-public-risk"
    | "review-profile-comment-only"
    | "production-public-safe";
  severity: "info" | "warning" | "blocked";
  message: string;
  filePaths?: string[];
};

export type PublicExposureAudit = {
  id: Id;
  createdAt: ISODateString;
  profile: BuildProfile | ExportProfile;
  safeForPublic: boolean;
  includesOwnerTools: boolean;
  includesReviewRuntime: boolean;
  includesProjectState: boolean;
  includesEventHistory: boolean;
  includesMigrationBootstrap: boolean;
  findings: PublicExposureFinding[];
  summary: string;
};


// Phase 14: concrete materialized artifact boundary.
export type ArtifactFormat = "stitchBundleJson" | "zipReady" | "zipBase64" | "directoryManifest";

export type ArtifactFileEncoding = "utf8" | "base64";

export type MaterializationWarning = {
  code:
    | "owner-artifact-private"
    | "source-artifact-private"
    | "production-private-file-blocked"
    | "review-owner-tools-blocked"
    | "zip-not-compressed"
    | "artifact-empty"
    | "private-state-included";
  message: string;
  severity: "info" | "warning" | "blocked";
};

export type ArtifactIntegrity = {
  algorithm: "stitch-simple-hash-v1";
  hash: string;
  fileHashes: Array<{
    path: string;
    hash: string;
    bytes: number;
  }>;
  totalBytes: number;
};

export type MaterializedArtifactFile = {
  path: string;
  contents: string;
  encoding: ArtifactFileEncoding;
  bytes: number;
  private: boolean;
  roleHint: ExportFileRole;
};

export type MaterializedArtifact = {
  id: Id;
  kind: "stitch-materialized-artifact";
  version: "0.1.0";
  artifactId: Id;
  projectId?: Id;
  profile: ExportProfile;
  format: ArtifactFormat;
  createdAt: ISODateString;
  fileName: string;
  mimeType: string;
  files: MaterializedArtifactFile[];
  payload: string;
  payloadEncoding: ArtifactFileEncoding;
  integrity: ArtifactIntegrity;
  privacy: ExportPrivacySummary;
  validation: ExportValidationResult;
  publicExposureAudit?: PublicExposureAudit;
  receipt: ExportReceipt;
  warnings: MaterializationWarning[];
  downloadReady: boolean;
  summary: string;
};

export type MaterializationResult = {
  status: "ready" | "needsReview" | "blocked";
  artifact?: MaterializedArtifact;
  warnings: MaterializationWarning[];
  integrity?: ArtifactIntegrity;
};
