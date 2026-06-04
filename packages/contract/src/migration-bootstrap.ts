import { createDefaultBrandSpec } from "./defaults";
import type {
  BrandSpec,
  BootstrapCampaignSection,
  BootstrapCta,
  BootstrapGoal,
  BootstrapTextField,
  BuildProfile,
  CampaignPageSpec,
  ContentStrategy,
  CtaSpec,
  IntegrationManifest,
  MigrationBootstrap,
  MigrationBootstrapValidationResult,
  MigrationReport,
  MigrationWarning,
  PageGoal,
  SectionEditPolicy,
  SectionSpec,
  SectionType,
  StrategyRole,
} from "./types";

export type ParseMigrationBootstrapResult =
  | { ok: true; bootstrap: MigrationBootstrap; validation: MigrationBootstrapValidationResult }
  | { ok: false; validation: MigrationBootstrapValidationResult };

export function validateMigrationBootstrap(input: unknown): MigrationBootstrapValidationResult {
  const warnings: string[] = [];
  const normalizedFields: string[] = [];

  if (!isRecord(input)) {
    return { valid: false, status: "blocked", warnings: ["MigrationBootstrap must be an object."], normalizedFields };
  }

  if (input.kind !== "stitch.migrationBootstrap") warnings.push("Bootstrap kind must be stitch.migrationBootstrap.");
  if (!isNonEmptyString(input.schemaVersion)) warnings.push("Bootstrap is missing schemaVersion.");
  if (!isNonEmptyString(input.designContractVersion)) warnings.push("Bootstrap is missing designContractVersion.");
  if (!isNonEmptyString(input.id)) warnings.push("Bootstrap is missing id.");
  if (!isNonEmptyString(input.createdAt)) warnings.push("Bootstrap is missing createdAt.");

  const source = isRecord(input.source) ? input.source : undefined;
  if (!source) warnings.push("Bootstrap is missing source summary.");
  else {
    if (!isNonEmptyString(source.requestedUrl)) warnings.push("source.requestedUrl is required.");
    if (!isNonEmptyString(source.finalUrl)) warnings.push("source.finalUrl is required.");
    if (!Array.isArray(source.viewports) || source.viewports.length === 0) warnings.push("source.viewports must include at least one viewport.");
  }

  const project = isRecord(input.project) ? input.project : undefined;
  if (!project) warnings.push("Bootstrap is missing project seed.");
  else {
    if (!isNonEmptyString(project.name)) warnings.push("project.name is required.");
    if (!isNonEmptyString(project.slug)) warnings.push("project.slug is required.");
  }

  const design = isRecord(input.design) ? input.design : undefined;
  const page = design && isRecord(design.page) ? design.page : undefined;
  if (!design) warnings.push("Bootstrap is missing design object.");
  if (!page) warnings.push("design.page is required.");
  else {
    if (page.type !== "singlePageCampaign") warnings.push("design.page.type must be singlePageCampaign.");
    if (!Array.isArray(page.sections)) warnings.push("design.page.sections must be an array.");
    else if (page.sections.length === 0) warnings.push("design.page.sections must contain at least one section.");
  }

  const assets = isRecord(input.assets) ? input.assets : undefined;
  if (!assets || !Array.isArray(assets.items)) warnings.push("assets.items must be an array.");

  const integrations = isRecord(input.integrations) ? input.integrations : undefined;
  if (!integrations) warnings.push("integrations object is required.");
  else {
    for (const key of ["forms", "embeds", "analytics", "pixels", "otherScripts"] as const) {
      if (!Array.isArray(integrations[key])) warnings.push(`integrations.${key} must be an array.`);
    }
  }

  const seo = isRecord(input.seo) ? input.seo : undefined;
  if (!seo || typeof seo.confidence !== "number") warnings.push("seo.confidence is required.");

  const provenance = isRecord(input.provenance) ? input.provenance : undefined;
  if (!provenance || !Array.isArray(provenance.refs)) warnings.push("provenance.refs must be an array.");

  const report = isRecord(input.report) ? input.report : undefined;
  if (!report) warnings.push("report is required.");
  else {
    if (typeof report.score !== "number") warnings.push("report.score is required.");
    if (!Array.isArray(report.warnings)) warnings.push("report.warnings must be an array.");
  }

  const handoff = isRecord(input.handoff) ? input.handoff : undefined;
  if (!handoff) warnings.push("handoff is required.");
  else {
    const privacy = isRecord(handoff.privacySummary) ? handoff.privacySummary : undefined;
    if (!privacy) warnings.push("handoff.privacySummary is required.");
    else if (privacy.containsSecrets === true) warnings.push("handoff.privacySummary.containsSecrets must be false.");
  }

  const bootstrapWarnings = collectBootstrapWarnings(input as Partial<MigrationBootstrap>);
  if (bootstrapWarnings.some((warning) => warning.severity === "blocked" || warning.severity === "error")) {
    warnings.push("Migration endpoint returned blocking/error warnings.");
  }
  if ((input as Partial<MigrationBootstrap>).handoff?.recommendedNextAction === "unsupported") {
    warnings.push("Migration endpoint marked this page unsupported.");
  }
  if ((input as Partial<MigrationBootstrap>).report?.readiness === "unsupported") {
    warnings.push("Migration report readiness is unsupported.");
  }

  const blocked = warnings.some((warning) => /must be|missing|is required|containsSecrets|unsupported|blocking\/error/i.test(warning));
  const needsReview = !blocked && (
    warnings.length > 0 ||
    ((input as Partial<MigrationBootstrap>).report?.score ?? 1) < 0.7 ||
    (input as Partial<MigrationBootstrap>).project?.initialStatus !== "readyForReview" ||
    collectBootstrapWarnings(input as Partial<MigrationBootstrap>).some((warning) => warning.severity === "warning") ||
    (input as Partial<MigrationBootstrap>).handoff?.recommendedNextAction === "review" ||
    (input as Partial<MigrationBootstrap>).handoff?.recommendedNextAction === "fixWarnings"
  );

  return {
    valid: !blocked,
    status: blocked ? "blocked" : needsReview ? "needsReview" : "accepted",
    warnings,
    normalizedFields,
  };
}

