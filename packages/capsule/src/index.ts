import type { BuildProfile, CampaignPageSpec, CapsuleAccessPolicy, CapabilityScope, DeploymentManifest, FeedbackTransportKind, GeneratedFile, MaterializedArtifact, PublicExposureAudit } from "@stitch/contract";

export type CapsuleManifest = {
  contractVersion: string;
  route: "/_stitch";
  buildProfile: BuildProfile;
  ownerRequired: true;
  reviewMode: "disabled" | "comment-only";
  storage: {
    defaultAdapter: "localStorage";
    localPinsKey: string;
    localSpecKey: string;
    localStateKey: string;
  };
  project: {
    manifestPath: "stitch/project.manifest.json";
    installPlanPath: "stitch/install-plan.json";
    pageSpecPath: "stitch/page.spec.json";
    projectStatePath: "stitch/project.state.json";
    feedbackImportPath: "stitch/feedback.import.json";
    activeProfile: BuildProfile;
    publicFilesAreGenerated: true;
  };
  publicRuntime: {
    enabled: boolean;
    activation: "manual" | "queryParam";
    captures: Array<"targetText" | "nearbyText" | "boundingBox" | "className" | "computedStyles" | "screenshotCrop">;
    submitsTo: "local" | "portable-feedback-bundle" | "user-owned-adapter";
    transports: FeedbackTransportKind[];
  };
  access: CapsuleAccessPolicy;
  exposureAudit: PublicExposureAudit;
  workbench: {
    included: boolean;
    canEditSpec: boolean;
    canGeneratePatches: boolean;
    canExportSpec: boolean;
    canPublish: boolean;
    publishRequiresOwnerApproval: true;
  };
  feedback: {
    bundleFormat: "stitch-feedback-bundle";
    transports: FeedbackTransportKind[];
    importEnabled: boolean;
  };
};

export type CapsuleOptions = {
  buildProfile?: BuildProfile;
};

export const STITCH_LOCAL_PINS_KEY = "stitch:pins";
export const STITCH_LOCAL_SPEC_KEY = "stitch:page-spec";
export const STITCH_LOCAL_STATE_KEY = "stitch:project-state";

export function createCapsuleManifest(options: CapsuleOptions = {}): CapsuleManifest {
  const buildProfile = options.buildProfile ?? "owner";
  const reviewEnabled = buildProfile === "review" || buildProfile === "owner";
  const workbenchIncluded = buildProfile === "owner";
  return {
    contractVersion: "0.1.0",
    route: "/_stitch",
    buildProfile,
    ownerRequired: true,
    reviewMode: reviewEnabled ? "comment-only" : "disabled",
    storage: {
      defaultAdapter: "localStorage",
      localPinsKey: STITCH_LOCAL_PINS_KEY,
      localSpecKey: STITCH_LOCAL_SPEC_KEY,
      localStateKey: STITCH_LOCAL_STATE_KEY,
    },
    project: {
      manifestPath: "stitch/project.manifest.json",
      installPlanPath: "stitch/install-plan.json",
      pageSpecPath: "stitch/page.spec.json",
      projectStatePath: "stitch/project.state.json",
      feedbackImportPath: "stitch/feedback.import.json",
      activeProfile: buildProfile,
      publicFilesAreGenerated: true,
    },
    access: createCapsuleAccessPolicy(buildProfile),
    exposureAudit: createCapsuleExposureAudit(buildProfile),
    publicRuntime: {
      enabled: reviewEnabled,
      activation: "queryParam",
      captures: ["targetText", "nearbyText", "boundingBox", "className", "computedStyles", "screenshotCrop"],
      submitsTo: "portable-feedback-bundle",
      transports: reviewEnabled ? ["local", "download", "mailto"] : [],
    },
    workbench: {
      included: workbenchIncluded,
      canEditSpec: workbenchIncluded,
      canGeneratePatches: workbenchIncluded,
      canExportSpec: workbenchIncluded,
      canPublish: workbenchIncluded,
      publishRequiresOwnerApproval: true,
    },
    feedback: {
      bundleFormat: "stitch-feedback-bundle",
      transports: reviewEnabled ? ["local", "download", "mailto"] : [],
      importEnabled: workbenchIncluded,
    },
  };
}

export function createCapsuleFiles(spec: CampaignPageSpec, deployManifest: DeploymentManifest, options: CapsuleOptions = {}): GeneratedFile[] {
  const buildProfile = options.buildProfile ?? deployManifest.profile ?? "owner";
  const manifest = createCapsuleManifest({ buildProfile });
  const files: GeneratedFile[] = [
    { path: "stitch/capsule-manifest.json", role: "manifest", public: false, contents: JSON.stringify(manifest, null, 2) + "\n" },
  ];

  if (buildProfile === "review" || buildProfile === "owner") {
    files.push({ path: "public/stitch/review-runtime.js", role: "capsule", public: true, contents: buildReviewRuntimeSnippet() });
  }

  if (buildProfile === "owner") {
    files.push({ path: "public/_stitch/index.html", role: "capsule", public: false, contents: buildWorkbenchShell(spec, deployManifest, buildProfile) });
  }

  return files;
}

