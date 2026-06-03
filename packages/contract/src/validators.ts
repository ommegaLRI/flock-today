import type { CampaignPageSpec, ChangePin, PageCapture, SafetyReport } from "./types";

export type ValidationResult = {
  ok: boolean;
  errors: string[];
};

export function validatePageCapture(capture: PageCapture): ValidationResult {
  const errors: string[] = [];
  if (!capture.url) errors.push("capture.url is required");
  if (!capture.viewport || capture.viewport.width <= 0 || capture.viewport.height <= 0) {
    errors.push("capture.viewport must have positive width and height");
  }
  if (!Array.isArray(capture.visibleText)) errors.push("capture.visibleText must be an array");
  return { ok: errors.length === 0, errors };
}

export function validateCampaignPageSpec(spec: CampaignPageSpec): ValidationResult {
  const errors: string[] = [];
  if (!spec.id) errors.push("spec.id is required");
  if (!spec.title) errors.push("spec.title is required");
  if (!spec.slug) errors.push("spec.slug is required");
  if (!spec.brand) errors.push("spec.brand is required");
  if (!Array.isArray(spec.sections)) errors.push("spec.sections must be an array");
  return { ok: errors.length === 0, errors };
}

export function validateChangePin(pin: ChangePin): ValidationResult {
  const errors: string[] = [];
  if (!pin.id) errors.push("pin.id is required");
  if (!pin.comment.trim()) errors.push("pin.comment is required");
  if (pin.permissions.canEdit || pin.permissions.canGeneratePatch || pin.permissions.canPublish) {
    errors.push("review pins must not include edit, patch, or publish permissions");
  }
  return { ok: errors.length === 0, errors };
}

export function blockedSafetyReport(reason: string): SafetyReport {
  return {
    risk: "blocked",
    reasons: [reason],
    touchedFiles: [],
    forbiddenChanges: true,
    requiresOwnerApproval: true,
    publishAllowed: false,
  };
}