export function parseMigrationBootstrap(input: unknown): MigrationBootstrap {
  const validation = validateMigrationBootstrap(input);
  if (!validation.valid) throw new Error(`Invalid MigrationBootstrap: ${validation.warnings.join("; ")}`);
  return input as MigrationBootstrap;
}

export function safeParseMigrationBootstrap(input: unknown): ParseMigrationBootstrapResult {
  const validation = validateMigrationBootstrap(input);
  if (!validation.valid) return { ok: false, validation };
  return { ok: true, bootstrap: input as MigrationBootstrap, validation };
}

export function getBootstrapBuildProfile(bootstrap: MigrationBootstrap): BuildProfile {
  const preferred = bootstrap.handoff.recommendedBuildProfile ?? bootstrap.project.recommendedBuildProfile;
  if (preferred === "production" || preferred === "review" || preferred === "owner") return preferred;
  return "owner";
}

export function getBootstrapSourceUrl(bootstrap: MigrationBootstrap): string {
  return bootstrap.source.finalUrl || bootstrap.source.requestedUrl || bootstrap.source.origin;
}

export function getBootstrapWarnings(bootstrap: MigrationBootstrap): MigrationWarning[] {
  return collectBootstrapWarnings(bootstrap).map((warning) => ({
    code: normalizeMigrationWarningCode(warning.code),
    message: warning.path ? `${warning.message} (${warning.path})` : warning.message,
    severity: warning.severity === "blocked" || warning.severity === "error" ? "blocked" : warning.severity === "warning" ? "warning" : "info",
  }));
}