export function buildReviewRuntimeSnippet(): string {
  return `// Stitch review runtime v0.5
// Comment-only. It creates ChangePin objects, stores them locally by default, and never grants edit, model, or publish permissions.
(function () {
  var STORAGE_KEY = '${STITCH_LOCAL_PINS_KEY}';
  var enabled = false;
  var selected = null;
  var outline = null;

  function rectFor(element) {
    var rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  function textFor(element) {
    return (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ');
  }

  function stitchElement(element) {
    return element.closest('[data-stitch-element-id], [data-stitch-element]') || element;
  }

  function stitchSection(element) {
    return element.closest('[data-stitch-section-id], [data-stitch-section]');
  }

  function targetFromElement(element) {
    var targetElement = stitchElement(element);
    var section = stitchSection(element);
    return {
      selector: targetElement.tagName.toLowerCase(),
      text: textFor(targetElement).slice(0, 240),
      role: targetElement.getAttribute('role') || targetElement.getAttribute('data-stitch-element-id') || targetElement.getAttribute('data-stitch-element') || undefined,
      boundingBox: rectFor(targetElement),
      sectionId: section ? section.getAttribute('data-stitch-section-id') || section.getAttribute('data-stitch-section') || undefined : undefined,
      sectionType: section ? section.getAttribute('data-stitch-section-type') || undefined : undefined,
      elementId: targetElement.getAttribute('data-stitch-element-id') || targetElement.getAttribute('data-stitch-element') || undefined,
      elementType: targetElement.getAttribute('data-stitch-element-type') || undefined
    };
  }

  function nearbyText(element) {
    var section = stitchSection(element) || element.parentElement || element;
    return textFor(section).slice(0, 1000).split(/[.!?]\s+/).map(function (value) { return value.trim(); }).filter(Boolean).slice(0, 8);
  }

  function createPinFromElement(element, comment, author) {
    var targetElement = stitchElement(element);
    var styles = getComputedStyle(targetElement);
    return {
      id: (crypto.randomUUID ? crypto.randomUUID() : 'pin-' + Date.now()),
      route: location.pathname,
      createdAt: new Date().toISOString(),
      author: author,
      comment: comment,
      target: targetFromElement(targetElement),
      context: {
        selectedText: textFor(targetElement).slice(0, 500),
        pageTitle: document.title,
        nearbyText: nearbyText(targetElement),
        className: targetElement.getAttribute('class') || undefined,
        computedStyles: {
          color: styles.color,
          backgroundColor: styles.backgroundColor,
          fontSize: styles.fontSize,
          fontWeight: styles.fontWeight,
          borderRadius: styles.borderRadius,
          padding: styles.padding,
          margin: styles.margin
        },
        viewport: { width: window.innerWidth, height: window.innerHeight, label: window.innerWidth < 700 ? 'mobile' : 'desktop' }
      },
      permissions: { canComment: true, canEdit: false, canGeneratePatch: false, canPublish: false }
    };
  }

  function readPins() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (_) { return []; } }
  function writePins(pins) { localStorage.setItem(STORAGE_KEY, JSON.stringify(pins, null, 2)); window.dispatchEvent(new CustomEvent('stitch:pins-changed', { detail: pins })); }
  function storePin(pin) { var pins = readPins(); pins.push(pin); writePins(pins); return pin; }

  function ensureOutline() {
    if (outline) return outline;
    outline = document.createElement('div');
    outline.style.position = 'fixed';
    outline.style.pointerEvents = 'none';
    outline.style.zIndex = '2147483647';
    outline.style.border = '2px solid #2563eb';
    outline.style.borderRadius = '8px';
    outline.style.boxShadow = '0 0 0 4px rgba(37,99,235,.16)';
    document.documentElement.appendChild(outline);
    return outline;
  }

  function highlight(element) {
    var box = ensureOutline();
    var rect = element.getBoundingClientRect();
    box.style.left = rect.left + 'px';
    box.style.top = rect.top + 'px';
    box.style.width = rect.width + 'px';
    box.style.height = rect.height + 'px';
  }

  function clearHighlight() { if (outline && outline.parentElement) outline.parentElement.removeChild(outline); outline = null; }
  function submitComment(element) { var comment = window.prompt('What should change here?'); if (!comment || !comment.trim()) return null; var pin = storePin(createPinFromElement(element, comment.trim(), { name: 'Reviewer' })); window.alert('Saved review pin locally. Open /_stitch to review it.'); return pin; }

  function onMove(event) { if (!enabled) return; var element = stitchElement(event.target); if (element && element !== selected) { selected = element; highlight(element); } }
  function onClick(event) { if (!enabled) return; event.preventDefault(); event.stopPropagation(); var element = stitchElement(event.target); if (element) submitComment(element); }

  function enableReviewMode() { if (enabled) return; enabled = true; document.documentElement.setAttribute('data-stitch-review-mode', 'true'); document.addEventListener('mousemove', onMove, true); document.addEventListener('click', onClick, true); console.info('[Stitch] Review mode enabled. Click an element to leave a comment.'); }
  function disableReviewMode() { enabled = false; selected = null; clearHighlight(); document.documentElement.removeAttribute('data-stitch-review-mode'); document.removeEventListener('mousemove', onMove, true); document.removeEventListener('click', onClick, true); }

  function hash(value) { var h = 2166136261; for (var i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
  function createFeedbackBundle(options) {
    var pins = readPins();
    var siteId = (document.querySelector('[data-stitch-page-id]') || {}).dataset ? document.querySelector('[data-stitch-page-id]').dataset.stitchPageId : location.hostname;
    var payload = {
      id: 'feedback-' + (siteId || 'site') + '-' + Date.now(),
      kind: 'stitch-feedback-bundle',
      version: '0.1.0',
      createdAt: new Date().toISOString(),
      site: { id: siteId || location.hostname, title: document.title, url: location.href, route: location.pathname, buildProfile: 'review' },
      source: { transport: (options && options.transport) || 'download', reviewerSessionId: sessionStorage.getItem('stitch:reviewer-session') || (function(){ var id = 'reviewer-' + Date.now(); sessionStorage.setItem('stitch:reviewer-session', id); return id; })() },
      pins: pins,
      checksum: hash(JSON.stringify(pins.map(function(pin){ return pin.id; }).sort()))
    };
    return payload;
  }
  function downloadFeedbackBundle() {
    var bundle = createFeedbackBundle({ transport: 'download' });
    var blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'stitch-feedback.json';
    a.click();
    URL.revokeObjectURL(url);
    return bundle;
  }
  function createMailtoFeedbackBundle(to) {
    var bundle = createFeedbackBundle({ transport: 'mailto' });
    var subject = 'Stitch feedback for ' + (document.title || location.hostname);
    var body = 'Import this Stitch feedback JSON in the private /_stitch workbench.\n\n' + JSON.stringify(bundle, null, 2);
    location.href = 'mailto:' + encodeURIComponent(to || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    return bundle;
  }
  window.StitchReviewRuntime = { mode: 'comment-only', allowedScopes: ['comment:create', 'feedback:export'], deniedScopes: ['spec:edit', 'patch:apply', 'bundle:export', 'deploy:handoff'], storageKey: STORAGE_KEY, enableReviewMode: enableReviewMode, disableReviewMode: disableReviewMode, readPins: readPins, writePins: writePins, storePin: storePin, targetFromElement: targetFromElement, createPinFromElement: createPinFromElement, createFeedbackBundle: createFeedbackBundle, downloadFeedbackBundle: downloadFeedbackBundle, createMailtoFeedbackBundle: createMailtoFeedbackBundle };
  if (new URLSearchParams(location.search).has('review') || new URLSearchParams(location.search).has('stitch-review')) enableReviewMode();
})();
`;
}

