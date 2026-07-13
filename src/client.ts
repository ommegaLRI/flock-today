import type {
  FlockEditIntent,
  FlockProjectSummary,
  FlockSectionPacket,
  FlockSectionSummary,
} from './types.js';

const API = '/_flock/api';
const HOST_ID = 'flock-capsule-host';
const PAGE_STYLE_ID = 'flock-capsule-page-style';
const OPEN_KEY = 'flock:open';
const SECTION_KEY = 'flock:selected';

class ApiError extends Error {
  constructor(message: string, readonly code?: string, readonly failures: string[] = []) {
    super(message);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}

function ensurePageStyle(): void {
  if (document.getElementById(PAGE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PAGE_STYLE_ID;
  style.textContent = `
    html[data-flock-editing="true"] [data-stitch-role="section"][data-section-id] {
      outline: 2px dashed rgba(91, 75, 255, .72) !important;
      outline-offset: -2px !important;
      cursor: pointer !important;
    }
    html[data-flock-editing="true"] [data-stitch-role="section"][data-section-id]:hover,
    [data-flock-selected="true"] {
      outline: 4px solid rgb(91, 75, 255) !important;
      outline-offset: -4px !important;
    }
  `;
  document.head.append(style);
}

function styles(): string {
  return `
    :host { all: initial; color-scheme: light; }
    * { box-sizing: border-box; }
    button, textarea { font: inherit; }
    button { -webkit-tap-highlight-color: transparent; }
    .launch { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; border: 0; border-radius: 8px; padding: 12px 17px; background: #2B160A; color: white; box-shadow: 0 12px 40px rgba(0,0,0,.28); cursor: pointer; font: 650 14px/1 system-ui, sans-serif; }
    .panel { position: fixed; bottom: 14px; right: 14px; bottom: 14px; z-index: 2147483647; width: min(410px, calc(100vw - 28px)); height: 600px; display: flex; flex-direction: column; background: #F8F6F0; border-radius: 8px; box-shadow: 0 24px 80px rgba(22,18,45,.3); overflow: hidden; font: 14px/1.45 system-ui, sans-serif; color: #181622; }
    .hidden { display: none !important; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 15px 16px; border-bottom: 1px solid #e6e2f2; }
    header strong { font-size: 15px; }
    .icon { border: 0; background: transparent; color: #625e70; cursor: pointer; padding: 4px; font-size: 20px; }
    .body { padding: 16px; overflow: auto; display: grid; gap: 14px; }
    .status { display: flex; flex-wrap: wrap; gap: 6px; }
    .badge { display: inline-flex; border-radius: 4px; padding: 4px 8px; background: #F1EBDF; color: #4a4560; font-size: 11px; font-weight: 500; }
    .badge.modified { background: #fff0c7; color: #6c4b00; }
    .badge.preview { background: #dff6e9; color: #145a32; }
    .hint { margin: 0; color: #6f6a7c; }
    .section { display: grid; gap: 11px; }
    .section h2 { margin: 0; font-size: 17px; line-height: 1.25; }
    img { width: 100%; max-height: 190px; object-fit: cover; border-radius: 8px; border: 1px solid #ded9eb; }
    textarea { width: 100%; min-height: 126px; resize: vertical; border: 1px solid #cbc5de; border-radius: 8px; padding: 11px; background: white; color: #181622; outline: none; }
    textarea:focus { border-color: #2B160A; box-shadow: 0 0 0 3px rgba(91,75,255,.12); }
    .actions { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; }
    .primary, .secondary { border-radius: 4px; padding: 10px 12px; cursor: pointer; font-weight: 500; }
    .primary { border: 1px solid #2B160A; background: #2B160A; color: white; }
    .secondary { border: 1px solid #cbc5de; background: white; color: #322e40; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .message { min-height: 20px; margin: 0; color: #615b70; font-size: 12px; white-space: pre-wrap; }
    .message.error { color: #b3261e; }
    .empty { border: 1px dashed #cbc5de; border-radius: 12px; padding: 18px; text-align: center; color: #6f6a7c; }
    .model-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 2px; border-top: 1px solid #ebe7f4; }
    .model-row span { color: #777181; font-size: 11px; }
    .text-button { border: 0; background: transparent; color: #2B160A; padding: 5px 0; cursor: pointer; font-size: 11px; font-weight: 700; }
  `;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json() as { error?: string; code?: string; failures?: string[] } & T;
  if (!response.ok) {
    throw new ApiError(payload.error ?? `Flock request failed (${response.status}).`, payload.code, payload.failures ?? []);
  }
  return payload;
}

function sectionEndpoint(sectionId: string, action: string): string {
  return `${API}/sections/${encodeURIComponent(sectionId)}/${action}`;
}

function boot(): void {
  if (document.getElementById(HOST_ID)) return;
  ensurePageStyle();

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>${styles()}</style>
    <button class="launch" type="button">Edit with Flock</button>
    <aside class="panel hidden" aria-label="Flock owner editor">
      <header><strong>Editing</strong><button class="icon close" type="button" aria-label="Close">×</button></header>
      <div class="body">
        <p class="hint">Select a section and describe your changes.</p>
        <div class="empty">No section selected.</div>
        <div class="section hidden">
          <h2></h2>
          <img class="visual hidden" alt="Original Stitch section crop" />
          <textarea placeholder="Describe the change you want…"></textarea>
          <div class="actions">
            <button class="primary generate" type="button">Preview</button>
            <button class="secondary keep" type="button" disabled>Keep</button>
            <button class="secondary revert" type="button" disabled>Revert</button>
          </div>
          <p class="message"></p>
          <div class="status"></div>
          <div class="model-row"><span>Private local AI · model assets only are cached</span><button class="text-button remove-model" type="button">Change model</button></div>
        </div>
      </div>
    </aside>
  `;
  document.documentElement.append(host);

  const launch = shadow.querySelector<HTMLButtonElement>('.launch')!;
  const panel = shadow.querySelector<HTMLElement>('.panel')!;
  const close = shadow.querySelector<HTMLButtonElement>('.close')!;
  const status = shadow.querySelector<HTMLElement>('.status')!;
  const empty = shadow.querySelector<HTMLElement>('.empty')!;
  const sectionPanel = shadow.querySelector<HTMLElement>('.section')!;
  const heading = shadow.querySelector<HTMLElement>('h2')!;
  const visual = shadow.querySelector<HTMLImageElement>('.visual')!;
  const textarea = shadow.querySelector<HTMLTextAreaElement>('textarea')!;
  const generate = shadow.querySelector<HTMLButtonElement>('.generate')!;
  const keep = shadow.querySelector<HTMLButtonElement>('.keep')!;
  const revert = shadow.querySelector<HTMLButtonElement>('.revert')!;
  const message = shadow.querySelector<HTMLElement>('.message')!;
  const removeModel = shadow.querySelector<HTMLButtonElement>('.remove-model')!;

  let project: FlockProjectSummary | undefined;
  let selected: FlockSectionSummary | undefined;
  let editing = false;
  let busy = false;

  const setMessage = (value: string, error = false): void => {
    message.textContent = value;
    message.classList.toggle('error', error);
  };

  const setBusy = (value: boolean): void => {
    busy = value;
    textarea.disabled = value;
    generate.disabled = value || !selected;
    keep.disabled = value || !selected?.canRevert;
    revert.disabled = value || !selected?.canRevert;
  };

  const updateSection = (section: FlockSectionSummary): void => {
    selected = section;
    if (project) project.sections = project.sections.map((item) => item.id === section.id ? section : item);
    sessionStorage.setItem(SECTION_KEY, section.id);
    renderSection();
  };

  const renderStatus = (): void => {
    if (!project) return;
    const values = [
      project.stitchRunStatus && `Stitch: ${project.stitchRunStatus}`,
      project.projectionStatus && `Projection: ${project.projectionStatus}`,
      project.publicationStatus && `Publication: ${project.publicationStatus}`,
    ].filter(Boolean) as string[];
    status.innerHTML = values.map((value) => `<span class="badge">${escapeHtml(value)}</span>`).join('');
  };

  const renderSection = (): void => {
    document.querySelectorAll('[data-flock-selected="true"]').forEach((element) => element.removeAttribute('data-flock-selected'));
    if (!selected) {
      empty.classList.remove('hidden');
      sectionPanel.classList.add('hidden');
      return;
    }
    empty.classList.add('hidden');
    sectionPanel.classList.remove('hidden');
    const element = document.querySelector(`[data-stitch-role="section"][data-section-id="${CSS.escape(selected.id)}"]`);
    element?.setAttribute('data-flock-selected', 'true');
    heading.textContent = selected.label || selected.id;
    visual.classList.toggle('hidden', !selected.hasVisual);
    if (selected.hasVisual) visual.src = `${API}/visual/${encodeURIComponent(selected.id)}?t=${Date.now()}`;
    setBusy(busy);
  };

  const refreshProject = async (): Promise<void> => {
    project = await jsonFetch<FlockProjectSummary>(`${API}/project`);
    const storedId = sessionStorage.getItem(SECTION_KEY);
    selected = project.sections.find((section) => section.id === storedId);
    renderStatus();
    renderSection();
  };

  const open = async (): Promise<void> => {
    panel.classList.remove('hidden');
    launch.classList.add('hidden');
    editing = true;
    sessionStorage.setItem(OPEN_KEY, 'true');
    document.documentElement.dataset.flockEditing = 'true';
    try {
      await refreshProject();
      if (selected?.canRevert) setMessage('Preview restored. Keep or revert it.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), true);
    }
  };

  const dismiss = (): void => {
    panel.classList.add('hidden');
    launch.classList.remove('hidden');
    editing = false;
    sessionStorage.removeItem(OPEN_KEY);
    document.documentElement.removeAttribute('data-flock-editing');
    document.querySelectorAll('[data-flock-selected="true"]').forEach((element) => element.removeAttribute('data-flock-selected'));
  };

  launch.addEventListener('click', () => void open());
  close.addEventListener('click', dismiss);

  document.addEventListener('click', (event) => {
    if (!editing || busy || event.composedPath().includes(host)) return;
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-stitch-role="section"][data-section-id]')
      : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const id = target.dataset.sectionId;
    selected = project?.sections.find((section) => section.id === id);
    if (selected) sessionStorage.setItem(SECTION_KEY, selected.id);
    setMessage(selected?.canRevert ? 'This section has an uncommitted preview.' : '');
    renderSection();
  }, true);

  generate.addEventListener('click', async () => {
    if (!selected || busy) return;
    const instruction = textarea.value.trim();
    if (!instruction) return setMessage('Describe the change first.', true);
    setBusy(true);
    setMessage('Compiling section intelligence…');
    try {
      const packet = await jsonFetch<FlockSectionPacket>(sectionEndpoint(selected.id, 'context'));
      const local = await import('./inference/local.js');
      const onStatus = (value: string): void => setMessage(value);
      const intent: FlockEditIntent = await local.interpretInstruction(packet, instruction, onStatus);
      let candidate = await local.generateCandidate(packet, instruction, intent, onStatus);
      let repaired = false;

      while (true) {
        try {
          const result = await jsonFetch<{ section: FlockSectionSummary }>(sectionEndpoint(selected.id, 'preview'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ baseHash: packet.section.baseHash, source: candidate, intent }),
          });
          updateSection(result.section);
          setMessage('Preview applied. Keep it or revert it.');
          break;
        } catch (error) {
          if (error instanceof ApiError && error.code === 'candidate_invalid' && error.failures.length && !repaired) {
            repaired = true;
            candidate = await local.repairCandidate(packet, instruction, intent, candidate, error.failures, onStatus);
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      const details = error instanceof ApiError && error.failures.length ? `\n${error.failures.join('\n')}` : '';
      setMessage(`${error instanceof Error ? error.message : String(error)}${details}`, true);
    } finally {
      setBusy(false);
    }
  });

  keep.addEventListener('click', async () => {
    if (!selected || busy) return;
    setBusy(true);
    setMessage('Keeping preview…');
    try {
      const result = await jsonFetch<{ section: FlockSectionSummary }>(sectionEndpoint(selected.id, 'keep'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      updateSection(result.section);
      setMessage('Kept. Git remains the durable history.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBusy(false);
    }
  });

  revert.addEventListener('click', async () => {
    if (!selected || busy) return;
    setBusy(true);
    setMessage('Reverting preview…');
    try {
      const result = await jsonFetch<{ section: FlockSectionSummary }>(sectionEndpoint(selected.id, 'revert'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      updateSection(result.section);
      setMessage('Preview reverted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBusy(false);
    }
  });

  removeModel.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    setMessage('Removing cached local model…');
    try {
      const local = await import('./inference/local.js');
      await local.removeLocalModel();
      setMessage('Local model removed from this device.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBusy(false);
    }
  });

  if (sessionStorage.getItem(OPEN_KEY) === 'true') void open();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