export function adaptMigrationBootstrapToCampaignPageSpec(bootstrap: MigrationBootstrap): CampaignPageSpec {
  const brand = adaptBootstrapBrand(bootstrap);
  const contentStrategy = adaptBootstrapContentStrategy(bootstrap);
  const title = bootstrap.design.page.title ?? bootstrap.seo.title ?? bootstrap.project.name;
  const description = bootstrap.design.page.description ?? bootstrap.seo.description ?? bootstrap.report.summary;
  const sections = bootstrap.design.page.sections.map((section, index) => adaptBootstrapSection(section, bootstrap, index));
  const fallbackCta = bootstrap.design.contentStrategy.primaryCta;
  const normalizedSections = sections.length > 0 ? sections : [fallbackHeroSection(bootstrap, fallbackCta)];
  const integrations = adaptBootstrapIntegrations(bootstrap);

  return {
    id: bootstrap.design.page.id || `page-${bootstrap.id}`,
    title,
    slug: bootstrap.design.page.route || "/",
    goal: mapBootstrapGoal(bootstrap.design.contentStrategy.primaryGoal),
    brand,
    contentStrategy,
    seo: {
      title: bootstrap.seo.title ?? title,
      description,
      ...(bootstrap.seo.canonicalUrl ? { canonical: bootstrap.seo.canonicalUrl } : {}),
    },
    sections: normalizedSections,
    integrations,
  };
}

export function adaptMigrationBootstrapToMigrationReport(bootstrap: MigrationBootstrap): MigrationReport {
  const page = bootstrap.design.page;
  const warnings = getBootstrapWarnings(bootstrap);
  return {
    sourceUrl: getBootstrapSourceUrl(bootstrap),
    mode: "semantic",
    confidence: clamp01(bootstrap.report.score),
    candidates: page.sections.map((section, index) => ({
      id: `candidate-${section.id}`,
      capturedSectionId: section.sourceRefs[0],
      type: mapBootstrapSectionType(section.type),
      confidence: clamp01(section.confidence),
      reason: `Migrated from ${section.layout.recipe}.`,
      strategyRoles: strategyRolesForBootstrapSection(section),
      sourceText: sourceTextForSection(section),
    })),
    brand: {
      colors: Object.values(bootstrap.design.brand.colors).map((color) => color?.value).filter((value): value is string => Boolean(value)),
      fonts: [bootstrap.design.brand.typography.headingFont?.family, bootstrap.design.brand.typography.bodyFont?.family].filter((value): value is string => Boolean(value)),
      classNames: [],
      confidence: average([
        bootstrap.design.brand.colors.brand?.confidence,
        bootstrap.design.brand.colors.accent?.confidence,
        bootstrap.design.brand.typography.bodyFont?.confidence,
      ]),
      warnings: [],
    },
    contentStrategy: {
      goal: mapBootstrapGoal(bootstrap.design.contentStrategy.primaryGoal),
      audienceHints: bootstrap.design.contentStrategy.audience ? [bootstrap.design.contentStrategy.audience] : [],
      offerHints: [bootstrap.design.contentStrategy.offer, bootstrap.design.contentStrategy.promise].filter((value): value is string => Boolean(value)),
      ctaHints: [bootstrap.design.contentStrategy.primaryCta?.label, ...(bootstrap.design.contentStrategy.secondaryCtas ?? []).map((cta) => cta.label)].filter((value): value is string => Boolean(value)),
      proofHints: bootstrap.design.contentStrategy.proofPoints ?? [],
      confidence: clamp01(bootstrap.design.contentStrategy.confidence),
    },
    preserved: bootstrap.report.preserved,
    normalized: bootstrap.report.normalized,
    ignored: bootstrap.report.unsupported,
    warnings,
  };
}