export function buildWorkbenchShell(spec: CampaignPageSpec, deployManifest: DeploymentManifest, buildProfile: BuildProfile = "owner"): string {
  const embeddedSpec = escapeScriptJson(spec);
  const embeddedDeploy = escapeScriptJson(deployManifest);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Stitch Workbench</title>
  <style>
    :root { color-scheme: light; font-family: Inter, system-ui, sans-serif; }
    body { margin: 0; background: #f8fafc; color: #0f172a; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px; }
    h1 { margin: 0 0 8px; font-size: 32px; }
    h2 { margin: 0 0 12px; }
    .muted { color: #64748b; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; align-items: start; }
    .card, .pin { border: 1px solid #e2e8f0; border-radius: 16px; background: white; padding: 18px; box-shadow: 0 1px 2px rgba(15,23,42,.04); }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 18px 0; }
    button, select { border: 1px solid #cbd5e1; border-radius: 999px; background: #0f172a; color: white; padding: 9px 14px; cursor: pointer; }
    button.secondary, select { background: white; color: #0f172a; }
    button.danger { background: #b91c1c; }
    label { display: block; font-size: 12px; color: #64748b; margin-bottom: 4px; }
    input, textarea { width: 100%; border: 1px solid #cbd5e1; border-radius: 10px; padding: 9px; font: inherit; }
    textarea { min-height: 88px; }
    .row { margin-bottom: 10px; }
    .section-title { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
    pre { white-space: pre-wrap; overflow: auto; background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 12px; font-size: 12px; }
    code { background: #e2e8f0; padding: 2px 4px; border-radius: 4px; }
  </style>
</head>
<body>
  <main>
    <h1>Stitch Workbench</h1>
    <p class="muted">Private owner capsule. Local spec edits, review pins, patch previews, project install metadata, and portable publish-bundle handoff plans run without Stitch-hosted project state.</p>
    <div class="actions">
      <button id="save-spec">Save spec locally</button>
      <button id="reset-spec" class="secondary">Reset to embedded spec</button>
      <button id="download-spec" class="secondary">Download page.spec.json</button>
      <button id="download-feedback" class="secondary">Download feedback bundle</button>
      <label class="secondary" style="display:inline-flex;align-items:center;gap:8px;border:1px solid #cbd5e1;border-radius:999px;padding:8px 12px;background:white;color:#0f172a;cursor:pointer">Import feedback <input id="import-feedback" type="file" accept="application/json" style="display:none" /></label>
      <button id="clear-pins" class="danger">Clear local pins</button>
      <select id="profile"><option value="production">production</option><option value="review">review</option><option value="owner">owner</option></select>
    </div>
    <div class="grid">
      <section class="card"><h2>Spec editor</h2><p class="muted">Supported fields are intentionally canonical: section variant, heading, body, and CTA label.</p><div id="editor"></div></section>
      <section class="card"><h2>Feedback inbox</h2><p class="muted">Review pins are untrusted until an owner chooses to draft/apply a spec patch. Phase 8 supports portable feedback bundles so client feedback can leave another browser without Stitch hosting an inbox.</p><div id="pins"></div><div id="feedback-import"></div></section>
      <section class="card"><h2>Project history</h2><p class="muted">Local event log and snapshots make capsule changes inspectable and reversible.</p><div id="history"></div></section>
      <section class="card"><h2>Publish bundle</h2><p class="muted">Profiles decide what capsule assets are included before handoff to user-owned hosting.</p><div id="bundle"></div></section>
      <section class="card"><h2>Deploy handoff</h2><div id="handoff"></div></section>
      <section class="card"><h2>Current spec</h2><pre id="spec-json"></pre></section>
    </div>
  </main>
  <script>
    var EMBEDDED_SPEC = ${embeddedSpec};
    var EMBEDDED_DEPLOY = ${embeddedDeploy};
    var INITIAL_PROFILE = ${JSON.stringify(buildProfile)};
    var PINS_KEY = '${STITCH_LOCAL_PINS_KEY}';
    var SPEC_KEY = '${STITCH_LOCAL_SPEC_KEY}';
    var STATE_KEY = '${STITCH_LOCAL_STATE_KEY}';
    var spec = readSpec();
    var profile = INITIAL_PROFILE;
    var OWNER_UNLOCK_KEY = 'stitch:owner-unlock';
    var ownerUnlocked = localStorage.getItem(OWNER_UNLOCK_KEY) === 'true';

    function initialState() { return { id: 'project-' + EMBEDDED_SPEC.id, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), spec: EMBEDDED_SPEC, brand: EMBEDDED_SPEC.brand, contentStrategy: EMBEDDED_SPEC.contentStrategy, pins: [], patchPlans: [], appliedOperations: [], events: [{ id: 'event-project-created', kind: 'project.created', source: 'migration', createdAt: new Date().toISOString(), summary: 'Embedded workbench project state initialized.' }], snapshots: [{ id: 'snapshot-initial', createdAt: new Date().toISOString(), stateVersion: 1, label: 'Initial embedded spec', spec: EMBEDDED_SPEC, checksum: String(JSON.stringify(EMBEDDED_SPEC).length) }], provenance: [{ id: 'prov-initial', createdAt: new Date().toISOString(), source: 'migration', summary: 'Initial embedded CampaignPageSpec loaded into user-owned capsule state.' }] }; }
    function readState() { try { return JSON.parse(localStorage.getItem(STATE_KEY) || 'null') || initialState(); } catch (_) { return initialState(); } }
    function writeState(state) { localStorage.setItem(STATE_KEY, JSON.stringify(state, null, 2)); }
    function recordEvent(kind, source, summary, data) { var state = readState(); var event = { id: 'event-' + kind + '-' + Date.now(), kind: kind, source: source, createdAt: new Date().toISOString(), summary: summary, data: data || {} }; state.version += 1; state.updatedAt = event.createdAt; state.events.push(event); state.spec = spec; state.brand = spec.brand; state.contentStrategy = spec.contentStrategy; if (kind === 'specEdit.applied' || kind === 'specOperation.applied') state.snapshots.push({ id: 'snapshot-' + state.version, createdAt: event.createdAt, stateVersion: state.version, eventId: event.id, label: summary, spec: spec, checksum: String(JSON.stringify(spec).length) }); writeState(state); return state; }
    function readSpec() { var state = readState(); try { return JSON.parse(localStorage.getItem(SPEC_KEY) || 'null') || state.spec || EMBEDDED_SPEC; } catch (_) { return state.spec || EMBEDDED_SPEC; } }
    function writeSpec(next) { spec = next; localStorage.setItem(SPEC_KEY, JSON.stringify(spec, null, 2)); recordEvent('specEdit.applied', 'owner', 'Owner edited CampaignPageSpec in local workbench.', { specId: spec.id }); render(); }
    function readPins() { try { return JSON.parse(localStorage.getItem(PINS_KEY) || '[]'); } catch (_) { return []; } }
    function writePins(pins) { localStorage.setItem(PINS_KEY, JSON.stringify(pins, null, 2)); var state = readState(); state.pins = pins; writeState(state); renderPins(); }
    function escapeHtml(value) { return String(value).replace(/[&<>]/g, function (char) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char] || char; }); }
    function jsonPointerSet(root, path, value) { var copy = structuredClone(root); var parts = path.split('/').filter(Boolean); var current = copy; for (var i = 0; i < parts.length - 1; i++) current = current[parts[i]]; current[parts[parts.length - 1]] = value; return copy; }

    function updateField(path, value) { writeSpec(jsonPointerSet(spec, path, value)); }
    function renderEditor() { var html = ''; spec.sections.forEach(function (section, index) { html += '<div class="card" style="margin-bottom:12px"><div class="section-title"><strong>' + escapeHtml(section.id + ' · ' + section.type) + '</strong><span class="muted">' + escapeHtml(section.variant || 'default') + '</span></div>'; html += field('/sections/' + index + '/variant', 'Variant', section.variant || 'default', 'input'); if ('heading' in section) html += field('/sections/' + index + '/heading', 'Heading', section.heading || '', 'input'); if ('body' in section) html += field('/sections/' + index + '/body', 'Body', section.body || '', 'textarea'); if (section.primaryCta) html += field('/sections/' + index + '/primaryCta/label', 'Primary CTA label', section.primaryCta.label || '', 'input'); if (section.secondaryCta) html += field('/sections/' + index + '/secondaryCta/label', 'Secondary CTA label', section.secondaryCta.label || '', 'input'); html += '</div>'; }); document.getElementById('editor').innerHTML = html; Array.prototype.forEach.call(document.querySelectorAll('[data-edit-path]'), function (input) { input.addEventListener('change', function () { updateField(input.getAttribute('data-edit-path'), input.value); }); }); }
    function field(path, label, value, kind) { var control = kind === 'textarea' ? '<textarea data-edit-path="' + path + '">' + escapeHtml(value) + '</textarea>' : '<input data-edit-path="' + path + '" value="' + escapeHtml(value) + '" />'; return '<div class="row"><label>' + escapeHtml(label) + '</label>' + control + '</div>'; }

    function classify(comment) { if (/color|spacing|bigger|premium|stand out|highlight|contrast|brand/i.test(comment)) return 'style'; if (/link|url|href|destination/i.test(comment)) return 'link'; if (/image|photo|logo/i.test(comment)) return 'image'; if (/section|add|remove|delete/i.test(comment)) return 'section'; return 'copy'; }
    function quoted(comment) { var match = comment.match(/[“"]([^”"]+)[”"]/u) || comment.match(/[']([^']+)[']/); return match ? match[1] : null; }
    function draftPatch(pin) { var sectionIndex = spec.sections.findIndex(function (section) { return section.id === pin.target.sectionId; }); if (sectionIndex < 0) sectionIndex = 0; var section = spec.sections[sectionIndex]; var kind = classify(pin.comment); var elementId = pin.target.elementId || ''; var value = quoted(pin.comment) || pin.comment; var path = '/sections/' + sectionIndex + '/heading'; if (kind === 'style') path = '/sections/' + sectionIndex + '/variant', value = /premium|stand out|highlight/i.test(pin.comment) ? 'featured' : 'brand'; else if ((elementId === 'primaryCta' || /button|cta|label|say/i.test(pin.comment)) && section.primaryCta) path = '/sections/' + sectionIndex + '/primaryCta/label'; else if (elementId === 'body' || /body|paragraph|subheadline|description|copy/i.test(pin.comment)) path = '/sections/' + sectionIndex + '/body'; else if (elementId === 'heading' || /headline|heading|title/i.test(pin.comment)) path = '/sections/' + sectionIndex + '/heading'; var blocked = /javascript:|script|analytics|tracking|payment|legal/i.test(pin.comment); return { id: 'plan-' + pin.id, status: blocked ? 'blocked' : 'proposed', source: 'pin', intent: { kind: kind, summary: pin.comment }, target: { specPath: '/sections/' + sectionIndex, sectionId: section.id, elementId: elementId }, operations: [{ kind: blocked ? 'manualReview' : 'specPatch', description: blocked ? 'Manual review required.' : 'replace ' + path, path: path }], proposedChange: blocked ? {} : { specPatch: [{ op: 'replace', path: path, value: value }] }, safety: { risk: blocked ? 'blocked' : 'low', reasons: [blocked ? 'Potentially unsafe request.' : 'Spec-level change only.'], touchedFiles: ['stitch/page.spec.json'], forbiddenChanges: blocked, requiresOwnerApproval: true, publishAllowed: false } }; }
    function applyPatch(plan) { var patch = (plan.proposedChange && plan.proposedChange.specPatch) || []; var next = spec; patch.forEach(function (operation) { if (operation.op === 'replace' || operation.op === 'add') next = jsonPointerSet(next, operation.path, operation.value); }); writeSpec(next); recordEvent('specOperation.applied', 'pin', 'Applied local spec patch from review pin.', { patchPlan: plan }); }
    function hash(value) { var h = 2166136261; for (var i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
    function createFeedbackBundle() { var pins = readPins(); return { id: 'feedback-' + spec.id + '-' + hash(JSON.stringify(pins.map(function(pin){ return pin.id; }).sort())), kind: 'stitch-feedback-bundle', version: '0.1.0', createdAt: new Date().toISOString(), site: { id: spec.id, title: spec.title, route: location.pathname, buildProfile: profile }, source: { transport: 'download', exportedBy: 'owner-workbench' }, pins: pins, checksum: hash(JSON.stringify(pins.map(function(pin){ return pin.id; }).sort())) }; }
    function downloadFeedbackBundle() { var bundle = createFeedbackBundle(); var blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }); var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = 'stitch-feedback.json'; a.click(); URL.revokeObjectURL(url); recordEvent('export.created', 'storage', 'Exported portable feedback bundle.', { feedbackBundleId: bundle.id, pins: bundle.pins.length }); }
    function importFeedbackBundle(bundle) { var pins = readPins(); var existing = {}; pins.forEach(function(pin){ existing[pin.id] = true; }); var imported = []; var duplicates = []; var rejected = []; (bundle.pins || []).forEach(function(pin){ if (!pin || !pin.id || !pin.comment) rejected.push({ reason: 'Invalid ChangePin shape.' }); else if (pin.permissions && (pin.permissions.canEdit || pin.permissions.canGeneratePatch || pin.permissions.canPublish)) rejected.push({ pin: pin, reason: 'Review pin attempted to carry unsafe permissions.' }); else if (existing[pin.id]) duplicates.push(pin); else { imported.push(pin); existing[pin.id] = true; } }); writePins(pins.concat(imported)); recordEvent('state.imported', 'storage', 'Imported feedback bundle ' + (bundle.id || 'unknown') + '.', { feedbackBundleId: bundle.id, imported: imported.length, duplicates: duplicates.length, rejected: rejected.length }); document.getElementById('feedback-import').innerHTML = '<pre>' + escapeHtml(JSON.stringify({ bundleId: bundle.id, imported: imported.length, duplicates: duplicates.length, rejected: rejected }, null, 2)) + '</pre>'; }

    function renderPins() { var pins = readPins(); if (pins.length === 0) { document.getElementById('pins').innerHTML = '<p class="muted">No local review pins yet. Open the generated page with <code>?review=1</code> and click an element.</p>'; return; } document.getElementById('pins').innerHTML = pins.map(function (pin, index) { var plan = draftPatch(pin); return '<div class="pin"><strong>' + escapeHtml(pin.comment) + '</strong><p class="muted">Target: ' + escapeHtml((pin.target.sectionId || 'unknown') + ' / ' + (pin.target.elementId || 'unknown')) + '</p><pre>' + escapeHtml(JSON.stringify(plan, null, 2)) + '</pre><button data-apply-pin="' + index + '">Apply spec patch locally</button></div>'; }).join(''); Array.prototype.forEach.call(document.querySelectorAll('[data-apply-pin]'), function (button) { button.addEventListener('click', function () { var pin = pins[Number(button.getAttribute('data-apply-pin'))]; if (requireOwner('patch:apply')) applyPatch(draftPatch(pin)); }); }); }

    function createManifest(currentSpec, currentProfile) { var files = ['package.json', 'index.html', 'src/main.jsx', 'src/Page.jsx', 'src/styles.css', 'stitch/page.spec.json', 'stitch/brand.spec.json', 'stitch/content.strategy.json', 'stitch/project.state.json', 'stitch/events.json', 'stitch/provenance.json', 'stitch/deploy-manifest.json', 'stitch/capsule-manifest.json']; if (currentProfile === 'review' || currentProfile === 'owner') files.push('public/stitch/review-runtime.js'); if (currentProfile === 'owner') files.push('public/_stitch/index.html'); return files.map(function (path) { return { path: path, role: path.includes('_stitch') || path.includes('review-runtime') ? 'capsule' : path.includes('stitch/') ? 'spec' : path.endsWith('.css') ? 'style' : 'source', bytes: path === 'stitch/page.spec.json' ? JSON.stringify(currentSpec, null, 2).length : 1, public: path.startsWith('public/') || path === 'index.html' || path.endsWith('.css') }; }); }
    function warnings(currentProfile) { var list = []; if (currentProfile === 'owner') list.push({ severity: 'warning', message: 'Owner workbench is included. Use only on private preview/local owner builds.' }); if (currentProfile === 'review') list.push({ severity: 'info', message: 'Review runtime is included for comment-only feedback.' }); spec.sections.forEach(function(section){ if (section.primaryCta && (!section.primaryCta.href || section.primaryCta.href === '#')) list.push({ severity: 'warning', message: 'CTA in ' + section.id + ' has no final href.' }); }); return list; }
    function renderHistory() { var state = readState(); var payload = { version: state.version, events: (state.events || []).slice(-8), snapshots: (state.snapshots || []).slice(-5), provenance: (state.provenance || []).slice(-5) }; document.getElementById('history').innerHTML = '<pre>' + escapeHtml(JSON.stringify(payload, null, 2)) + '</pre>'; }
    function renderBundle() { var manifest = createManifest(spec, profile); var payload = { profile: profile, files: manifest.length, capsuleIncluded: profile !== 'production', warnings: warnings(profile), manifest: manifest, stateVersion: readState().version }; document.getElementById('bundle').innerHTML = '<pre>' + escapeHtml(JSON.stringify(payload, null, 2)) + '</pre>'; }
    function renderHandoff() { var plan = { target: profile === 'production' ? 'cloudflare-pages' : 'netlify', profile: profile, buildCommand: EMBEDDED_DEPLOY.buildCommand || 'npm run build', outputDir: EMBEDDED_DEPLOY.outputDir || 'dist', instructions: ['Export/write the generated files into a user-owned repo.', 'Run the build command.', 'Deploy the output directory to the selected provider.', 'Stitch does not host this site or store project state.'], warnings: warnings(profile) }; document.getElementById('handoff').innerHTML = '<pre>' + escapeHtml(JSON.stringify(plan, null, 2)) + '</pre>'; }
    function requireOwner(scope) { if (ownerUnlocked) return true; window.alert('Owner unlock required for ' + scope + '. Review links can comment, but only owner-unlocked contexts can edit, patch, export, or publish.'); return false; }
    function unlockOwner() { var answer = window.prompt('Owner unlock phrase (demo): type owner'); if (answer === 'owner') { ownerUnlocked = true; localStorage.setItem(OWNER_UNLOCK_KEY, 'true'); render(); } }
    function renderAccess() { var status = document.getElementById('access-status'); if (status) status.textContent = ownerUnlocked ? 'owner-unlocked' : 'locked'; }
    function render() { renderAccess(); renderEditor(); renderPins(); renderHistory(); renderBundle(); renderHandoff(); document.getElementById('spec-json').textContent = JSON.stringify(spec, null, 2); }

    document.getElementById('profile').value = profile;
    document.getElementById('profile').addEventListener('change', function (event) { profile = event.target.value; renderBundle(); renderHandoff(); });
    document.getElementById('save-spec').addEventListener('click', function () { if (requireOwner('spec:edit')) writeSpec(spec); });
    document.getElementById('reset-spec').addEventListener('click', function () { if (!requireOwner('spec:edit')) return; localStorage.removeItem(SPEC_KEY); localStorage.removeItem(STATE_KEY); spec = structuredClone(EMBEDDED_SPEC); render(); });
    document.getElementById('clear-pins').addEventListener('click', function () { writePins([]); });
    document.getElementById('download-spec').addEventListener('click', function () { if (!requireOwner('bundle:export')) return; var blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' }); var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = 'page.spec.json'; a.click(); URL.revokeObjectURL(url); });
    document.getElementById('download-feedback').addEventListener('click', downloadFeedbackBundle);
    document.getElementById('import-feedback').addEventListener('change', function (event) { if (!requireOwner('feedback:import')) return; var file = event.target.files && event.target.files[0]; if (!file) return; file.text().then(function (text) { importFeedbackBundle(JSON.parse(text)); }); });
    render();
  </script>
</body>
</html>
`;
}

function escapeScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export function getCapsuleFilesForExportProfile(profile: "source" | BuildProfile): string[] {
  if (profile === "production") return [];
  if (profile === "review") return ["public/stitch/review-runtime.js", "stitch/capsule-manifest.json"];
  return ["public/stitch/review-runtime.js", "public/_stitch/index.html", "stitch/capsule-manifest.json"];
}

export function describeCapsulePrivacyForProfile(profile: "source" | BuildProfile): string[] {
  if (profile === "production") return ["Production exports exclude owner workbench and review runtime by default."];
  if (profile === "review") return ["Review exports include comment-only runtime but no owner patching or publishing UI."];
  return ["Owner/source exports include private workbench assets and should remain in user-owned private storage."];
}

export function createCapsuleAccessPolicy(profile: BuildProfile): CapsuleAccessPolicy {
  const visitor: CapabilityScope[] = ["site:view"];
  const reviewer: CapabilityScope[] = ["site:view", "comment:create", "feedback:export"];
  const owner: CapabilityScope[] = [
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
  if (profile === "production") return { profile, publicMode: "visitor", allowedModes: ["visitor"], scopesByMode: { visitor, reviewer: [], owner: [] }, ownerUnlock: { required: false, method: "none" }, tokenRequiredFor: [], notes: ["Production exposes no capsule capabilities."] };
  if (profile === "review") return { profile, publicMode: "reviewer", allowedModes: ["visitor", "reviewer"], scopesByMode: { visitor, reviewer, owner: [] }, ownerUnlock: { required: false, method: "none" }, tokenRequiredFor: ["comment:create", "feedback:export"], notes: ["Review is comment-only and cannot edit, patch, export owner bundles, or publish."] };
  return { profile, publicMode: "visitor", allowedModes: ["visitor", "reviewer", "owner"], scopesByMode: { visitor, reviewer, owner }, ownerUnlock: { required: true, method: "localKey", storageKey: "stitch:owner-unlock", warning: "Owner mode is intended for local/private/staging use." }, tokenRequiredFor: owner.filter((scope) => scope !== "site:view"), notes: ["Owner profile includes private tools and must be explicitly unlocked before owner actions."] };
}

export function createCapsuleExposureAudit(profile: BuildProfile): PublicExposureAudit {
  const includesReviewRuntime = profile === "review" || profile === "owner";
  const includesOwnerTools = profile === "owner";
  const findings: PublicExposureAudit["findings"] = [];
  if (includesReviewRuntime) findings.push({ code: "review-runtime-exposed", severity: "info", message: "Comment-only review runtime is included." });
  if (includesOwnerTools) findings.push({ code: "owner-tools-exposed", severity: "warning", message: "Owner workbench is included and should remain private or host-protected." });
  if (profile === "production") findings.push({ code: "production-public-safe", severity: "info", message: "Production capsule excludes review and owner tooling by default." });
  if (profile === "review") findings.push({ code: "review-profile-comment-only", severity: "info", message: "Review capsule can collect comments but cannot apply changes." });
  return {
    id: `capsule-audit-${profile}`,
    createdAt: new Date().toISOString(),
    profile,
    safeForPublic: profile === "production",
    includesOwnerTools,
    includesReviewRuntime,
    includesProjectState: false,
    includesEventHistory: false,
    includesMigrationBootstrap: false,
    findings,
    summary: profile === "production" ? "Public-safe production capsule." : profile === "review" ? "Comment-only review capsule." : "Owner capsule requires private access or unlock.",
  };
}


// Phase 14: owner-workbench export/download affordances.
export function describeArtifactDownload(artifact: MaterializedArtifact): string {
  const privateSummary = artifact.privacy.privateFileCount > 0 ? `${artifact.privacy.privateFileCount} private file(s) included` : "no private files included";
  const ready = artifact.downloadReady ? "ready" : "not ready";
  return `${artifact.fileName} is ${ready} for download: ${artifact.files.length} file(s), ${artifact.integrity.totalBytes} byte(s), ${privateSummary}.`;
}

export function createDownloadPanelHtml(artifact: MaterializedArtifact): string {
  const warnings = artifact.warnings.map((warning) => `<li data-severity="${escapeHtmlText(warning.severity)}">${escapeHtmlText(warning.message)}</li>`).join("");
  return `
    <section data-stitch-owner-panel="artifact-download">
      <h2>Export artifact</h2>
      <p>${escapeHtmlText(describeArtifactDownload(artifact))}</p>
      <dl>
        <dt>Profile</dt><dd>${escapeHtmlText(artifact.profile)}</dd>
        <dt>Format</dt><dd>${escapeHtmlText(artifact.format)}</dd>
        <dt>Integrity</dt><dd>${escapeHtmlText(artifact.integrity.hash)}</dd>
        <dt>Download ready</dt><dd>${artifact.downloadReady ? "yes" : "no"}</dd>
      </dl>
      <h3>Warnings</h3>
      <ul>${warnings || "<li>No materialization warnings.</li>"}</ul>
    </section>
  `;
}


function escapeHtmlText(value: string): string {
  return value.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char] ?? char);
}
