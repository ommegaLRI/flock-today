import {
  adaptMigrationBootstrapToCampaignPageSpec,
  adaptMigrationBootstrapToMigrationReport,
  blockedSafetyReport,
  getBootstrapBuildProfile,
  getBootstrapSourceUrl,
  getBootstrapWarnings,
  validateMigrationBootstrap,
  type CampaignPageSpec,
  type ChangePin,
  type JsonPatchOperation,
  type PatchOperationSummary,
  type PatchPlan,
  type SafetyReport,
  type SectionSpec,
  type SpecEditOperation,
  type SpecEditResult,
  type SpecOperation,
  type SpecOperationResult,
  type CampaignVariantRequest,
  type CampaignVariantResult,
  type BuildProfile,
  type GeneratedSiteBundle,
  type PublishReadiness,
  type PublishWarning,
  type ChangeSource,
  type MigrationReport,
  type ProvenanceRecord,
  type StateSnapshot,
  type StitchEvent,
  type StitchEventKind,
  type StitchProjectState,
  type UndoPlan,
  type StateReductionResult,
  type FeedbackBundle,
  type FeedbackImportResult,
  type MigrationBootstrap,
  type MigrationBootstrapValidationResult,
  type BootstrapIngestionResult,
  type InstallPlan,
  type ExportArtifact,
  type ExportValidationResult,
  type DeployPackage,
  type DeployReadinessReport,
  type DeployWarning,
  type AccessMode,
  type AccessValidationResult,
  type BuildProfile as CapsuleBuildProfile,
  type CapabilityScope,
  type CapabilityToken,
  type CapsuleAccessPolicy,
  type ExportProfile,
  type PublicExposureAudit,
  type MaterializedArtifact,
  type MaterializationResult,
  type MaterializationWarning,
  type PublicExposureFinding,
} from "@stitch/contract";

export type IntentKind = PatchPlan["intent"]["kind"];

export type ApplyPatchResult = {
  spec: CampaignPageSpec;
  plan: PatchPlan;
};

export function classifyPinIntent(pin: ChangePin): IntentKind {
  const text = pin.comment.toLowerCase();
  if (/link|url|href|destination/.test(text)) return "link";
  if (/image|photo|logo|picture/.test(text)) return "image";
  if (/move|layout|stack|mobile|wrap|align/.test(text)) return "layout";
  if (/color|spacing|bigger|smaller|radius|rounded|stand out|premium|emphasize|highlight|contrast|brand/.test(text)) return "style";
  if (/section|add|remove|delete/.test(text)) return "section";
  if (/copy|text|headline|word|say|label|shorter|clearer|direct|rename|change this to/.test(text)) return "copy";
  if (extractQuotedText(pin.comment)) return "copy";
  return "unknown";
}

export function createPatchPlanFromPin(spec: CampaignPageSpec, pin: ChangePin): PatchPlan {
  if (pin.permissions.canEdit || pin.permissions.canGeneratePatch || pin.permissions.canPublish) {
    return blockedPlan(pin, "Review pins must be comment-only and cannot carry edit, patch, or publish permissions.");
  }

  const intentKind = classifyPinIntent(pin);
  const target = findTargetSection(spec, pin);

  if (!target.section) {
    return blockedPlan(pin, "Could not map pin to a section in the campaign spec.", intentKind);
  }

  const specPath = `/sections/${target.index}`;
  const specPatch = proposeSpecPatch(target.section, specPath, intentKind, pin);
  const operations = summarizeOperations(specPatch, intentKind);
  const safety = evaluateSpecPatchSafety(specPatch);
  const normalizedElementId = normalizeElementId(pin.target.elementId);

  return {
    id: `plan-${pin.id}`,
    status: safety.risk === "blocked" ? "blocked" : safety.risk === "low" ? "proposed" : "needsOwnerReview",
    source: "pin",
    intent: { kind: intentKind, summary: pin.comment },
    target: {
      specPath,
      sectionId: target.section.id,
      ...(normalizedElementId ? { elementId: normalizedElementId } : {}),
    },
    operations,
    proposedChange: specPatch.length > 0 ? { specPatch } : {},
    safety,
  };
}

export function applyPatchPlanToSpec(spec: CampaignPageSpec, plan: PatchPlan): ApplyPatchResult {
  const patch = plan.proposedChange.specPatch ?? [];
  if (plan.safety.forbiddenChanges || plan.status === "blocked" || patch.length === 0) {
    return { spec, plan };
  }

  const next = applySpecPatch(spec, patch);
  return {
    spec: next,
    plan: {
      ...plan,
      status: "applied",
      safety: {
        ...plan.safety,
        publishAllowed: false,
        reasons: [...plan.safety.reasons, "Patch applied to the in-memory CampaignPageSpec. Publishing still requires owner approval."],
      },
    },
  };
}

export function summarizePatchPlan(plan: PatchPlan): string {
  const operationText = (plan.operations ?? []).map((operation) => operation.description).join("; ") || "No safe operation proposed.";
  return `${plan.status}: ${plan.intent.kind} request targeting ${plan.target.sectionId ?? "unknown section"}. ${operationText}`;
}

export function createSpecEditOperation(path: string, value: unknown, options: Partial<Omit<SpecEditOperation, "path" | "value" | "op">> = {}): SpecEditOperation {
  return {
    source: options.source ?? "owner",
    op: "replace",
    path,
    value,
    ...(options.id ? { id: options.id } : {}),
    ...(options.label ? { label: options.label } : {}),
  };
}

export function validateSpecEdit(spec: CampaignPageSpec, operation: SpecEditOperation): SafetyReport {
  void spec;
  return evaluateSpecPatchSafety([operationToJsonPatch(operation)]);
}

export function applySpecEdit(spec: CampaignPageSpec, operation: SpecEditOperation): SpecEditResult {
  const patch = [operationToJsonPatch(operation)];
  const safety = validateSpecEdit(spec, operation);

  if (safety.forbiddenChanges || safety.risk === "blocked") {
    return {
      status: "blocked",
      operation,
      spec,
      patch,
      safety,
    };
  }

  const next = applySpecPatch(spec, patch);
  return {
    status: safety.risk === "low" ? "applied" : "needsOwnerReview",
    operation,
    spec: next,
    patch,
    safety: {
      ...safety,
      reasons: [...safety.reasons, "Owner edit was validated and applied to the in-memory CampaignPageSpec."],
      publishAllowed: false,
    },
  };
}

export function createPatchPlanFromSpecEdit(spec: CampaignPageSpec, operation: SpecEditOperation): PatchPlan {
  const safety = validateSpecEdit(spec, operation);
  const patch = [operationToJsonPatch(operation)];
  return {
    id: operation.id ?? `plan-edit-${Date.now()}`,
    status: safety.risk === "blocked" ? "blocked" : safety.risk === "low" ? "proposed" : "needsOwnerReview",
    source: "manualEdit",
    intent: { kind: "copy", summary: operation.label ?? `Owner edit ${operation.path}` },
    target: { specPath: operation.path },
    operations: summarizeOperations(patch, "copy"),
    proposedChange: safety.risk === "blocked" ? {} : { specPatch: patch },
    safety,
  };
}

export function applySpecPatch(spec: CampaignPageSpec, patch: JsonPatchOperation[]): CampaignPageSpec {
  const next = structuredClone(spec) as CampaignPageSpec;
  for (const operation of patch) {
    applyJsonPatchOperation(next as unknown as JsonObject, operation);
  }
  return next;
}