function adaptBootstrapBrand(bootstrap: MigrationBootstrap): BrandSpec {
  const brand = createDefaultBrandSpec(bootstrap.design.brand.name ?? bootstrap.project.name);
  const colors = bootstrap.design.brand.colors;
  if (colors.canvas?.value) brand.colors.canvas = colors.canvas.value;
  if (colors.surface?.value) brand.colors.surface = colors.surface.value;
  if (colors.surfaceAlt?.value) brand.colors.surfaceAlt = colors.surfaceAlt.value;
  if (colors.text?.value) brand.colors.text = colors.text.value;
  if (colors.mutedText?.value) brand.colors.textMuted = colors.mutedText.value;
  if (colors.border?.value) brand.colors.border = colors.border.value;
  if (colors.brand?.value) brand.colors.brand = colors.brand.value;
  if (colors.accent?.value) brand.colors.accent = colors.accent.value;

  const headingFont = bootstrap.design.brand.typography.headingFont?.family;
  const bodyFont = bootstrap.design.brand.typography.bodyFont?.family;
  if (headingFont) {
    brand.typography.heading = headingFont;
    brand.typography.display = headingFont;
  }
  if (bodyFont) brand.typography.body = bodyFont;

  const density = bootstrap.design.brand.spacing.density;
  if (density === "compact") brand.spacingDensity = "compact";
  if (density === "spacious") brand.spacingDensity = "spacious";
  if (density === "standard") brand.spacingDensity = "comfortable";

  const radius = bootstrap.design.brand.shape.radius;
  if (radius === "pill") brand.radius = "full";
  else if (radius) brand.radius = radius;

  const personality = bootstrap.design.brand.visualPersonality?.[0];
  if (personality === "premium" || personality === "luxury") brand.voice.personality = "premium";
  if (personality === "playful") brand.voice.personality = "playful";
  if (personality === "technical" || personality === "corporate") brand.voice.personality = "expert";
  if (personality === "bold") brand.voice.energy = "bold";

  return brand;
}

function adaptBootstrapContentStrategy(bootstrap: MigrationBootstrap): ContentStrategy {
  const strategy = bootstrap.design.contentStrategy;
  const offer: NonNullable<ContentStrategy["offer"]> = {};
  if (strategy.promise) offer.promise = strategy.promise;
  if (strategy.offer) offer.deliverable = strategy.offer;
  if (strategy.primaryCta?.label) offer.primaryCTA = strategy.primaryCta.label;
  if (strategy.secondaryCtas?.[0]?.label) offer.secondaryCTA = strategy.secondaryCtas[0].label;

  return {
    goal: mapBootstrapGoal(strategy.primaryGoal),
    ...(strategy.audience || strategy.painPoints?.[0] || strategy.objections?.length
      ? {
          audience: {
            ...(strategy.audience ? { segment: strategy.audience } : {}),
            ...(strategy.painPoints?.[0] ? { primaryPain: strategy.painPoints[0] } : {}),
            ...(strategy.objections?.length ? { objections: strategy.objections } : {}),
          },
        }
      : {}),
    ...(Object.keys(offer).length > 0 ? { offer } : {}),
  };
}

function adaptBootstrapSection(section: BootstrapCampaignSection, bootstrap: MigrationBootstrap, index: number): SectionSpec {
  const content = section.content;
  const heading = textValue(content.headline) ?? textValue(content.heading) ?? stringValue(content.title) ?? section.label;
  const body = textValue(content.subheadline) ?? textValue(content.body) ?? stringValue(content.description);
  const primaryCta = ctaToSpec(content.primaryCta ?? (section.role === "hero" ? bootstrap.design.contentStrategy.primaryCta : undefined));
  const secondaryCta = ctaToSpec(content.secondaryCta);
  const items = normalizeItems(content.items);
  const media = content.media ? assetToMedia(content.media, bootstrap) : undefined;
  const mappedType = mapBootstrapSectionType(section.type);
  const sourceRef = section.sourceRefs[0];

  const adapted: SectionSpec = cleanUndefined({
    id: section.id,
    type: mappedType,
    variant: section.variant ?? recipeVariant(section.layout.recipe),
    strategyRoles: strategyRolesForBootstrapSection(section),
    eyebrow: textValue(content.eyebrow),
    heading,
    body,
    primaryCta,
    secondaryCta,
    media,
    items,
    elements: createSectionElements(section, heading, body, primaryCta, secondaryCta),
    editPolicy: defaultSectionEditPolicy(),
    source: {
      originalUrl: getBootstrapSourceUrl(bootstrap),
      ...(sourceRef ? { capturedSectionId: sourceRef } : {}),
      originalText: sourceTextForSection(section).join("\n"),
      migrationConfidence: clamp01(section.confidence),
      migrationReason: `Vision/DOM-aligned ${section.type} section using ${section.layout.recipe}.`,
    },
  } as Record<string, unknown>) as SectionSpec;
  return adapted;
}

