import type {
  FlockAsset,
  FlockEditIntent,
  FlockInferenceProvider,
  FlockProjectSummary,
  FlockSectionPacket,
  FlockSectionSummary,
} from './types.js';
import type { LocalAILogEvent } from './inference/local.js';

const API = '/_flock/api';
const HOST_ID = 'flock-capsule-host';
const PAGE_STYLE_ID = 'flock-capsule-page-style';
const OPEN_KEY = 'flock:open';
const SECTION_KEY = 'flock:selected';
const DEV_KEY = 'flock:dev-mode';
const PROVIDER_KEY = 'flock:inference-provider';
const MAX_DEV_LOGS = 500;
const MAX_DEV_DETAIL_CHARS = 500_000;
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_ASSETS_PER_SECTION = 4;

interface PendingAsset {
  file: File;
  mimeType: FlockAsset['mimeType'];
  previewUrl?: string;
  uploaded?: FlockAsset;
}

interface ClientDevLogEvent {
  type: 'client' | 'network' | 'validation' | 'browser';
  phase: string;
  timestamp: number;
  message: string;
  durationMs?: number;
  details?: unknown;
  failures?: string[];
  error?: string;
}

type DevLogEvent = LocalAILogEvent | ClientDevLogEvent;
type DevLogger = (event: DevLogEvent) => void;

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
    button, textarea, input { font: inherit; }
    button { -webkit-tap-highlight-color: transparent; }
    .launch { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; border: 0; border-radius: 8px; padding: 12px 17px; background: #2B160A; color: white; box-shadow: 0 12px 40px rgba(0,0,0,.28); cursor: pointer; font: 650 14px/1 system-ui, sans-serif; }
    .panel, .dev-panel { position: fixed; bottom: 14px; z-index: 2147483647; height: 600px; display: flex; flex-direction: column; background: #F8F6F0; border-radius: 8px; box-shadow: 0 24px 80px rgba(22,18,45,.3); overflow: hidden; font: 14px/1.45 system-ui, sans-serif; color: #181622; }
    .panel { right: 14px; width: min(410px, calc(100vw - 28px)); }
    .dev-panel { right: 438px; width: min(560px, calc(100vw - 466px)); }
    .hidden { display: none !important; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 15px 16px; border-bottom: 1px solid #e6e2f2; }
    header strong { font-size: 15px; }
    .header-actions { display: flex; align-items: center; gap: 12px; }
    .icon { border: 0; background: transparent; color: #625e70; cursor: pointer; padding: 4px; font-size: 20px; }
    .body { padding: 16px; overflow: auto; display: grid; gap: 14px; }
    .status { display: flex; flex-wrap: wrap; gap: 6px; }
    .badge { display: inline-flex; border-radius: 4px; padding: 4px 8px; background: #F1EBDF; color: #4a4560; font-size: 11px; font-weight: 500; }
    .badge.modified { background: #fff0c7; color: #6c4b00; }
    .badge.preview { background: #dff6e9; color: #145a32; }
    .hint { margin: 0; color: #6f6a7c; }
    .section { display: grid; gap: 11px; }
    .section h2 { margin: 0; font-size: 17px; line-height: 1.25; }
    .visual { width: 100%; max-height: 190px; object-fit: cover; border-radius: 8px; border: 1px solid #ded9eb; }
    .asset-picker { display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 1px dashed #bdb5d3; border-radius: 8px; padding: 11px; background: white; cursor: pointer; }
    .asset-picker.dragging { border-color: #5B4BFF; box-shadow: 0 0 0 3px rgba(91,75,255,.12); }
    .asset-picker.disabled { opacity: .5; cursor: not-allowed; }
    .asset-picker input { display: none; }
    .asset-picker strong { display: block; color: #322e40; font-size: 12px; }
    .asset-picker span { display: block; color: #777181; font-size: 10px; }
    .asset-choose { flex: none; border: 1px solid #cbc5de; border-radius: 4px; padding: 7px 9px; background: #F8F6F0; color: #322e40; cursor: pointer; font-size: 11px; font-weight: 700; }
    .asset-list { display: grid; gap: 7px; }
    .asset-item { display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: center; gap: 9px; border: 1px solid #ded9eb; border-radius: 7px; padding: 7px; background: white; }
    .asset-thumb { width: 42px; height: 42px; object-fit: cover; border-radius: 5px; border: 1px solid #ebe7f4; background: #f2efe8; }
    .asset-placeholder { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 5px; background: #f2efe8; color: #625e70; font-size: 10px; font-weight: 800; }
    .asset-copy { min-width: 0; }
    .asset-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #322e40; font-size: 11px; font-weight: 700; }
    .asset-meta { color: #777181; font-size: 10px; }
    .asset-remove { border: 0; background: transparent; color: #777181; cursor: pointer; padding: 5px; font-size: 16px; }

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
    .dev-toggle.active { color: #5B4BFF; }
    .dev-log { flex: 1; overflow: auto; padding: 10px; background: #f2efe8; }
    .dev-empty { padding: 20px 10px; text-align: center; color: #777181; font-size: 12px; }
    .log-entry { margin: 0 0 8px; border: 1px solid #ded9eb; border-radius: 6px; background: white; overflow: hidden; }
    .log-entry summary { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px; padding: 9px 10px; cursor: pointer; list-style: none; }
    .log-entry summary::-webkit-details-marker { display: none; }
    .log-time { color: #777181; font: 10px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace; }
    .log-label { color: #2f2b3c; font-size: 12px; font-weight: 700; }
    .log-meta { color: #777181; font-size: 10px; }
    .log-entry pre { max-height: 390px; margin: 0; padding: 11px; overflow: auto; border-top: 1px solid #ebe7f4; background: #17151d; color: #f5f2ff; white-space: pre-wrap; overflow-wrap: anywhere; font: 11px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; }
    @media (max-width: 900px) {
      .dev-panel { right: 14px; width: min(560px, calc(100vw - 28px)); }
    }
  `;
}

async function jsonFetch<T>(url: string, init?: RequestInit, onLog?: DevLogger): Promise<T> {
  const startedAt = performance.now();
  const method = init?.method ?? 'GET';
  const bodyCharacters = typeof init?.body === 'string' ? init.body.length : undefined;
  onLog?.({
    type: 'network',
    phase: 'request-start',
    timestamp: Date.now(),
    message: `${method} ${url}`,
    details: { method, url, bodyCharacters },
  });
  try {
    const response = await fetch(url, init);
    onLog?.({
      type: 'network',
      phase: 'response-headers',
      timestamp: Date.now(),
      durationMs: Math.round(performance.now() - startedAt),
      message: `${method} ${url} returned ${response.status}.`,
      details: {
        method,
        url,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type'),
        contentLength: response.headers.get('content-length'),
      },
    });
    const text = await response.text();
    onLog?.({
      type: 'network',
      phase: 'response-body',
      timestamp: Date.now(),
      durationMs: Math.round(performance.now() - startedAt),
      message: `Read the response body for ${method} ${url}.`,
      details: { responseCharacters: text.length },
    });
    let payload: ({ error?: string; code?: string; failures?: string[] } & T);
    try {
      payload = JSON.parse(text || '{}') as { error?: string; code?: string; failures?: string[] } & T;
    } catch (error) {
      throw new ApiError(`Flock returned invalid JSON (${response.status}). ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      throw new ApiError(payload.error ?? `Flock request failed (${response.status}).`, payload.code, payload.failures ?? []);
    }
    onLog?.({
      type: 'network',
      phase: 'request-finish',
      timestamp: Date.now(),
      durationMs: Math.round(performance.now() - startedAt),
      message: `${method} ${url} completed successfully.`,
    });
    return payload;
  } catch (error) {
    onLog?.({
      type: 'network',
      phase: 'request-error',
      timestamp: Date.now(),
      durationMs: Math.round(performance.now() - startedAt),
      message: `${method} ${url} failed.`,
      error: error instanceof Error ? error.stack || error.message : String(error),
      details: {
        code: error instanceof ApiError ? error.code : undefined,
        failures: error instanceof ApiError ? error.failures : undefined,
      },
    });
    throw error;
  }
}

function sectionEndpoint(sectionId: string, action: string): string {
  return `${API}/sections/${encodeURIComponent(sectionId)}/${action}`;
}

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      if (comma < 0) reject(new Error(`Could not read ${file.name}.`));
      else resolve(result.slice(comma + 1));
    }, { once: true });
    reader.addEventListener('error', () => reject(reader.error ?? new Error(`Could not read ${file.name}.`)), { once: true });
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
      <header>
        <strong>Editing</strong>
        <div class="header-actions">
          <button class="text-button dev-toggle" type="button" aria-pressed="false">Dev mode</button>
          <button class="icon close" type="button" aria-label="Close">×</button>
        </div>
      </header>
      <div class="body">
        <p class="hint">Select a section and describe your changes.</p>
        <div class="empty">No section selected.</div>
        <div class="section hidden">
          <h2></h2>
          <img class="visual hidden" alt="Original Stitch section crop" />
          <div class="asset-picker" role="button" tabindex="0" aria-label="Add PNG or SVG assets">
            <input class="asset-input" type="file" accept=".png,.svg,image/png,image/svg+xml" multiple />
            <div><strong>Add assets</strong><span>Drop PNG or SVG files here · 5 MB max</span></div>
            <button class="asset-choose" type="button">Choose</button>
          </div>
          <div class="asset-list"></div>
          <textarea placeholder="Describe the change you want…"></textarea>
          <div class="actions">
            <button class="primary generate" type="button">Preview</button>
            <button class="secondary keep" type="button" disabled>Keep</button>
            <button class="secondary revert" type="button" disabled>Revert</button>
          </div>
          <p class="message"></p>
          <div class="status"></div>
          <div class="model-row"><span class="provider-label">Local AI</span><div class="header-actions"><button class="text-button provider-toggle" type="button">Use OpenAI</button><button class="text-button remove-model" type="button">Clear local model</button></div></div>
        </div>
      </div>
    </aside>
    <aside class="dev-panel hidden" aria-label="Flock model activity">
      <header><strong>Flock diagnostics</strong><div class="header-actions"><button class="text-button copy-logs" type="button">Copy</button><button class="text-button clear-logs" type="button">Clear</button><button class="icon dev-close" type="button" aria-label="Close dev mode">×</button></div></header>
      <div class="dev-log"><div class="dev-empty">No model activity yet.</div></div>
    </aside>
  `;
  document.documentElement.append(host);

  const launch = shadow.querySelector<HTMLButtonElement>('.launch')!;
  const panel = shadow.querySelector<HTMLElement>('.panel')!;
  const devPanel = shadow.querySelector<HTMLElement>('.dev-panel')!;
  const devToggle = shadow.querySelector<HTMLButtonElement>('.dev-toggle')!;
  const copyLogs = shadow.querySelector<HTMLButtonElement>('.copy-logs')!;
  const clearLogs = shadow.querySelector<HTMLButtonElement>('.clear-logs')!;
  const devClose = shadow.querySelector<HTMLButtonElement>('.dev-close')!;
  const devLog = shadow.querySelector<HTMLElement>('.dev-log')!;
  const close = shadow.querySelector<HTMLButtonElement>('.close')!;
  const status = shadow.querySelector<HTMLElement>('.status')!;
  const empty = shadow.querySelector<HTMLElement>('.empty')!;
  const sectionPanel = shadow.querySelector<HTMLElement>('.section')!;
  const heading = shadow.querySelector<HTMLElement>('h2')!;
  const visual = shadow.querySelector<HTMLImageElement>('.visual')!;
  const assetPicker = shadow.querySelector<HTMLElement>('.asset-picker')!;
  const assetInput = shadow.querySelector<HTMLInputElement>('.asset-input')!;
  const assetChoose = shadow.querySelector<HTMLButtonElement>('.asset-choose')!;
  const assetList = shadow.querySelector<HTMLElement>('.asset-list')!;
  const textarea = shadow.querySelector<HTMLTextAreaElement>('textarea')!;
  const generate = shadow.querySelector<HTMLButtonElement>('.generate')!;
  const keep = shadow.querySelector<HTMLButtonElement>('.keep')!;
  const revert = shadow.querySelector<HTMLButtonElement>('.revert')!;
  const message = shadow.querySelector<HTMLElement>('.message')!;
  const removeModel = shadow.querySelector<HTMLButtonElement>('.remove-model')!;
  const providerToggle = shadow.querySelector<HTMLButtonElement>('.provider-toggle')!;
  const providerLabel = shadow.querySelector<HTMLElement>('.provider-label')!;

  let project: FlockProjectSummary | undefined;
  let selected: FlockSectionSummary | undefined;
  let editing = false;
  let busy = false;
  let devMode = sessionStorage.getItem(DEV_KEY) === 'true';
  let provider: FlockInferenceProvider = sessionStorage.getItem(PROVIDER_KEY) === 'openai' ? 'openai' : 'local';
  let devRenderPending = false;
  const devLogs: DevLogEvent[] = [];
  const pendingAssets = new Map<string, PendingAsset[]>();

  const setMessage = (value: string, error = false): void => {
    message.textContent = value;
    message.classList.toggle('error', error);
  };

  const devLogLabel = (event: DevLogEvent): string => {
    const scope = `${event.type.charAt(0).toUpperCase()}${event.type.slice(1)}`;
    if (event.type === 'call' && event.call) {
      const call = `${event.call.charAt(0).toUpperCase()}${event.call.slice(1)}`;
      return `${call} · ${event.phase}`;
    }
    if (event.type === 'stream' && event.call) return `${event.call} stream · ${event.phase}`;
    return `${scope} · ${event.phase}`;
  };

  const devLogDetail = (event: DevLogEvent): string => {
    const payload = { ...event } as Record<string, unknown>;
    delete payload.timestamp;
    let detail: string;
    try {
      detail = JSON.stringify(payload, null, 2);
    } catch {
      detail = String(payload);
    }
    if (detail.length <= MAX_DEV_DETAIL_CHARS) return detail;
    return `${detail.slice(0, MAX_DEV_DETAIL_CHARS)}\n\n… ${
      (detail.length - MAX_DEV_DETAIL_CHARS).toLocaleString()
    } additional characters omitted from the panel.`;
  };

  const renderDevLogs = (): void => {
    devRenderPending = false;
    if (!devLogs.length) {
      devLog.innerHTML = '<div class="dev-empty">No model activity yet.</div>';
      return;
    }
    devLog.innerHTML = devLogs.map((event, index) => {
      const date = new Date(event.timestamp);
      const time = `${date.toLocaleTimeString()}.${String(date.getMilliseconds()).padStart(3, '0')}`;
      const duration = typeof event.durationMs === 'number' ? `${event.durationMs.toLocaleString()} ms` : '';
      return `<details class="log-entry" data-log-index="${index}"><summary><span class="log-time">${escapeHtml(time)}</span><span class="log-label">${escapeHtml(devLogLabel(event))}</span><span class="log-meta">${escapeHtml(duration)}</span></summary></details>`;
    }).join('');
    if (devMode) devLog.scrollTop = devLog.scrollHeight;
  };

  const scheduleDevRender = (): void => {
    if (!devMode || devRenderPending) return;
    devRenderPending = true;
    requestAnimationFrame(renderDevLogs);
  };

  devLog.addEventListener('toggle', (event) => {
    const entry = event.target;
    if (!(entry instanceof HTMLDetailsElement) || !entry.open || entry.querySelector('pre')) return;
    const index = Number(entry.dataset.logIndex);
    const logEvent = devLogs[index];
    if (!logEvent) return;
    const detail = document.createElement('pre');
    detail.textContent = devLogDetail(logEvent);
    entry.append(detail);
  }, true);

  const appendDevLog = (event: DevLogEvent): void => {
    devLogs.push(event);
    if (devLogs.length > MAX_DEV_LOGS) devLogs.splice(0, devLogs.length - MAX_DEV_LOGS);
    scheduleDevRender();
  };

  const logBrowserEvent = (event: ClientDevLogEvent): void => {
    if (devMode) appendDevLog(event);
  };

  window.addEventListener('error', (event) => {
    logBrowserEvent({
      type: 'browser',
      phase: 'window-error',
      timestamp: Date.now(),
      message: 'An uncaught error reached the browser window.',
      error: event.error instanceof Error ? event.error.stack || event.error.message : event.message,
      details: { filename: event.filename, line: event.lineno, column: event.colno },
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    logBrowserEvent({
      type: 'browser',
      phase: 'unhandled-rejection',
      timestamp: Date.now(),
      message: 'An unhandled promise rejection reached the browser window.',
      error: event.reason instanceof Error ? event.reason.stack || event.reason.message : String(event.reason),
    });
  });
  window.addEventListener('online', () => logBrowserEvent({
    type: 'browser', phase: 'online', timestamp: Date.now(), message: 'The browser reported that it is online.',
  }));
  window.addEventListener('offline', () => logBrowserEvent({
    type: 'browser', phase: 'offline', timestamp: Date.now(), message: 'The browser reported that it is offline.',
  }));
  document.addEventListener('visibilitychange', () => logBrowserEvent({
    type: 'browser',
    phase: 'visibility-change',
    timestamp: Date.now(),
    message: `Document visibility changed to ${document.visibilityState}.`,
    details: { visibilityState: document.visibilityState },
  }));
  try {
    const longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        logBrowserEvent({
          type: 'browser',
          phase: 'long-task',
          timestamp: Date.now(),
          durationMs: Math.round(entry.duration),
          message: 'The browser main thread was blocked by a long task.',
          details: { name: entry.name, startTime: entry.startTime, duration: entry.duration },
        });
      }
    });
    longTaskObserver.observe({ entryTypes: ['longtask'] });
  } catch {
    // Long Task API is optional and unavailable in some browsers.
  }

  const setDevMode = (value: boolean): void => {
    devMode = value;
    devToggle.classList.toggle('active', value);
    devToggle.setAttribute('aria-pressed', String(value));
    devPanel.classList.toggle('hidden', !value || !editing);
    if (value) {
      sessionStorage.setItem(DEV_KEY, 'true');
      appendDevLog({
        type: 'browser',
        phase: 'dev-mode-enabled',
        timestamp: Date.now(),
        message: 'Detailed in-memory diagnostics are enabled.',
        details: {
          location: location.href,
          online: navigator.onLine,
          visibilityState: document.visibilityState,
          secureContext: globalThis.isSecureContext,
          crossOriginIsolated: globalThis.crossOriginIsolated,
        },
      });
      scheduleDevRender();
    } else {
      sessionStorage.removeItem(DEV_KEY);
    }
  };

  const assetsFor = (sectionId = selected?.id): PendingAsset[] => {
    if (!sectionId) return [];
    return pendingAssets.get(sectionId) ?? [];
  };

  const clearAssets = (sectionId: string): void => {
    const assets = pendingAssets.get(sectionId) ?? [];
    for (const asset of assets) if (asset.previewUrl) URL.revokeObjectURL(asset.previewUrl);
    pendingAssets.delete(sectionId);
    if (selected?.id === sectionId) assetList.innerHTML = '';
  };

  const renderAssets = (): void => {
    const assets = assetsFor();
    const locked = busy || Boolean(selected?.canRevert);
    assetList.innerHTML = assets.map((entry, index) => {
      const preview = entry.uploaded?.publicUrl ?? entry.previewUrl;
      const thumbnail = preview
        ? `<img class="asset-thumb" src="${escapeHtml(preview)}" alt="" />`
        : '<div class="asset-placeholder">SVG</div>';
      const state = entry.uploaded ? 'Staged' : 'Ready to upload';
      return `<div class="asset-item">${thumbnail}<div class="asset-copy"><div class="asset-name">${escapeHtml(entry.file.name)}</div><div class="asset-meta">${escapeHtml(`${state} · ${formatBytes(entry.file.size)}`)}</div></div><button class="asset-remove" type="button" data-asset-index="${index}" aria-label="Remove ${escapeHtml(entry.file.name)}" ${locked ? 'disabled' : ''}>×</button></div>`;
    }).join('');
  };

  const addAssetFiles = (files: File[]): void => {
    if (!selected) return setMessage('Select a section first.', true);
    if (busy || selected.canRevert) return;
    const assets = assetsFor(selected.id);
    for (const file of files) {
      if (assets.length >= MAX_ASSETS_PER_SECTION) {
        setMessage(`A section can use up to ${MAX_ASSETS_PER_SECTION} uploaded assets at once.`, true);
        break;
      }
      const lowerName = file.name.toLowerCase();
      const mimeType: FlockAsset['mimeType'] | undefined = file.type === 'image/png' || lowerName.endsWith('.png')
        ? 'image/png'
        : file.type === 'image/svg+xml' || lowerName.endsWith('.svg')
          ? 'image/svg+xml'
          : undefined;
      if (!mimeType) {
        setMessage(`${file.name} is not a PNG or SVG.`, true);
        continue;
      }
      if (!file.size || file.size > MAX_ASSET_BYTES) {
        setMessage(`${file.name} must be smaller than 5 MB.`, true);
        continue;
      }
      if (assets.some((entry) => entry.file.name === file.name && entry.file.size === file.size && entry.file.lastModified === file.lastModified)) continue;
      assets.push({
        file,
        mimeType,
        previewUrl: mimeType === 'image/png' ? URL.createObjectURL(file) : undefined,
      });
    }
    if (assets.length) pendingAssets.set(selected.id, assets);
    renderAssets();
    if (assets.length) setMessage('Asset ready. Describe how it should be used, then preview.');
  };

  const uploadAssets = async (sectionId: string, onLog?: DevLogger): Promise<FlockAsset[]> => {
    const assets = assetsFor(sectionId);
    for (let index = 0; index < assets.length; index += 1) {
      const entry = assets[index]!;
      if (entry.uploaded) continue;
      setMessage(`Uploading ${entry.file.name}…`);
      const dataBase64 = await fileBase64(entry.file);
      const result = await jsonFetch<{ asset: FlockAsset }>(sectionEndpoint(sectionId, 'assets'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: entry.file.name, mimeType: entry.mimeType, dataBase64 }),
      }, onLog);
      entry.uploaded = result.asset;
      renderAssets();
    }
    return assets.map((entry) => entry.uploaded).filter((asset): asset is FlockAsset => Boolean(asset));
  };

  const discardUploadedAssets = async (sectionId: string, onLog?: DevLogger): Promise<void> => {
    const assets = assetsFor(sectionId);
    if (!assets.some((entry) => entry.uploaded)) return;
    await jsonFetch<{ discarded: true }>(sectionEndpoint(sectionId, 'assets'), { method: 'DELETE' }, onLog);
    for (const entry of assets) entry.uploaded = undefined;
    renderAssets();
  };

  const setBusy = (value: boolean): void => {
    busy = value;
    const previewActive = Boolean(selected?.canRevert);
    textarea.disabled = value || previewActive;
    assetInput.disabled = value || previewActive || !selected;
    assetChoose.disabled = value || previewActive || !selected;
    assetPicker.classList.toggle('disabled', assetInput.disabled);
    assetPicker.setAttribute('aria-disabled', String(assetInput.disabled));
    generate.disabled = value || !selected || previewActive;
    keep.disabled = value || !selected?.canRevert;
    revert.disabled = value || !selected?.canRevert;
    devToggle.disabled = value;
    providerToggle.disabled = value;
    renderAssets();
  };


  const renderProvider = (): void => {
    const openai = provider === 'openai';
    providerToggle.textContent = openai ? 'Use local' : 'Use OpenAI';
    providerLabel.textContent = openai
      ? `API${project?.inference?.openaiModel ? ` · ${project.inference.openaiModel}` : ''}`
      : 'Local AI';
    removeModel.classList.toggle('hidden', openai);
  };

  const setProvider = (value: FlockInferenceProvider): void => {
    provider = value;
    sessionStorage.setItem(PROVIDER_KEY, value);
    renderProvider();
    setMessage(value === 'openai'
      ? (project?.inference?.openaiAvailable ? 'API selected.' : 'API selected, but OPENAI_API_KEY is not configured.')
      : 'Local AI selected.', value === 'openai' && project?.inference?.openaiAvailable === false);
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
    project = await jsonFetch<FlockProjectSummary>(`${API}/project`, undefined, devMode ? appendDevLog : undefined);
    const storedId = sessionStorage.getItem(SECTION_KEY);
    selected = project.sections.find((section) => section.id === storedId);
    renderStatus();
    renderProvider();
    renderSection();
  };

  const open = async (): Promise<void> => {
    panel.classList.remove('hidden');
    launch.classList.add('hidden');
    editing = true;
    sessionStorage.setItem(OPEN_KEY, 'true');
    document.documentElement.dataset.flockEditing = 'true';
    renderProvider();
  setDevMode(devMode);
    try {
      await refreshProject();
      if (selected?.canRevert) setMessage('Preview restored. Keep or revert it.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), true);
    }
  };

  const dismiss = (): void => {
    panel.classList.add('hidden');
    devPanel.classList.add('hidden');
    launch.classList.remove('hidden');
    editing = false;
    sessionStorage.removeItem(OPEN_KEY);
    document.documentElement.removeAttribute('data-flock-editing');
    document.querySelectorAll('[data-flock-selected="true"]').forEach((element) => element.removeAttribute('data-flock-selected'));
  };

  launch.addEventListener('click', () => void open());
  close.addEventListener('click', dismiss);
  devToggle.addEventListener('click', () => setDevMode(!devMode));
  devClose.addEventListener('click', () => setDevMode(false));
  providerToggle.addEventListener('click', () => setProvider(provider === 'local' ? 'openai' : 'local'));
  copyLogs.addEventListener('click', async () => {
    const original = copyLogs.textContent;
    try {
      await navigator.clipboard.writeText(JSON.stringify(devLogs, null, 2));
      copyLogs.textContent = 'Copied';
    } catch (error) {
      appendDevLog({
        type: 'browser',
        phase: 'copy-error',
        timestamp: Date.now(),
        message: 'Could not copy the diagnostic log to the clipboard.',
        error: error instanceof Error ? error.stack || error.message : String(error),
      });
      copyLogs.textContent = 'Copy failed';
    }
    globalThis.setTimeout(() => { copyLogs.textContent = original; }, 1_500);
  });
  clearLogs.addEventListener('click', () => {
    devLogs.length = 0;
    scheduleDevRender();
  });

  const chooseAssets = (): void => {
    if (!assetInput.disabled) assetInput.click();
  };
  assetChoose.addEventListener('click', (event) => {
    event.stopPropagation();
    chooseAssets();
  });
  assetPicker.addEventListener('click', chooseAssets);
  assetPicker.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    chooseAssets();
  });
  assetPicker.addEventListener('dragover', (event) => {
    if (assetInput.disabled) return;
    event.preventDefault();
    assetPicker.classList.add('dragging');
  });
  assetPicker.addEventListener('dragleave', () => assetPicker.classList.remove('dragging'));
  assetPicker.addEventListener('drop', (event) => {
    assetPicker.classList.remove('dragging');
    if (assetInput.disabled) return;
    event.preventDefault();
    addAssetFiles(event.dataTransfer ? [...event.dataTransfer.files] : []);
  });
  assetInput.addEventListener('change', () => {
    addAssetFiles([...(assetInput.files ?? [])]);
    assetInput.value = '';
  });
  assetList.addEventListener('click', async (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-asset-index]') : null;
    if (!button || !selected || busy || selected.canRevert) return;
    const index = Number(button.dataset.assetIndex);
    const assets = assetsFor(selected.id);
    const entry = assets[index];
    if (!entry) return;
    if (entry.uploaded) {
      try {
        await discardUploadedAssets(selected.id, devMode ? appendDevLog : undefined);
      } catch (error) {
        return setMessage(error instanceof Error ? error.message : String(error), true);
      }
    }
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    assets.splice(index, 1);
    if (!assets.length) pendingAssets.delete(selected.id);
    renderAssets();
  });

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
    const sectionId = selected.id;
    const runStartedAt = performance.now();
    let previewApplied = false;
    const onLog: DevLogger | undefined = devMode ? appendDevLog : undefined;
    onLog?.({
      type: 'client',
      phase: 'preview-run-start',
      timestamp: Date.now(),
      message: 'Started a complete Flock preview run.',
      details: { sectionId, instruction, instructionCharacters: instruction.length, assetCount: assetsFor(sectionId).length },
    });
    setBusy(true);
    setMessage('Compiling section intelligence…');
    try {
      const uploadedAssets = await uploadAssets(sectionId, onLog);
      const effectiveInstruction = uploadedAssets.length
        ? [
            instruction,
            'Use the uploaded asset or assets as requested. Reference their exact local public URLs; do not invent imports or remote URLs.',
            ...uploadedAssets.map((asset) => `- ${asset.filename}: ${asset.publicUrl}`),
          ].join('\n\n')
        : instruction;
      const contextStartedAt = performance.now();
      onLog?.({
        type: 'client',
        phase: 'context-start',
        timestamp: Date.now(),
        message: 'Requesting the section intelligence packet.',
        details: { sectionId },
      });
      const packet = await jsonFetch<FlockSectionPacket>(sectionEndpoint(sectionId, 'context'), undefined, onLog);
      onLog?.({
        type: 'client',
        phase: 'context-finish',
        timestamp: Date.now(),
        durationMs: Math.round(performance.now() - contextStartedAt),
        message: 'Received the section intelligence packet.',
        details: {
          sectionId,
          sourceCharacters: packet.section.source.length,
          baseHash: packet.section.baseHash,
          packetCharacters: JSON.stringify(packet).length,
        },
      });

      const onStatus = (value: string): void => {
        setMessage(value);
        onLog?.({
          type: 'client',
          phase: 'status',
          timestamp: Date.now(),
          message: value,
        });
      };
      let local: typeof import('./inference/local.js') | undefined;
      const apiInference = async <T>(action: 'interpret' | 'generate' | 'repair', extra: Record<string, unknown> = {}): Promise<T> => {
        onStatus(action === 'interpret' ? 'Understanding the request…' : action === 'repair' ? 'Repairing…' : 'Writing the replacement…');
        const response = await jsonFetch<{ result: T; model: string }>(sectionEndpoint(sectionId, 'infer'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, instruction: effectiveInstruction, ...extra }),
        }, onLog);
        onLog?.({ type: 'client', phase: 'openai-result', timestamp: Date.now(), message: `OpenAI ${action} completed.`, details: { model: response.model } });
        return response.result;
      };

      if (provider === 'local') {
        const importStartedAt = performance.now();
        onLog?.({ type: 'client', phase: 'inference-import-start', timestamp: Date.now(), message: 'Dynamically importing the browser-local inference module.' });
        local = await import('./inference/local.js');
        onLog?.({ type: 'client', phase: 'inference-import-finish', timestamp: Date.now(), durationMs: Math.round(performance.now() - importStartedAt), message: 'The browser-local inference module imported successfully.', details: { exports: Object.keys(local).sort() } });
      }

      const intent: FlockEditIntent = provider === 'local'
        ? await local!.interpretInstruction(packet, effectiveInstruction, onStatus, onLog)
        : await apiInference<FlockEditIntent>('interpret');
      if (uploadedAssets.length) {
        intent.mayChangeAssets = true;
        if (!intent.goals.includes('Use uploaded assets')) intent.goals.push('Use uploaded assets');
      }
      onLog?.({
        type: 'client',
        phase: 'intent-ready',
        timestamp: Date.now(),
        durationMs: Math.round(performance.now() - runStartedAt),
        message: 'Intent classification completed.',
        details: { intent },
      });
      let candidate = provider === 'local'
        ? await local!.generateCandidate(packet, effectiveInstruction, intent, onStatus, onLog)
        : await apiInference<string>('generate', { intent });
      onLog?.({
        type: 'client',
        phase: 'candidate-ready',
        timestamp: Date.now(),
        durationMs: Math.round(performance.now() - runStartedAt),
        message: 'A complete candidate section is ready for validation.',
        details: { candidateCharacters: candidate.length },
      });
      let repaired = false;

      while (true) {
        const validationStartedAt = performance.now();
        onLog?.({
          type: 'validation',
          phase: 'start',
          timestamp: Date.now(),
          message: 'Submitting the candidate to the local Astro validation bridge.',
          details: {
            attempt: repaired ? 'repair' : 'initial',
            baseHash: packet.section.baseHash,
            candidateCharacters: candidate.length,
          },
        });
        try {
          const body = JSON.stringify({ baseHash: packet.section.baseHash, source: candidate, intent });
          const result = await jsonFetch<{ section: FlockSectionSummary }>(sectionEndpoint(sectionId, 'preview'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          }, onLog);
          onLog?.({
            type: 'validation',
            phase: 'passed',
            timestamp: Date.now(),
            durationMs: Math.round(performance.now() - validationStartedAt),
            message: 'The candidate passed validation and was written for preview.',
          });
          previewApplied = true;
          updateSection(result.section);
          setMessage('Preview applied. Keep it or revert it.');
          onLog?.({
            type: 'client',
            phase: 'preview-run-finish',
            timestamp: Date.now(),
            durationMs: Math.round(performance.now() - runStartedAt),
            message: 'The complete Flock preview run finished successfully.',
            details: { repaired },
          });
          break;
        } catch (error) {
          const failures = error instanceof ApiError ? error.failures : [];
          onLog?.({
            type: 'validation',
            phase: 'failed',
            timestamp: Date.now(),
            durationMs: Math.round(performance.now() - validationStartedAt),
            message: 'The candidate failed validation.',
            failures,
            details: {
              code: error instanceof ApiError ? error.code : undefined,
              error: error instanceof Error ? error.stack || error.message : String(error),
            },
          });
          if (error instanceof ApiError && error.code === 'candidate_invalid' && error.failures.length && !repaired) {
            repaired = true;
            onLog?.({
              type: 'client',
              phase: 'repair-start',
              timestamp: Date.now(),
              message: 'Starting the single constrained repair attempt.',
              failures: error.failures,
            });
            candidate = provider === 'local'
              ? await local!.repairCandidate(packet, effectiveInstruction, intent, candidate, error.failures, onStatus, onLog)
              : await apiInference<string>('repair', { intent, candidate, failures: error.failures });
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      if (!previewApplied) {
        try {
          await discardUploadedAssets(sectionId, onLog);
        } catch (cleanupError) {
          onLog?.({
            type: 'client',
            phase: 'asset-cleanup-error',
            timestamp: Date.now(),
            message: 'Could not discard staged assets after the failed preview run.',
            error: cleanupError instanceof Error ? cleanupError.stack || cleanupError.message : String(cleanupError),
          });
        }
      }
      onLog?.({
        type: 'client',
        phase: 'preview-run-error',
        timestamp: Date.now(),
        durationMs: Math.round(performance.now() - runStartedAt),
        message: 'The complete Flock preview run failed.',
        error: error instanceof Error ? error.stack || error.message : String(error),
        details: {
          code: error instanceof ApiError ? error.code : undefined,
          failures: error instanceof ApiError ? error.failures : undefined,
        },
      });
      const details = error instanceof ApiError && error.failures.length ? `\n${error.failures.join('\n')}` : '';
      setMessage(`${error instanceof Error ? error.message : String(error)}${details}`, true);
    } finally {
      setBusy(false);
      onLog?.({
        type: 'client',
        phase: 'preview-run-settled',
        timestamp: Date.now(),
        durationMs: Math.round(performance.now() - runStartedAt),
        message: 'The preview run promise settled and the editing controls were re-enabled.',
      });
    }
  });


  keep.addEventListener('click', async () => {
    if (!selected || busy) return;
    const sectionId = selected.id;
    setBusy(true);
    setMessage('Keeping preview…');
    try {
      const result = await jsonFetch<{ section: FlockSectionSummary }>(sectionEndpoint(sectionId, 'keep'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }, devMode ? appendDevLog : undefined);
      updateSection(result.section);
      clearAssets(sectionId);
      setMessage('Kept. Asset and section changes are now part of the project.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBusy(false);
    }
  });

  revert.addEventListener('click', async () => {
    if (!selected || busy) return;
    const sectionId = selected.id;
    setBusy(true);
    setMessage('Reverting preview…');
    try {
      const result = await jsonFetch<{ section: FlockSectionSummary }>(sectionEndpoint(sectionId, 'revert'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }, devMode ? appendDevLog : undefined);
      updateSection(result.section);
      clearAssets(sectionId);
      setMessage('Preview and staged assets reverted.');
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
      await local.removeLocalModel(devMode ? appendDevLog : undefined);
      setMessage('Local model removed from this device.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBusy(false);
    }
  });

  renderProvider();
  setDevMode(devMode);
  if (sessionStorage.getItem(OPEN_KEY) === 'true') void open();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
