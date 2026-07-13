const API = '/_flock/api';
const HOST_ID = 'flock-capsule-host';
const PAGE_STYLE_ID = 'flock-capsule-page-style';

type Section = {
  id: string;
  label?: string;
  intent?: string;
  file: string;
  modified: boolean;
  hasVisual: boolean;
};

type Project = {
  projectId: string;
  projectName?: string;
  generatorAvailable: boolean;
  stitchRunStatus?: string;
  projectionStatus?: string;
  publicationStatus?: string;
  sections: Section[];
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}

function ensurePageStyle(): HTMLStyleElement {
  const existing = document.getElementById(PAGE_STYLE_ID) as HTMLStyleElement | null;
  if (existing) return existing;
  const style = document.createElement('style');
  style.id = PAGE_STYLE_ID;
  style.textContent = `
    html[data-flock-editing="true"] [data-stitch-role="section"][data-section-id] {
      outline: 2px dashed rgba(91, 75, 255, .7) !important;
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
  return style;
}

function styles(): string {
  return `
    :host { all: initial; color-scheme: light; }
    * { box-sizing: border-box; }
    button, textarea { font: inherit; }
    .launch { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; border: 0; border-radius: 999px; padding: 11px 16px; background: #15131c; color: white; box-shadow: 0 12px 40px rgba(0,0,0,.28); cursor: pointer; font: 600 14px/1 system-ui, sans-serif; }
    .panel { position: fixed; top: 14px; right: 14px; bottom: 14px; z-index: 2147483647; width: min(390px, calc(100vw - 28px)); display: flex; flex-direction: column; background: #fbfaff; border: 1px solid #ddd9ef; border-radius: 18px; box-shadow: 0 24px 80px rgba(22,18,45,.3); overflow: hidden; font: 14px/1.45 system-ui, sans-serif; color: #181622; }
    .hidden { display: none !important; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 16px 14px; border-bottom: 1px solid #e6e2f2; }
    header strong { font-size: 15px; }
    .icon { border: 0; background: transparent; color: #625e70; cursor: pointer; padding: 4px; font-size: 20px; }
    .body { padding: 16px; overflow: auto; display: grid; gap: 14px; }
    .status { display: flex; flex-wrap: wrap; gap: 6px; }
    .badge { display: inline-flex; border-radius: 999px; padding: 4px 8px; background: #ece9f8; color: #4a4560; font-size: 11px; font-weight: 650; }
    .badge.modified { background: #fff0c7; color: #6c4b00; }
    .hint { margin: 0; color: #6f6a7c; }
    .section { display: grid; gap: 10px; }
    .section h2 { margin: 0; font-size: 17px; line-height: 1.2; }
    .meta { color: #777181; font-size: 12px; overflow-wrap: anywhere; }
    img { width: 100%; max-height: 190px; object-fit: cover; border-radius: 10px; border: 1px solid #ded9eb; }
    textarea { width: 100%; min-height: 130px; resize: vertical; border: 1px solid #cbc5de; border-radius: 10px; padding: 11px; background: white; color: #181622; outline: none; }
    textarea:focus { border-color: #5b4bff; box-shadow: 0 0 0 3px rgba(91,75,255,.12); }
    .actions { display: flex; gap: 8px; }
    .primary, .secondary { border-radius: 9px; padding: 10px 13px; cursor: pointer; font-weight: 650; }
    .primary { border: 1px solid #5b4bff; background: #5b4bff; color: white; flex: 1; }
    .secondary { border: 1px solid #cbc5de; background: white; color: #322e40; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .message { min-height: 20px; margin: 0; color: #615b70; font-size: 12px; }
    .message.error { color: #b3261e; }
    .empty { border: 1px dashed #cbc5de; border-radius: 12px; padding: 18px; text-align: center; color: #6f6a7c; }
  `;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json() as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error ?? `Flock request failed (${response.status}).`);
  return payload;
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
    <aside class="panel hidden" aria-label="Flock owner capsule">
      <header><strong>Flock</strong><button class="icon close" type="button" aria-label="Close">×</button></header>
      <div class="body">
        <div class="status"></div>
        <p class="hint">Select a Stitch section on the page.</p>
        <div class="empty">No section selected.</div>
        <div class="section hidden">
          <div><h2></h2><div class="meta"></div></div>
          <img class="visual hidden" alt="Original Stitch section crop" />
          <textarea placeholder="Describe the change you want…"></textarea>
          <div class="actions">
            <button class="primary regenerate" type="button">Regenerate section</button>
            <button class="secondary revert" type="button" disabled>Revert</button>
          </div>
          <p class="message"></p>
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
  const meta = shadow.querySelector<HTMLElement>('.meta')!;
  const visual = shadow.querySelector<HTMLImageElement>('.visual')!;
  const textarea = shadow.querySelector<HTMLTextAreaElement>('textarea')!;
  const regenerate = shadow.querySelector<HTMLButtonElement>('.regenerate')!;
  const revert = shadow.querySelector<HTMLButtonElement>('.revert')!;
  const message = shadow.querySelector<HTMLElement>('.message')!;

  let project: Project | undefined;
  let selected: Section | undefined;
  let editing = false;

  const setMessage = (value: string, error = false): void => {
    message.textContent = value;
    message.classList.toggle('error', error);
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
    meta.textContent = `${selected.id} · ${selected.file}`;
    heading.insertAdjacentHTML('beforeend', selected.modified ? ' <span class="badge modified">Modified</span>' : ' <span class="badge">Original</span>');
    visual.classList.toggle('hidden', !selected.hasVisual);
    if (selected.hasVisual) visual.src = `${API}/visual/${encodeURIComponent(selected.id)}?t=${Date.now()}`;
    regenerate.disabled = !project?.generatorAvailable;
    setMessage(project?.generatorAvailable ? '' : 'The built-in AI will be connected in the next phase.');
  };

  const open = async (): Promise<void> => {
    panel.classList.remove('hidden');
    launch.classList.add('hidden');
    editing = true;
    document.documentElement.dataset.flockEditing = 'true';
    try {
      project = await jsonFetch<Project>(`${API}/project`);
      renderStatus();
      renderSection();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), true);
    }
  };

  const dismiss = (): void => {
    panel.classList.add('hidden');
    launch.classList.remove('hidden');
    editing = false;
    document.documentElement.removeAttribute('data-flock-editing');
    document.querySelectorAll('[data-flock-selected="true"]').forEach((element) => element.removeAttribute('data-flock-selected'));
  };

  launch.addEventListener('click', () => void open());
  close.addEventListener('click', dismiss);

  document.addEventListener('click', (event) => {
    if (!editing || event.composedPath().includes(host)) return;
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-stitch-role="section"][data-section-id]')
      : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const id = target.dataset.sectionId;
    selected = project?.sections.find((section) => section.id === id);
    renderSection();
  }, true);

  regenerate.addEventListener('click', async () => {
    if (!selected || !project?.generatorAvailable) return;
    const instruction = textarea.value.trim();
    if (!instruction) return setMessage('Describe the change first.', true);
    regenerate.disabled = true;
    revert.disabled = true;
    setMessage('Regenerating section…');
    try {
      const result = await jsonFetch<{ section: Section; canRevert: boolean }>(`${API}/regenerate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sectionId: selected.id, instruction, route: location.pathname }),
      });
      selected = result.section;
      project.sections = project.sections.map((section) => section.id === selected?.id ? result.section : section);
      revert.disabled = !result.canRevert;
      setMessage('Section updated. Astro will refresh the page.');
      renderSection();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), true);
      regenerate.disabled = false;
    }
  });

  revert.addEventListener('click', async () => {
    if (!selected) return;
    revert.disabled = true;
    setMessage('Reverting section…');
    try {
      const result = await jsonFetch<{ section: Section; canRevert: boolean }>(`${API}/revert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sectionId: selected.id }),
      });
      selected = result.section;
      project!.sections = project!.sections.map((section) => section.id === selected?.id ? result.section : section);
      setMessage('Section reverted. Astro will refresh the page.');
      renderSection();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), true);
    }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