export function evaluateSpecPatchSafety(patch: JsonPatchOperation[]): SafetyReport {
  if (patch.length === 0) {
    return blockedSafetyReport("No safe spec-level patch could be proposed for this request.");
  }

  const reasons: string[] = [];
  let risk: SafetyReport["risk"] = "low";
  let forbiddenChanges = false;

  for (const operation of patch) {
    const serialized = JSON.stringify(operation);

    if (/integrations|analytics|destination|billing|price|legal|script/i.test(operation.path)) {
      risk = maxRisk(risk, "high");
      reasons.push(`Protected path requires explicit owner review: ${operation.path}`);
    }

    if (/href/i.test(operation.path)) {
      risk = maxRisk(risk, "medium");
      reasons.push(`Link destination change requires owner review: ${operation.path}`);
    }

    if (/javascript:/i.test(serialized)) {
      risk = "blocked";
      forbiddenChanges = true;
      reasons.push("javascript: URLs are blocked.");
    }

    if (!operation.path.startsWith("/sections/") && !operation.path.startsWith("/seo/") && !operation.path.startsWith("/contentStrategy/")) {
      risk = maxRisk(risk, "medium");
      reasons.push(`Patch touches non-section path: ${operation.path}`);
    }
  }

  if (reasons.length === 0) reasons.push("Spec-level change only; no generated code patch required.");
  return {
    risk,
    reasons,
    touchedFiles: ["stitch/page.spec.json"],
    forbiddenChanges,
    requiresOwnerApproval: true,
    publishAllowed: false,
  };
}

function operationToJsonPatch(operation: SpecEditOperation): JsonPatchOperation {
  if (operation.op === "remove") return { op: "remove", path: operation.path };
  if (operation.op === "add") return { op: "add", path: operation.path, value: operation.value };
  return { op: "replace", path: operation.path, value: operation.value };
}

function blockedPlan(pin: ChangePin, reason: string, intentKind: IntentKind = "unknown"): PatchPlan {
  return {
    id: `plan-${pin.id}`,
    status: "blocked",
    source: "pin",
    intent: { kind: intentKind, summary: pin.comment },
    target: {},
    operations: [{ kind: "manualReview", description: reason }],
    proposedChange: {},
    safety: blockedSafetyReport(reason),
  };
}

function findTargetSection(spec: CampaignPageSpec, pin: ChangePin): { section: SectionSpec | undefined; index: number } {
  if (pin.target.sectionId) {
    const index = spec.sections.findIndex((section) => section.id === pin.target.sectionId);
    if (index >= 0) return { section: spec.sections[index], index };
  }

  const text = (pin.context.selectedText || pin.target.text || pin.context.nearbyText.join(" ")).toLowerCase().slice(0, 200);
  if (text) {
    const index = spec.sections.findIndex((section) => {
      const haystack = sectionHaystack(section);
      return haystack.includes(text) || text.includes((section.heading ?? "never-match").toLowerCase());
    });
    if (index >= 0) return { section: spec.sections[index], index };
  }

  return { section: spec.sections[0], index: spec.sections.length > 0 ? 0 : -1 };
}

function proposeSpecPatch(section: SectionSpec, specPath: string, intent: IntentKind, pin: ChangePin): JsonPatchOperation[] {
  const elementId = normalizeElementId(pin.target.elementId);

  if (intent === "copy") {
    const value = extractRequestedCopy(pin.comment) ?? pin.comment;

    if (elementId === "primaryCta" || /button|cta|label|say/i.test(pin.comment)) {
      if (section.primaryCta) return [{ op: "replace", path: `${specPath}/primaryCta/label`, value }];
    }

    if (elementId === "secondaryCta" && section.secondaryCta) {
      return [{ op: "replace", path: `${specPath}/secondaryCta/label`, value }];
    }

    if (elementId === "heading" || /headline|heading|title/i.test(pin.comment)) {
      return [{ op: "replace", path: `${specPath}/heading`, value }];
    }

    if (elementId === "body" || /body|paragraph|subheadline|description|copy/i.test(pin.comment)) {
      return [{ op: "replace", path: `${specPath}/body`, value }];
    }

    if (section.type === "FinalCTA" && section.primaryCta && /cta|button/i.test(pin.comment)) {
      return [{ op: "replace", path: `${specPath}/primaryCta/label`, value }];
    }

    return [{ op: "replace", path: section.body ? `${specPath}/body` : `${specPath}/heading`, value }];
  }

  if (intent === "style") {
    return [{ op: "replace", path: `${specPath}/variant`, value: inferStyleVariant(pin.comment, section.variant) }];
  }

  if (intent === "link") {
    const href = extractUrl(pin.comment);
    if (href && section.primaryCta) return [{ op: "replace", path: `${specPath}/primaryCta/href`, value: href }];
  }

  return [];
}

function summarizeOperations(patch: JsonPatchOperation[], intent: IntentKind): PatchOperationSummary[] {
  if (patch.length === 0) return [{ kind: "manualReview", description: `No safe ${intent} operation is available for this request yet.` }];
  return patch.map((operation) => ({
    kind: "specPatch",
    path: operation.path,
    description: `${operation.op} ${operation.path}`,
  }));
}