function fallbackHeroSection(bootstrap: MigrationBootstrap, cta?: BootstrapCta): SectionSpec {
  const primaryCta = ctaToSpec(cta);
  return {
    id: "section_hero_fallback",
    type: "Hero",
    variant: "centered",
    strategyRoles: ["audience", "promise", "cta"],
    heading: bootstrap.project.name,
    body: bootstrap.report.summary,
    ...(primaryCta ? { primaryCta } : {}),
    editPolicy: defaultSectionEditPolicy(),
    source: {
      originalUrl: getBootstrapSourceUrl(bootstrap),
      migrationConfidence: 0.35,
      migrationReason: "Fallback section created because bootstrap page had no sections.",
    },
  };
}

function adaptBootstrapIntegrations(bootstrap: MigrationBootstrap): IntegrationManifest {
  return {
    forms: bootstrap.integrations.forms.map((form) => ({
      id: form.id,
      provider: mapFormProvider(form.provider),
      ...(form.action ? { destination: form.action } : {}),
      protected: true,
    })),
    analytics: [...bootstrap.integrations.analytics, ...bootstrap.integrations.pixels].map((script) => ({
      provider: mapAnalyticsProvider(script.provider),
      protected: true,
    })),
  };
}

function collectBootstrapWarnings(bootstrap: Partial<MigrationBootstrap>): Array<{ code: string; message: string; severity: "info" | "warning" | "error" | "blocked"; path?: string }> {
  const reportWarnings = Array.isArray(bootstrap.report?.warnings) ? bootstrap.report.warnings : [];
  const integrationWarnings = Array.isArray(bootstrap.integrations?.warnings) ? bootstrap.integrations.warnings : [];
  const assetWarnings = Array.isArray(bootstrap.assets?.items) ? bootstrap.assets.items.flatMap((asset) => asset.warnings ?? []) : [];
  const sectionWarnings = Array.isArray(bootstrap.design?.page?.sections) ? bootstrap.design.page.sections.flatMap((section) => section.warnings ?? []) : [];
  return [...reportWarnings, ...integrationWarnings, ...assetWarnings, ...sectionWarnings];
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (isRecord(value) && typeof value.value === "string") return value.value.trim() || undefined;
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function ctaToSpec(cta: BootstrapCta | undefined): CtaSpec | undefined {
  if (!cta?.label) return undefined;
  return {
    label: cta.label,
    href: cta.href ?? "#",
    variant: cta.role === "primary" ? "primary" : cta.role === "secondary" ? "secondary" : "ghost",
  };
}

function assetToMedia(media: { assetId: string; alt?: string; role?: string }, bootstrap: MigrationBootstrap): SectionSpec["media"] {
  const asset = bootstrap.assets.items.find((item) => item.id === media.assetId);
  const src = asset?.storageRef ?? asset?.resolvedUrl ?? asset?.originalUrl;
  if (!src) return undefined;
  const alt = media.alt ?? asset?.alt;
  return {
    src,
    ...(alt ? { alt } : {}),
    role: media.role === "heroMedia" ? "screenshot" : media.role === "logo" ? "logo" : media.role === "icon" ? "icon" : "product",
  };
}

function normalizeItems(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.map((item, index) => {
    if (!isRecord(item)) return { id: `item-${index + 1}`, title: String(item) };
    const normalized: Record<string, unknown> = { ...item };
    if (!normalized.id) normalized.id = `item-${index + 1}`;
    if (!normalized.title && typeof normalized.heading === "string") normalized.title = normalized.heading;
    if (!normalized.description && typeof normalized.body === "string") normalized.description = normalized.body;
    return normalized;
  });
}

function createSectionElements(section: BootstrapCampaignSection, heading?: string, body?: string, primaryCta?: CtaSpec, secondaryCta?: CtaSpec): SectionSpec["elements"] {
  const elements: NonNullable<SectionSpec["elements"]> = [];
  if (heading) elements.push({ id: `${section.id}_heading`, role: "heading", type: "Heading", text: heading, sourceField: "content.headline" });
  if (body) elements.push({ id: `${section.id}_body`, role: "body", type: "Text", text: body, sourceField: "content.body" });
  if (primaryCta) elements.push({ id: `${section.id}_primaryCta`, role: "primaryCta", type: "Button", label: primaryCta.label, sourceField: "content.primaryCta" });
  if (secondaryCta) elements.push({ id: `${section.id}_secondaryCta`, role: "secondaryCta", type: "Button", label: secondaryCta.label, sourceField: "content.secondaryCta" });
  return elements.length > 0 ? elements : undefined;
}

function sourceTextForSection(section: BootstrapCampaignSection): string[] {
  const values = [
    textValue(section.content.eyebrow),
    textValue(section.content.headline),
    textValue(section.content.heading),
    textValue(section.content.subheadline),
    textValue(section.content.body),
    section.content.primaryCta?.label,
    section.content.secondaryCta?.label,
  ];
  return values.filter((value): value is string => Boolean(value));
}

function strategyRolesForBootstrapSection(section: BootstrapCampaignSection): StrategyRole[] {
  if (section.role === "hero") return ["audience", "promise", "cta"];
  if (section.role === "proof" || section.type === "Testimonials" || section.type === "LogoCloud" || section.type === "Stats") return ["proof", "trust"];
  if (section.role === "conversion" || section.type === "FinalCTA" || section.type === "Form") return ["cta", "riskReversal"];
  if (section.role === "footer") return ["trust"];
  return ["benefit"];
}

function mapBootstrapSectionType(type: string): SectionType {
  if (type === "Hero" || type === "LogoCloud" || type === "FeatureGrid" || type === "Testimonials" || type === "Stats" || type === "Pricing" || type === "FAQ" || type === "FinalCTA" || type === "Footer") return type;
  if (type === "Nav") return "Custom";
  if (type === "Form") return "Offer";
  if (type === "Embed") return "Custom";
  return "Custom";
}

function mapBootstrapGoal(goal: BootstrapGoal): PageGoal {
  if (goal === "bookCall" || goal === "download") return goal;
  if (goal === "startTrial" || goal === "signup") return "signup";
  if (goal === "buy") return "purchase";
  if (goal === "contact") return "lead";
  return "lead";
}

function mapFormProvider(provider: string): NonNullable<IntegrationManifest["forms"]>[number]["provider"] {
  if (provider === "native") return "html";
  if (provider === "hubspot" || provider === "typeform" || provider === "mailchimp" || provider === "marketo" || provider === "custom") return provider === "mailchimp" || provider === "marketo" ? "custom" : provider;
  return "unknown";
}

function mapAnalyticsProvider(provider: string): NonNullable<IntegrationManifest["analytics"]>[number]["provider"] {
  if (provider === "ga4" || provider === "plausible" || provider === "posthog") return provider;
  if (provider === "metaPixel") return "meta";
  if (provider === "linkedinInsight") return "linkedin";
  if (provider === "gtm" || provider === "segment" || provider === "hotjar" || provider === "hubspot" || provider === "intercom") return "custom";
  return "unknown";
}

function recipeVariant(recipe: string): string {
  const last = recipe.split(".").pop();
  return last?.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase() || "default";
}

function defaultSectionEditPolicy(): SectionEditPolicy {
  return {
    safeOperations: ["editCopy", "changeCtaLabel", "changeVariant", "changeEmphasis", "reorderItems"],
    requiresApproval: ["editHref", "replaceMedia", "editPrice", "editLegal", "changeIntegration"],
    blockedOperations: ["injectScript", "javascriptHref", "hiddenDataCapture", "unauthorizedPublish"],
  };
}

function normalizeMigrationWarningCode(code: string): MigrationWarning["code"] {
  if (code === "low-text" || code === "unknown-form-destination" || code === "analytics-detected" || code === "low-section-confidence" || code === "assets-not-downloaded" || code === "pixel-perfect-not-guaranteed") return code;
  if (/form/i.test(code)) return "unknown-form-destination";
  if (/analytics|pixel|script/i.test(code)) return "analytics-detected";
  if (/asset/i.test(code)) return "assets-not-downloaded";
  if (/confidence|low/i.test(code)) return "low-section-confidence";
  return "pixel-perfect-not-guaranteed";
}

function average(values: Array<number | undefined>): number {
  const present = values.filter((value): value is number => typeof value === "number");
  if (present.length === 0) return 0.5;
  return clamp01(present.reduce((sum, value) => sum + value, 0) / present.length);
}

function clamp01(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function cleanUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