function sectionHaystack(section: SectionSpec): string {
  return [
    section.id,
    section.type,
    section.heading,
    section.body,
    section.primaryCta?.label,
    section.secondaryCta?.label,
    ...(section.items ?? []).flatMap((item) => Object.values(item).map(String)),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

type JsonObject = Record<string, unknown>;

function applyJsonPatchOperation(root: JsonObject, operation: JsonPatchOperation): void {
  const segments = operation.path.split("/").filter(Boolean).map(unescapePointerSegment);
  if (segments.length === 0) return;

  const parent = resolveParent(root, segments);
  const key = segments.at(-1);
  if (!parent || key === undefined) return;

  if (Array.isArray(parent)) {
    const index = key === "-" ? parent.length : Number(key);
    if (!Number.isInteger(index) || index < 0) return;
    if (operation.op === "remove") parent.splice(index, 1);
    if (operation.op === "replace") parent[index] = operation.value;
    if (operation.op === "add") parent.splice(index, 0, operation.value);
    return;
  }

  const objectParent = parent as JsonObject;
  if (operation.op === "remove") delete objectParent[key];
  if (operation.op === "replace" || operation.op === "add") objectParent[key] = operation.value;
}

function resolveParent(root: JsonObject, segments: string[]): unknown {
  let current: unknown = root;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(current)) {
      current = current[Number(segment)];
    } else if (current && typeof current === "object") {
      current = (current as JsonObject)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function unescapePointerSegment(value: string): string {
  return value.replace(/~1/g, "/").replace(/~0/g, "~");
}

function normalizeElementId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const last = value.split(".").at(-1);
  return last || value;
}

function extractRequestedCopy(value: string): string | undefined {
  return extractQuotedText(value) ?? extractAfterSay(value) ?? extractAfterChangeTo(value);
}

function extractQuotedText(value: string): string | undefined {
  return value.match(/[“"]([^”"]+)[”"]/u)?.[1] ?? value.match(/[']([^']+)[']/)?.[1];
}

function extractAfterSay(value: string): string | undefined {
  return value.match(/(?:say|read|label it|rename it)\s+(.+)$/i)?.[1]?.trim().replace(/[.。]$/, "");
}

function extractAfterChangeTo(value: string): string | undefined {
  return value.match(/(?:change|make|set).+?\bto\b\s+(.+)$/i)?.[1]?.trim().replace(/[.。]$/, "");
}

function extractUrl(value: string): string | undefined {
  return value.match(/https?:\/\/[^\s)]+/i)?.[0];
}

function inferStyleVariant(comment: string, fallback: string | undefined): string {
  if (/stand out|premium|featured|highlight/i.test(comment)) return "featured";
  if (/simple|minimal|clean/i.test(comment)) return "minimal";
  if (/dark|contrast/i.test(comment)) return "contrast";
  if (/brand|accent/i.test(comment)) return "brand";
  return fallback ?? "default";
}

function maxRisk(current: SafetyReport["risk"], next: SafetyReport["risk"]): SafetyReport["risk"] {
  const order: SafetyReport["risk"][] = ["low", "medium", "high", "blocked"];
  return order[Math.max(order.indexOf(current), order.indexOf(next))] ?? current;
}


export function validatePublishReadiness(spec: CampaignPageSpec, profile: BuildProfile): PublishReadiness {
  const warnings = createPublishWarnings(spec, profile);
  const blocked = warnings.some((warning) => warning.severity === "blocked");
  const status: PublishReadiness["status"] = blocked ? "blocked" : warnings.some((warning) => warning.severity === "warning") ? "needsReview" : "ready";
  return {
    status,
    profile,
    warnings,
    safety: {
      risk: blocked ? "blocked" : status === "needsReview" ? "medium" : "low",
      reasons: warnings.length > 0 ? warnings.map((warning) => warning.message) : ["Bundle is ready for owner-approved export/publish handoff."],
      touchedFiles: ["stitch/page.spec.json", "stitch/deploy-manifest.json"],
      forbiddenChanges: blocked,
      requiresOwnerApproval: true,
      publishAllowed: status === "ready" && profile === "production",
    },
  };
}

export function validateBundleForProfile(bundle: GeneratedSiteBundle): PublishReadiness {
  const readiness = validatePublishReadiness(bundle.spec, bundle.buildProfile);
  const bundleWarnings: PublishWarning[] = [...readiness.warnings, ...bundle.warnings];
  const hasBlocked = bundleWarnings.some((warning) => warning.severity === "blocked");
  const hasWarning = bundleWarnings.some((warning) => warning.severity === "warning");
  const productionHasOwnerWorkbench = bundle.buildProfile === "production" && bundle.files.some((file) => file.path.includes("/_stitch") || file.path.includes("public/_stitch"));
  const finalWarnings = productionHasOwnerWorkbench
    ? [...bundleWarnings, { code: "owner-capsule-included", severity: "blocked", message: "Production bundle must not include owner workbench assets." } satisfies PublishWarning]
    : bundleWarnings;
  const status: PublishReadiness["status"] = hasBlocked || productionHasOwnerWorkbench ? "blocked" : hasWarning ? "needsReview" : "ready";
  return {
    status,
    profile: bundle.buildProfile,
    warnings: finalWarnings,
    safety: {
      risk: status === "blocked" ? "blocked" : status === "needsReview" ? "medium" : "low",
      reasons: finalWarnings.length > 0 ? finalWarnings.map((warning) => warning.message) : ["Generated bundle matches selected build profile."],
      touchedFiles: bundle.manifest.map((item) => item.path),
      forbiddenChanges: status === "blocked",
      requiresOwnerApproval: true,
      publishAllowed: status === "ready" && bundle.buildProfile === "production",
    },
  };
}

function createPublishWarnings(spec: CampaignPageSpec, profile: BuildProfile): PublishWarning[] {
  const warnings: PublishWarning[] = [];
  if (profile === "owner") warnings.push({ code: "owner-capsule-included", severity: "warning", message: "Owner profile includes the private workbench. Keep it behind owner access controls." });
  if (profile === "review") warnings.push({ code: "review-runtime-included", severity: "info", message: "Review profile includes comment-only client feedback runtime." });
  for (const form of spec.integrations?.forms ?? []) {
    if (!form.destination) warnings.push({ code: "unknown-form-destination", severity: "warning", message: `Form ${form.id} has no verified destination.` });
  }
  for (const section of spec.sections) {
    if (section.primaryCta && (!section.primaryCta.href || section.primaryCta.href === "#")) {
      warnings.push({ code: "missing-cta-href", severity: "warning", message: `Primary CTA in ${section.id} has no production-ready href.` });
    }
  }
  return warnings;
}

export function specOperationToJsonPatch(spec: CampaignPageSpec, operation: SpecOperation): JsonPatchOperation[] {
  if (operation.kind === "editContentStrategy" || operation.kind === "editSeo") {
    return [{ op: "replace", path: operation.path, value: operation.value }];
  }

  if (operation.kind === "addSection") {
    const afterIndex = operation.afterSectionId ? spec.sections.findIndex((section) => section.id === operation.afterSectionId) : spec.sections.length - 1;
    const insertIndex = Math.max(0, afterIndex + 1);
    return [{ op: "add", path: `/sections/${insertIndex}`, value: operation.section }];
  }

  const sectionIndex = spec.sections.findIndex((section) => section.id === operation.sectionId);
  if (sectionIndex < 0) return [];
  const sectionPath = `/sections/${sectionIndex}`;

  if (operation.kind === "removeSection") return [{ op: "remove", path: sectionPath }];
  if (operation.kind === "editSectionSlot") return [{ op: "replace", path: `${sectionPath}/${operation.slot}`, value: operation.value }];
  if (operation.kind === "changeSectionVariant") return [{ op: "replace", path: `${sectionPath}/variant`, value: operation.variant }];
  if (operation.kind === "editCtaLabel") return [{ op: "replace", path: `${sectionPath}/${operation.cta === "primary" ? "primaryCta" : "secondaryCta"}/label`, value: operation.label }];
  if (operation.kind === "editCtaHref") return [{ op: "replace", path: `${sectionPath}/${operation.cta === "primary" ? "primaryCta" : "secondaryCta"}/href`, value: operation.href }];
  return [];
}

export function validateSpecOperation(spec: CampaignPageSpec, operation: SpecOperation): SafetyReport {
  const patch = specOperationToJsonPatch(spec, operation);
  if (patch.length === 0) return blockedSafetyReport(`Spec operation could not be mapped safely: ${operation.kind}`);

  const base = evaluateSpecPatchSafety(patch);
  const reasons = [...base.reasons];
  let risk = base.risk;
  let forbiddenChanges = base.forbiddenChanges;

  if (operation.kind === "editCtaHref") {
    risk = maxRisk(risk, "medium");
    reasons.push("CTA href edits require owner review even when proposed by inference.");
  }
  if (operation.kind === "removeSection" || operation.kind === "addSection") {
    risk = maxRisk(risk, "medium");
    reasons.push("Section structure changes require owner review.");
  }
  if (operation.kind === "editCtaHref" && /^javascript:/i.test(operation.href)) {
    risk = "blocked";
    forbiddenChanges = true;
    reasons.push("javascript: URLs are blocked.");
  }
  if (operation.source === "inference") {
    reasons.push("Inference proposed this operation; kernel validation is required before application.");
  }

  return {
    ...base,
    risk,
    forbiddenChanges,
    reasons,
    requiresOwnerApproval: true,
    publishAllowed: false,
  };
}

export function applySpecOperations(spec: CampaignPageSpec, operations: SpecOperation[]): { spec: CampaignPageSpec; results: SpecOperationResult[]; accepted: SpecOperation[]; rejected: SpecOperation[] } {
  let next = spec;
  const results: SpecOperationResult[] = [];
  const accepted: SpecOperation[] = [];
  const rejected: SpecOperation[] = [];

  for (const operation of operations) {
    const patch = specOperationToJsonPatch(next, operation);
    const safety = validateSpecOperation(next, operation);
    if (safety.forbiddenChanges || safety.risk === "blocked" || patch.length === 0) {
      rejected.push(operation);
      results.push({ status: "blocked", operation, patch, safety, spec: next });
      continue;
    }

    next = applySpecPatch(next, patch);
    accepted.push(operation);
    results.push({ status: safety.risk === "low" ? "applied" : "needsOwnerReview", operation, patch, safety, spec: next });
  }

  return { spec: next, results, accepted, rejected };
}

export function createPatchPlanFromInference(spec: CampaignPageSpec, operations: SpecOperation[], summary = "Inference-proposed contract operation"): PatchPlan {
  const patches = operations.flatMap((operation) => specOperationToJsonPatch(spec, operation));
  const safety = mergeSafetyReports(operations.map((operation) => validateSpecOperation(spec, operation)));
  return {
    id: `plan-inference-${Date.now()}`,
    status: safety.risk === "blocked" ? "blocked" : safety.risk === "low" ? "proposed" : "needsOwnerReview",
    source: "migrationRepair",
    intent: { kind: "copy", summary },
    target: { specPath: "/" },
    operations: operations.map((operation) => {
      const path = specOperationToJsonPatch(spec, operation)[0]?.path;
      return path
        ? { kind: "specPatch", description: describeSpecOperation(operation), path }
        : { kind: "manualReview", description: `${describeSpecOperation(operation)} could not be mapped to a JSON patch.` };
    }),
    proposedChange: safety.risk === "blocked" ? {} : { specPatch: patches },
    safety,
  };
}

export function createCampaignVariantPlan(request: CampaignVariantRequest, operations: SpecOperation[]): CampaignVariantResult {
  const applied = applySpecOperations(request.baseSpec, operations);
  const safety = mergeSafetyReports(applied.results.map((result) => result.safety));
  return {
    variantSpec: applied.spec,
    operations: applied.accepted,
    safety,
    summary: `Created a contract-level campaign variant${request.audience ? ` for ${request.audience}` : ""}.`,
  };
}

function describeSpecOperation(operation: SpecOperation): string {
  if (operation.kind === "editSectionSlot") return `Edit ${operation.sectionId}.${operation.slot}`;
  if (operation.kind === "editCtaLabel") return `Edit ${operation.sectionId}.${operation.cta} CTA label`;
  if (operation.kind === "editCtaHref") return `Edit ${operation.sectionId}.${operation.cta} CTA href`;
  if (operation.kind === "changeSectionVariant") return `Change ${operation.sectionId} variant`;
  if (operation.kind === "addSection") return `Add ${operation.section.type} section`;
  if (operation.kind === "removeSection") return `Remove ${operation.sectionId}`;
  if (operation.kind === "editContentStrategy") return `Edit ${operation.path}`;
  return `Edit ${operation.path}`;
}

function mergeSafetyReports(reports: SafetyReport[]): SafetyReport {
  if (reports.length === 0) return blockedSafetyReport("No operations were provided for validation.");
  const risk = reports.reduce<SafetyReport["risk"]>((current, report) => maxRisk(current, report.risk), "low");
  return {
    risk,
    reasons: reports.flatMap((report) => report.reasons),
    touchedFiles: [...new Set(reports.flatMap((report) => report.touchedFiles))],
    forbiddenChanges: reports.some((report) => report.forbiddenChanges),
    requiresOwnerApproval: true,
    publishAllowed: false,
  };
}


export type CreateProjectStateOptions = {
  id?: string;
  createdAt?: string;
  migrationReport?: MigrationReport;
  initialBundle?: GeneratedSiteBundle;
  source?: ChangeSource;
  actor?: StitchEvent["actor"];
};

export function createInitialProjectState(spec: CampaignPageSpec, options: CreateProjectStateOptions = {}): StitchProjectState {
  const now = options.createdAt ?? new Date().toISOString();
  const projectId = options.id ?? `project-${spec.id}`;
  const createdEvent = createStateEvent("project.created", options.source ?? "migration", `Created Stitch project state for ${spec.title}.`, {
    actor: options.actor ?? { role: "system" },
    data: { specId: spec.id, title: spec.title },
  });
  const events: StitchEvent[] = [createdEvent];

  if (options.migrationReport) {
    events.push(
      createStateEvent("migration.created", "migration", `Captured and normalized ${options.migrationReport.sourceUrl}.`, {
        data: { confidence: options.migrationReport.confidence, warnings: options.migrationReport.warnings.length },
      })
    );
  }

  if (options.initialBundle) {
    events.push(
      createStateEvent("bundle.generated", "bundle", `Generated ${options.initialBundle.buildProfile} bundle with ${options.initialBundle.files.length} files.`, {
        data: { profile: options.initialBundle.buildProfile, files: options.initialBundle.files.length },
      })
    );
  }

  const initialState: StitchProjectState = {
    id: projectId,
    version: 1,
    createdAt: now,
    updatedAt: now,
    spec,
    brand: spec.brand,
    contentStrategy: spec.contentStrategy,
    pins: [],
    patchPlans: [],
    appliedOperations: [],
    events,
    snapshots: [],
    provenance: [
      createProvenanceRecord("migration", "Initial campaign spec became the canonical project state.", {
        eventId: createdEvent.id,
        policy: "stitch-project-state-v0",
        inputHash: stableHash(JSON.stringify(spec)),
      }),
    ],
  };

  if (options.migrationReport) initialState.migrationReport = options.migrationReport;
  if (options.initialBundle) initialState.currentBundle = options.initialBundle;
  return createSnapshot(initialState, "Initial imported state", createdEvent.id).state;
}

export function createStateEvent(
  kind: StitchEventKind,
  source: ChangeSource,
  summary: string,
  options: Partial<Omit<StitchEvent, "id" | "kind" | "source" | "summary" | "createdAt">> = {}
): StitchEvent {
  return {
    id: options.relatedPinId ? `event-${kind}-${options.relatedPinId}` : `event-${kind}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    kind,
    source,
    summary,
    createdAt: new Date().toISOString(),
    ...(options.actor ? { actor: options.actor } : {}),
    ...(options.relatedPinId ? { relatedPinId: options.relatedPinId } : {}),
    ...(options.relatedPatchPlanId ? { relatedPatchPlanId: options.relatedPatchPlanId } : {}),
    ...(options.relatedSnapshotId ? { relatedSnapshotId: options.relatedSnapshotId } : {}),
    ...(options.relatedOperationIds ? { relatedOperationIds: options.relatedOperationIds } : {}),
    ...(options.data ? { data: options.data } : {}),
  };
}

export function appendEvent(state: StitchProjectState, event: StitchEvent): StitchProjectState {
  return {
    ...state,
    version: state.version + 1,
    updatedAt: event.createdAt,
    events: [...state.events, event],
  };
}

export function reduceProjectState(state: StitchProjectState, event: StitchEvent): StitchProjectState {
  const next = appendEvent(state, event);
  if (event.kind === "pin.created" && event.data?.pin && isChangePin(event.data.pin)) {
    return { ...next, pins: [...next.pins, event.data.pin] };
  }
  if (event.kind === "patchPlan.created" && event.data?.patchPlan && isPatchPlan(event.data.patchPlan)) {
    return { ...next, patchPlans: [...next.patchPlans, event.data.patchPlan] };
  }
  if (event.kind === "bundle.generated" && event.data?.bundle && isGeneratedBundle(event.data.bundle)) {
    return { ...next, currentBundle: event.data.bundle };
  }
  return next;
}

export function recordPin(state: StitchProjectState, pin: ChangePin): StitchProjectState {
  const actor: StitchEvent["actor"] = pin.author
    ? { ...(pin.author.name ? { name: pin.author.name } : {}), ...(pin.author.email ? { email: pin.author.email } : {}), role: "reviewer" }
    : { role: "reviewer" };
  const event = createStateEvent("pin.created", "pin", `Reviewer requested: ${pin.comment}`, {
    actor,
    relatedPinId: pin.id,
    data: { pin },
  });
  return reduceProjectState(state, event);
}

export function recordPatchPlan(state: StitchProjectState, plan: PatchPlan): StitchProjectState {
  const event = createStateEvent("patchPlan.created", plan.source === "pin" ? "pin" : "system", `Created patch plan ${plan.id}: ${plan.intent.summary}`, {
    relatedPatchPlanId: plan.id,
    data: { patchPlan: plan, safety: plan.safety },
  });
  return reduceProjectState(state, event);
}

export function applySpecOperationsWithHistory(
  state: StitchProjectState,
  operations: SpecOperation[],
  options: { source?: ChangeSource; summary?: string; actor?: StitchEvent["actor"]; snapshotLabel?: string } = {}
): StateReductionResult {
  const source = options.source ?? (operations.some((operation) => operation.source === "inference") ? "inference" : "owner");
  const proposed = createStateEvent("specOperation.proposed", source, options.summary ?? `Proposed ${operations.length} spec operation(s).`, {
    ...(options.actor ? { actor: options.actor } : {}),
    relatedOperationIds: operations.map((operation, index) => operation.id ?? `${operation.kind}-${index}`),
    data: { operations },
  });

  const applied = applySpecOperations(state.spec, operations);
  const appliedEvent = createStateEvent("specOperation.applied", source, `Applied ${applied.accepted.length} spec operation(s); rejected ${applied.rejected.length}.`, {
    ...(options.actor ? { actor: options.actor } : {}),
    relatedOperationIds: applied.accepted.map((operation, index) => operation.id ?? `${operation.kind}-${index}`),
    data: { accepted: applied.accepted, rejected: applied.rejected, results: applied.results.map((result) => ({ status: result.status, patch: result.patch, safety: result.safety })) },
  });

  let next: StitchProjectState = appendEvent(state, proposed);
  next = {
    ...appendEvent(next, appliedEvent),
    spec: applied.spec,
    brand: applied.spec.brand,
    contentStrategy: applied.spec.contentStrategy,
    appliedOperations: [...next.appliedOperations, ...applied.results],
    provenance: [
      ...next.provenance,
      createProvenanceRecord(source, appliedEvent.summary, {
        eventId: appliedEvent.id,
        policy: "spec-operation-validation-v0",
        inputHash: stableHash(JSON.stringify(operations)),
        outputHash: stableHash(JSON.stringify(applied.spec)),
      }),
    ],
  };

  const snapshotResult = createSnapshot(next, options.snapshotLabel ?? appliedEvent.summary, appliedEvent.id);
  return { state: snapshotResult.state, events: [proposed, appliedEvent], snapshot: snapshotResult.snapshot };
}

export function createSnapshot(state: StitchProjectState, label: string, eventId?: string): { state: StitchProjectState; snapshot: StateSnapshot } {
  const snapshot: StateSnapshot = {
    id: `snapshot-${state.version}-${stableHash(JSON.stringify(state.spec)).slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    stateVersion: state.version,
    ...(eventId ? { eventId } : {}),
    label,
    spec: state.spec,
    checksum: stableHash(JSON.stringify(state.spec)),
  };
  const exists = state.snapshots.some((item) => item.id === snapshot.id);
  return {
    state: exists ? state : { ...state, snapshots: [...state.snapshots, snapshot] },
    snapshot,
  };
}

export function createUndoPlan(state: StitchProjectState, snapshotId: string): UndoPlan {
  const snapshot = state.snapshots.find((item) => item.id === snapshotId);
  return {
    id: `undo-${snapshotId}`,
    createdAt: new Date().toISOString(),
    fromStateVersion: state.version,
    toSnapshotId: snapshotId,
    reversible: Boolean(snapshot),
    summary: snapshot ? `Restore spec to snapshot "${snapshot.label}" from state version ${snapshot.stateVersion}.` : `Snapshot ${snapshotId} was not found.`,
    warnings: snapshot ? [] : ["Cannot restore a missing snapshot."],
  };
}

export function restoreSnapshot(state: StitchProjectState, snapshotId: string): StateReductionResult {
  const plan = createUndoPlan(state, snapshotId);
  if (!plan.reversible) return { state, events: [] };
  const snapshot = state.snapshots.find((item) => item.id === snapshotId);
  if (!snapshot) return { state, events: [] };
  const event = createStateEvent("snapshot.restored", "owner", plan.summary, { relatedSnapshotId: snapshotId, data: { undoPlan: plan } });
  const next = {
    ...appendEvent(state, event),
    spec: snapshot.spec,
    brand: snapshot.spec.brand,
    contentStrategy: snapshot.spec.contentStrategy,
    provenance: [...state.provenance, createProvenanceRecord("owner", plan.summary, { eventId: event.id, policy: "snapshot-restore-v0", outputHash: snapshot.checksum })],
  };
  return { state: next, events: [event], snapshot };
}

export function summarizeChangeHistory(state: StitchProjectState): string[] {
  return state.events.map((event) => `${event.createdAt} · ${event.kind} · ${event.source} · ${event.summary}`);
}

export function createProvenanceRecord(
  source: ChangeSource,
  summary: string,
  options: Partial<Omit<ProvenanceRecord, "id" | "createdAt" | "source" | "summary">> = {}
): ProvenanceRecord {
  return {
    id: `prov-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    source,
    summary,
    ...(options.eventId ? { eventId: options.eventId } : {}),
    ...(options.inputHash ? { inputHash: options.inputHash } : {}),
    ...(options.outputHash ? { outputHash: options.outputHash } : {}),
    ...(options.policy ? { policy: options.policy } : {}),
    ...(options.model ? { model: options.model } : {}),
  };
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function isChangePin(value: unknown): value is ChangePin {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string" && typeof (value as { comment?: unknown }).comment === "string";
}

function isPatchPlan(value: unknown): value is PatchPlan {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string" && typeof (value as { intent?: unknown }).intent === "object";
}

function isGeneratedBundle(value: unknown): value is GeneratedSiteBundle {
  return typeof value === "object" && value !== null && Array.isArray((value as { files?: unknown }).files) && typeof (value as { buildProfile?: unknown }).buildProfile === "string";
}

export function validateFeedbackBundle(bundle: FeedbackBundle): { valid: boolean; warnings: string[]; rejectedPins: Array<{ pin?: ChangePin; reason: string }> } {
  const warnings: string[] = [];
  const rejectedPins: Array<{ pin?: ChangePin; reason: string }> = [];
  if (bundle.kind !== "stitch-feedback-bundle") warnings.push("Bundle kind is not stitch-feedback-bundle.");
  if (bundle.version !== "0.1.0") warnings.push(`Unexpected feedback bundle version: ${bundle.version}.`);
  if (bundle.pins.length === 0) warnings.push("Feedback bundle contains no pins.");
  const seen = new Set<string>();
  for (const pin of bundle.pins) {
    if (!isChangePin(pin)) {
      rejectedPins.push({ reason: "Bundle item is not a valid ChangePin." });
      continue;
    }
    if (seen.has(pin.id)) rejectedPins.push({ pin, reason: "Duplicate pin inside bundle." });
    seen.add(pin.id);
    if (pin.permissions.canEdit || pin.permissions.canGeneratePatch || pin.permissions.canPublish) {
      rejectedPins.push({ pin, reason: "Review pin attempted to carry edit, patch, or publish permissions." });
    }
  }
  return { valid: rejectedPins.length === 0, warnings, rejectedPins };
}

export function dedupeChangePins(existing: ChangePin[], incoming: ChangePin[]): { imported: ChangePin[]; duplicates: ChangePin[] } {
  const existingIds = new Set(existing.map((pin) => pin.id));
  const imported: ChangePin[] = [];
  const duplicates: ChangePin[] = [];
  for (const pin of incoming) {
    if (existingIds.has(pin.id) || imported.some((item) => item.id === pin.id)) duplicates.push(pin);
    else imported.push(pin);
  }
  return { imported, duplicates };
}

export function createPinImportedEvents(bundle: FeedbackBundle, pins: ChangePin[]): StitchEvent[] {
  return pins.map((pin) =>
    createStateEvent("pin.created", "pin", `Imported reviewer feedback from ${bundle.source.transport}: ${pin.comment}`, {
      relatedPinId: pin.id,
      actor: pin.author
        ? { ...(pin.author.name ? { name: pin.author.name } : {}), ...(pin.author.email ? { email: pin.author.email } : {}), role: "reviewer" }
        : { role: "reviewer" },
      data: { pin, feedbackBundleId: bundle.id, transport: bundle.source.transport },
    })
  );
}

export function importFeedbackBundleIntoState(state: StitchProjectState, bundle: FeedbackBundle): FeedbackImportResult {
  const validation = validateFeedbackBundle(bundle);
  const validPins = bundle.pins.filter((pin) => isChangePin(pin) && !validation.rejectedPins.some((rejection) => rejection.pin?.id === pin.id));
  const deduped = dedupeChangePins(state.pins, validPins);
  const importEvent = createStateEvent("state.imported", "storage", `Imported feedback bundle ${bundle.id} from ${bundle.source.transport}.`, {
    data: {
      feedbackBundleId: bundle.id,
      transport: bundle.source.transport,
      pins: bundle.pins.length,
      imported: deduped.imported.length,
      duplicates: deduped.duplicates.length,
      rejected: validation.rejectedPins.length,
    },
  });
  const pinEvents = createPinImportedEvents(bundle, deduped.imported);
  let next = reduceProjectState(state, importEvent);
  for (const event of pinEvents) next = reduceProjectState(next, event);
  const provenance = createProvenanceRecord("storage", `Feedback bundle ${bundle.id} imported into project state.`, {
    eventId: importEvent.id,
    policy: "feedback-transport-import-v0",
    inputHash: stableHash(JSON.stringify(bundle)),
    outputHash: stableHash(JSON.stringify(deduped.imported.map((pin) => pin.id))),
  });
  next = { ...next, provenance: [...next.provenance, provenance] };
  return {
    status: validation.rejectedPins.length > 0 ? (deduped.imported.length > 0 ? "partial" : "blocked") : "imported",
    bundleId: bundle.id,
    importedPins: deduped.imported,
    duplicatePins: deduped.duplicates,
    rejectedPins: validation.rejectedPins,
    events: [importEvent, ...pinEvents],
    state: next,
    warnings: validation.warnings,
  };
}



export function validateBootstrapForOwnership(bootstrap: MigrationBootstrap): MigrationBootstrapValidationResult {
  const contractValidation = validateMigrationBootstrap(bootstrap);
  const warnings = [...contractValidation.warnings];
  const normalizedFields = [...contractValidation.normalizedFields];
  const spec = adaptMigrationBootstrapToCampaignPageSpec(bootstrap);
  const report = adaptMigrationBootstrapToMigrationReport(bootstrap);
  const bootstrapWarnings = getBootstrapWarnings(bootstrap);

  if (!spec.id || !Array.isArray(spec.sections)) warnings.push("Bootstrap adapter could not produce a valid CampaignPageSpec.");
  if ((spec.sections ?? []).length === 0) warnings.push("Bootstrap page contains no adaptable sections.");
  if (bootstrap.handoff.privacySummary.containsSecrets) warnings.push("Bootstrap privacy summary indicates secrets are present.");
  if (bootstrap.handoff.privacySummary.containsRawDom) warnings.push("Bootstrap contains raw DOM; ingestion should preserve only private provenance.");
  if (bootstrap.handoff.privacySummary.containsScripts) warnings.push("Bootstrap contains scripts; production generation requires owner review.");
  if (bootstrapWarnings.some((warning) => warning.severity === "blocked")) warnings.push("Migration endpoint returned blocked migration warnings.");
  if (bootstrap.report.score < 0.55) warnings.push("Migration confidence is low and needs owner review.");

  const blocked = !contractValidation.valid || !spec.id || !Array.isArray(spec.sections) || spec.sections.length === 0 || bootstrap.handoff.privacySummary.containsSecrets;
  const needsReview = !blocked && (warnings.length > 0 || report.confidence < 0.7 || bootstrapWarnings.some((warning) => warning.severity === "warning"));

  return {
    valid: !blocked,
    status: blocked ? "blocked" : needsReview ? "needsReview" : "accepted",
    warnings,
    normalizedFields,
  };
}

export function createBootstrapIngestedEvent(bootstrap: MigrationBootstrap): StitchEvent {
  const report = adaptMigrationBootstrapToMigrationReport(bootstrap);
  return createStateEvent("migration.bootstrap.ingested", "migration", `Ingested migration bootstrap ${bootstrap.id} from ${getBootstrapSourceUrl(bootstrap)}.`, {
    data: {
      bootstrapId: bootstrap.id,
      source: bootstrap.source,
      designContractVersion: bootstrap.designContractVersion,
      recommendedProfile: getBootstrapBuildProfile(bootstrap),
      migrationConfidence: report.confidence,
      warnings: getBootstrapWarnings(bootstrap).length,
    },
  });
}

export function createProjectStateFromBootstrap(bootstrap: MigrationBootstrap): BootstrapIngestionResult {
  const validation = validateBootstrapForOwnership(bootstrap);
  const spec = adaptMigrationBootstrapToCampaignPageSpec(bootstrap);
  const report = adaptMigrationBootstrapToMigrationReport(bootstrap);
  const initial = createInitialProjectState(spec, {
    id: `project-${bootstrap.id}`,
    createdAt: bootstrap.createdAt,
    migrationReport: report,
    source: "migration",
    actor: { role: "system" },
  });
  const event = createBootstrapIngestedEvent(bootstrap);
  let state = reduceProjectState(initial, event);
  const provenance = createProvenanceRecord("migration", `Bootstrap ${bootstrap.id} became the owner-controlled Stitch project state.`, {
    eventId: event.id,
    policy: "migration-bootstrap-ingestion-v0.1",
    inputHash: stableHash(JSON.stringify(bootstrap)),
    outputHash: stableHash(JSON.stringify(spec)),
  });
  state = {
    ...state,
    provenance: [...state.provenance, provenance],
    migrationReport: report,
  };
  const snap = createSnapshot(state, `Original bootstrap import ${bootstrap.id}`, event.id);

  return {
    status: validation.status === "blocked" ? "blocked" : validation.status === "needsReview" ? "needsReview" : "ingested",
    bootstrapId: bootstrap.id,
    validation,
    projectState: snap.state,
    initialEvent: event,
    warnings: [...validation.warnings, ...getBootstrapWarnings(bootstrap).map((warning) => warning.message)],
  };
}


export function initializeProjectStateFromBootstrap(bootstrap: MigrationBootstrap): BootstrapIngestionResult {
  return createProjectStateFromBootstrap(bootstrap);
}

export function createProjectInstalledEvent(projectId: string, installPlan: InstallPlan): StitchEvent {
  return createStateEvent("project.installed", "system", `Installed Stitch project ${projectId} into ${installPlan.rootDir}.`, {
    data: {
      projectId,
      installPlanId: installPlan.id,
      rootDir: installPlan.rootDir,
      profile: installPlan.profile,
      target: installPlan.target,
      files: installPlan.files.length,
      nextActions: installPlan.nextActions.map((action) => action.kind),
    },
  });
}

export function summarizeProjectReadiness(state: StitchProjectState, installPlan?: InstallPlan): {
  status: "ready" | "needsReview" | "blocked";
  summary: string;
  warnings: string[];
  nextActions: string[];
} {
  const warnings = [
    ...(state.migrationReport?.warnings.map((warning) => warning.message) ?? []),
    ...(installPlan?.warnings.filter((warning) => warning.severity !== "info").map((warning) => warning.message) ?? []),
  ];
  const blocked = installPlan?.warnings.some((warning) => warning.severity === "blocked") ?? false;
  const status = blocked ? "blocked" : warnings.length > 0 ? "needsReview" : "ready";
  return {
    status,
    summary: status === "ready" ? "Project is ready for owner review/export." : status === "needsReview" ? "Project installed, but owner should inspect warnings before publishing." : "Project installation has blocking warnings.",
    warnings,
    nextActions: installPlan?.nextActions.map((action) => action.label) ?? ["Open the owner workbench", "Inspect migration warnings", "Create an export plan"],
  };
}


export function validateExportReadiness(artifact: ExportArtifact): ExportValidationResult {
  const warnings = [...artifact.validation.warnings];
  let status = artifact.validation.status;
  if (artifact.profile === "production" && artifact.privacy.includesOwnerWorkbench) {
    warnings.push("Production export contains owner workbench assets.");
    status = "blocked";
  }
  if (artifact.profile === "review" && artifact.privacy.includesOwnerWorkbench) {
    warnings.push("Review export should be comment-only and cannot include owner workbench assets.");
    status = "blocked";
  }
  if ((artifact.profile === "owner" || artifact.profile === "source") && artifact.privacy.privateFileCount > 0 && status === "ready") {
    warnings.push("Owner/source export includes private state and should remain in a user-owned private location.");
    status = "needsReview";
  }
  return { valid: status !== "blocked", status, warnings, privacy: artifact.privacy };
}

export function createExportCreatedEvent(artifact: ExportArtifact): StitchEvent {
  return createStateEvent("export.created", "system", `Created ${artifact.profile} export artifact ${artifact.id}.`, {
    data: {
      artifactId: artifact.id,
      profile: artifact.profile,
      fileCount: artifact.files.length,
      totalBytes: artifact.receipt.totalBytes,
      includesOwnerWorkbench: artifact.privacy.includesOwnerWorkbench,
      includesEventHistory: artifact.privacy.includesEventHistory,
      validationStatus: artifact.validation.status,
    },
  });
}

export function summarizeExportRisk(artifact: ExportArtifact): { status: "ready" | "needsReview" | "blocked"; summary: string; warnings: string[] } {
  const validation = validateExportReadiness(artifact);
  const summary = validation.status === "ready"
    ? `${artifact.profile} export is ready with ${artifact.files.length} file(s).`
    : validation.status === "needsReview"
      ? `${artifact.profile} export is usable but should be reviewed before sharing or publishing.`
      : `${artifact.profile} export is blocked by privacy/safety rules.`;
  return { status: validation.status, summary, warnings: validation.warnings };
}

export function validateDeployReadiness(pkg: DeployPackage): DeployReadinessReport {
  const warnings: DeployWarning[] = [...pkg.warnings];
  if (pkg.profile === "production" && pkg.files.some((file) => /_stitch|project\.state|events\.json/.test(file.path))) {
    warnings.push({ code: "private-state-in-public-package", severity: "blocked", message: "Production deploy package contains private capsule or state files." });
  }
  if (pkg.profile === "owner") {
    warnings.push({ code: "owner-profile-public-risk", severity: "warning", message: "Owner deploy packages are private by default and should not be published publicly." });
  }
  const blocked = warnings.some((warning) => warning.severity === "blocked");
  const needsReview = warnings.some((warning) => warning.severity === "warning");
  return {
    ...pkg.readiness,
    status: blocked ? "blocked" : needsReview ? "needsReview" : "ready",
    warnings,
    summary: blocked ? "Deploy package is blocked by privacy/readiness issues." : needsReview ? "Deploy package requires owner review before publishing." : "Deploy package is ready for user-owned hosting.",
  };
}

export function createDeployPackageCreatedEvent(pkg: DeployPackage): StitchEvent {
  return createStateEvent("publish.handoffCreated", "publish", `Created ${pkg.provider} deploy package for ${pkg.profile} export.`, {
    data: {
      deployPackageId: pkg.id,
      provider: pkg.provider,
      profile: pkg.profile,
      artifactId: pkg.artifactId,
      readiness: pkg.readiness.status,
    },
  });
}

export function summarizeDeployRisk(pkg: DeployPackage): { status: "ready" | "needsReview" | "blocked"; summary: string; warnings: string[] } {
  const readiness = validateDeployReadiness(pkg);
  return {
    status: readiness.status,
    summary: readiness.summary,
    warnings: readiness.warnings.map((warning) => warning.message),
  };
}

export function createCapsuleAccessPolicy(profile: CapsuleBuildProfile): CapsuleAccessPolicy {
  const visitorScopes: CapabilityScope[] = ["site:view"];
  const reviewerScopes: CapabilityScope[] = ["site:view", "comment:create", "feedback:export"];
  const ownerScopes: CapabilityScope[] = [
    "site:view",
    "comment:create",
    "feedback:export",
    "feedback:import",
    "spec:view",
    "spec:edit",
    "patch:plan",
    "patch:apply",
    "history:view",
    "history:restore",
    "bundle:export",
    "deploy:handoff",
  ];

  if (profile === "production") {
    return {
      profile,
      publicMode: "visitor",
      allowedModes: ["visitor"],
      scopesByMode: { visitor: visitorScopes, reviewer: [], owner: [] },
      ownerUnlock: { required: false, method: "none" },
      tokenRequiredFor: [],
      notes: ["Production builds expose no Stitch review or owner capabilities by default."],
    };
  }

  if (profile === "review") {
    return {
      profile,
      publicMode: "reviewer",
      allowedModes: ["visitor", "reviewer"],
      scopesByMode: { visitor: visitorScopes, reviewer: reviewerScopes, owner: [] },
      ownerUnlock: { required: false, method: "none" },
      tokenRequiredFor: ["comment:create", "feedback:export"],
      notes: ["Review builds are comment-only. Reviewers cannot edit specs, apply patches, export owner bundles, or publish."],
    };
  }

  return {
    profile,
    publicMode: "visitor",
    allowedModes: ["visitor", "reviewer", "owner"],
    scopesByMode: { visitor: visitorScopes, reviewer: reviewerScopes, owner: ownerScopes },
    ownerUnlock: {
      required: true,
      method: "localKey",
      storageKey: "stitch:owner-unlock",
      warning: "Owner mode is intended for local/private/staging contexts. Do not publish owner builds publicly without host-level access controls.",
    },
    tokenRequiredFor: ownerScopes.filter((scope) => scope !== "site:view"),
    notes: ["Owner builds include private capsule tools and must be explicitly unlocked before editing, patching, exporting, or deploy handoff actions."],
  };
}

export function validateCapability(policy: CapsuleAccessPolicy, token: CapabilityToken | undefined, scope: CapabilityScope): AccessValidationResult {
  const mode: AccessMode = token?.mode ?? policy.publicMode;
  const reasons: string[] = [];
  const allowedModes = policy.allowedModes.includes(mode);
  const scopes = policy.scopesByMode[mode] ?? [];
  const tokenExpired = token?.expiresAt ? Date.parse(token.expiresAt) <= Date.now() : false;

  if (!allowedModes) reasons.push(`${mode} mode is not allowed by the ${policy.profile} capsule policy.`);
  if (tokenExpired) reasons.push("Capability token is expired.");
  if (!scopes.includes(scope)) reasons.push(`${mode} mode does not include ${scope}.`);
  if (policy.ownerUnlock.required && scopeRequiresOwner(scope) && mode !== "owner") reasons.push("Owner unlock is required for this action.");

  return {
    allowed: allowedModes && !tokenExpired && scopes.includes(scope) && !(policy.ownerUnlock.required && scopeRequiresOwner(scope) && mode !== "owner"),
    mode,
    scope,
    reasons: reasons.length > 0 ? reasons : [`${scope} is allowed for ${mode} mode.`],
    requiredScopes: [scope],
    publicSafe: mode !== "owner" && !scopeRequiresOwner(scope),
  };
}

export function canPerformOperation(policy: CapsuleAccessPolicy, token: CapabilityToken | undefined, scope: CapabilityScope): boolean {
  return validateCapability(policy, token, scope).allowed;
}

export function createAccessDeniedResult(policy: CapsuleAccessPolicy, scope: CapabilityScope, token?: CapabilityToken): AccessValidationResult {
  const result = validateCapability(policy, token, scope);
  if (!result.allowed) return result;
  return {
    ...result,
    allowed: false,
    reasons: [`${scope} was denied by caller policy even though the base capability was present.`],
  };
}

export function auditPublicExposure(input: {
  profile: CapsuleBuildProfile | ExportProfile;
  files?: Array<{ path: string }>;
  includesOwnerTools?: boolean;
  includesReviewRuntime?: boolean;
  includesProjectState?: boolean;
  includesEventHistory?: boolean;
  includesMigrationBootstrap?: boolean;
}): PublicExposureAudit {
  const paths = input.files?.map((file) => file.path) ?? [];
  const includesOwnerTools = input.includesOwnerTools ?? paths.some((path) => /(^|\/)public\/_stitch\//.test(path) || path.includes("owner"));
  const includesReviewRuntime = input.includesReviewRuntime ?? paths.some((path) => path.includes("review-runtime"));
  const includesProjectState = input.includesProjectState ?? paths.some((path) => path.endsWith("project.state.json"));
  const includesEventHistory = input.includesEventHistory ?? paths.some((path) => path.endsWith("events.json") || path.endsWith("project.state.json"));
  const includesMigrationBootstrap = input.includesMigrationBootstrap ?? paths.some((path) => path.endsWith("migration.bootstrap.json"));
  const findings: PublicExposureFinding[] = [];

  if (includesOwnerTools) findings.push({ code: "owner-tools-exposed", severity: input.profile === "production" || input.profile === "review" ? "blocked" : "warning", message: "Owner workbench/tools are included in this artifact.", filePaths: paths.filter((path) => path.includes("_stitch")) });
  if (includesReviewRuntime) findings.push({ code: "review-runtime-exposed", severity: input.profile === "production" ? "warning" : "info", message: "Comment-only review runtime is included.", filePaths: paths.filter((path) => path.includes("review-runtime")) });
  if (includesProjectState) findings.push({ code: "private-state-exposed", severity: input.profile === "production" || input.profile === "review" ? "blocked" : "warning", message: "Project state is included and may contain private feedback/history.", filePaths: paths.filter((path) => path.endsWith("project.state.json")) });
  if (includesEventHistory) findings.push({ code: "event-history-exposed", severity: input.profile === "production" || input.profile === "review" ? "blocked" : "warning", message: "Event history is included and should remain private unless intentionally exported.", filePaths: paths.filter((path) => path.endsWith("events.json") || path.endsWith("project.state.json")) });
  if (includesMigrationBootstrap) findings.push({ code: "migration-bootstrap-exposed", severity: input.profile === "production" ? "warning" : "info", message: "Migration bootstrap provenance is included.", filePaths: paths.filter((path) => path.endsWith("migration.bootstrap.json")) });
  if (input.profile === "owner" || input.profile === "source") findings.push({ code: "owner-profile-public-risk", severity: "warning", message: "Owner/source profiles are private by default and should not be treated as public production output." });
  if (input.profile === "review") findings.push({ code: "review-profile-comment-only", severity: "info", message: "Review profile may be shared for comments, but should not expose owner tools or private state." });
  if (input.profile === "production" && findings.every((finding) => finding.severity !== "blocked")) findings.push({ code: "production-public-safe", severity: "info", message: "Production profile is public-safe if hosted artifact files match this audit." });

  const blocked = findings.some((finding) => finding.severity === "blocked");
  const warning = findings.some((finding) => finding.severity === "warning");
  return {
    id: `audit-${String(input.profile)}-${Date.now()}`,
    createdAt: new Date().toISOString(),
    profile: input.profile,
    safeForPublic: !blocked && input.profile === "production",
    includesOwnerTools,
    includesReviewRuntime,
    includesProjectState,
    includesEventHistory,
    includesMigrationBootstrap,
    findings,
    summary: blocked ? "Public exposure audit is blocked by private capsule/state exposure." : warning ? "Public exposure audit requires owner review." : "Public exposure audit is ready.",
  };
}

function scopeRequiresOwner(scope: CapabilityScope): boolean {
  return ["feedback:import", "spec:edit", "patch:plan", "patch:apply", "history:view", "history:restore", "bundle:export", "deploy:handoff"].includes(scope);
}


// Phase 14: materialization safety and provenance helpers.
export function validateMaterializationReadiness(artifact: MaterializedArtifact): MaterializationResult {
  const warnings: MaterializationWarning[] = [...artifact.warnings];
  if (artifact.files.length === 0) warnings.push({ code: "artifact-empty", severity: "blocked", message: "Materialized artifact contains no files." });
  if (artifact.profile === "production" && artifact.files.some((file) => file.private)) {
    warnings.push({ code: "production-private-file-blocked", severity: "blocked", message: "Production materialization includes private files." });
  }
  if (artifact.profile === "review" && artifact.files.some((file) => file.path.includes("/_stitch"))) {
    warnings.push({ code: "review-owner-tools-blocked", severity: "blocked", message: "Review materialization includes owner workbench files." });
  }
  const blocked = warnings.some((warning) => warning.severity === "blocked") || artifact.validation.status === "blocked";
  const needsReview = warnings.some((warning) => warning.severity === "warning") || artifact.validation.status === "needsReview";
  return { status: blocked ? "blocked" : needsReview ? "needsReview" : "ready", artifact, warnings, integrity: artifact.integrity };
}

export function createArtifactMaterializedEvent(artifact: MaterializedArtifact): StitchEvent {
  return createStateEvent("export.created", "system", `Materialized ${artifact.profile} artifact ${artifact.fileName}.`, {
    data: {
      materializedArtifactId: artifact.id,
      exportArtifactId: artifact.artifactId,
      profile: artifact.profile,
      format: artifact.format,
      fileName: artifact.fileName,
      fileCount: artifact.files.length,
      totalBytes: artifact.integrity.totalBytes,
      downloadReady: artifact.downloadReady,
      integrityHash: artifact.integrity.hash,
    },
  });
}

export function summarizeArtifactPrivacyRisk(artifact: MaterializedArtifact): { status: "ready" | "needsReview" | "blocked"; summary: string; warnings: string[] } {
  const result = validateMaterializationReadiness(artifact);
  const summary = result.status === "ready"
    ? `${artifact.profile} artifact is materialized and ready to download.`
    : result.status === "needsReview"
      ? `${artifact.profile} artifact is materialized but should be reviewed before sharing.`
      : `${artifact.profile} artifact materialization is blocked by privacy rules.`;
  return { status: result.status, summary, warnings: result.warnings.map((warning) => warning.message) };
}
