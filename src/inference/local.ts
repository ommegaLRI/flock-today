import {
  CreateWebWorkerMLCEngine,
  deleteModelAllInfoInCache,
  type InitProgressReport,
  type WebWorkerMLCEngine,
} from '@mlc-ai/web-llm';
// Vite turns this explicit worker import into a worker constructor. This is
// more reliable than a runtime-relative Worker URL when Flock is npm-linked
// from outside the consuming Astro project's root.
// @ts-ignore Vite handles the ?worker query in the consuming dev server.
import FlockModelWorker from './worker.js?worker';
import type { FlockEditIntent, FlockSectionPacket } from '../types.js';

const COMPACT_MODEL = 'Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC';
const STANDARD_MODEL = 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC';
const DIAGNOSTIC_HEARTBEAT_MS = 5_000;
const INTENT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    goals: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    mayChangeContent: { type: 'boolean' },
    mayChangeLinks: { type: 'boolean' },
    mayChangeAssets: { type: 'boolean' },
    mayChangeStructure: { type: 'boolean' },
  },
  required: ['goals', 'mayChangeContent', 'mayChangeLinks', 'mayChangeAssets', 'mayChangeStructure'],
  additionalProperties: false,
});

export type LocalAIStatus = (message: string) => void;
export type LocalAICall = 'interpret' | 'generate' | 'repair';
export type LocalAILogType = 'environment' | 'webgpu' | 'model' | 'worker' | 'engine' | 'call' | 'stream' | 'cache';
export interface LocalAILogEvent {
  type: LocalAILogType;
  phase: string;
  timestamp: number;
  message: string;
  durationMs?: number;
  call?: LocalAICall;
  model?: string;
  details?: unknown;
  input?: unknown;
  output?: unknown;
  error?: string;
}
export type LocalAILog = (event: LocalAILogEvent) => void;


interface NavigatorDiagnostics extends Navigator {
  deviceMemory?: number;
  gpu?: {
    requestAdapter(): Promise<GPUAdapterLike | null>;
  };
  connection?: {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
  };
}

interface GPUAdapterLike {
  limits: {
    maxStorageBufferBindingSize: number;
    maxBufferSize?: number;
    maxComputeWorkgroupStorageSize?: number;
  };
  info?: Record<string, unknown>;
}

interface IntentCompletionResponse {
  choices: Array<{ message: { content?: string | null } }>;
  usage?: unknown;
}

interface StreamCompletionChunk {
  choices: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
}

let engine: WebWorkerMLCEngine | undefined;
let worker: Worker | undefined;
let loading: Promise<WebWorkerMLCEngine> | undefined;
let loadedModel: string | undefined;
let environmentLogged = false;

function emitLog(onLog: LocalAILog | undefined, event: LocalAILogEvent): void {
  try {
    onLog?.(event);
  } catch {
    // Development diagnostics must never interrupt local inference.
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
}

function compactPacket(packet: FlockSectionPacket): Omit<FlockSectionPacket, 'section'> & {
  section: Omit<FlockSectionPacket['section'], 'source'>;
} {
  const { source: _source, ...section } = packet.section;
  return { ...packet, section };
}

function startHeartbeat(
  onLog: LocalAILog | undefined,
  event: Omit<LocalAILogEvent, 'timestamp' | 'durationMs' | 'details'>,
  details?: () => Record<string, unknown>,
): () => void {
  if (!onLog) return () => undefined;
  const startedAt = performance.now();
  let count = 0;
  const timer = globalThis.setInterval(() => {
    count += 1;
    emitLog(onLog, {
      ...event,
      timestamp: Date.now(),
      durationMs: Math.round(performance.now() - startedAt),
      details: {
        heartbeat: count,
        elapsedMs: Math.round(performance.now() - startedAt),
        visibilityState: typeof document === 'undefined' ? undefined : document.visibilityState,
        online: navigator.onLine,
        ...details?.(),
      },
    });
  }, DIAGNOSTIC_HEARTBEAT_MS);
  return () => globalThis.clearInterval(timer);
}

async function logEnvironment(onLog?: LocalAILog): Promise<void> {
  if (!onLog || environmentLogged) return;
  environmentLogged = true;
  const currentNavigator = navigator as NavigatorDiagnostics;
  emitLog(onLog, {
    type: 'environment',
    phase: 'snapshot',
    timestamp: Date.now(),
    message: 'Captured the browser environment before local inference.',
    details: {
      userAgent: currentNavigator.userAgent,
      platform: currentNavigator.platform,
      language: currentNavigator.language,
      online: currentNavigator.onLine,
      secureContext: globalThis.isSecureContext,
      crossOriginIsolated: globalThis.crossOriginIsolated,
      hardwareConcurrency: currentNavigator.hardwareConcurrency,
      deviceMemoryGiB: currentNavigator.deviceMemory ?? 'unreported',
      webgpuAvailable: Boolean(currentNavigator.gpu),
      visibilityState: typeof document === 'undefined' ? undefined : document.visibilityState,
      connection: currentNavigator.connection ? {
        effectiveType: currentNavigator.connection.effectiveType,
        downlinkMbps: currentNavigator.connection.downlink,
        rttMs: currentNavigator.connection.rtt,
        saveData: currentNavigator.connection.saveData,
      } : 'unreported',
    },
  });

  try {
    const estimate = await currentNavigator.storage?.estimate();
    emitLog(onLog, {
      type: 'environment',
      phase: 'storage',
      timestamp: Date.now(),
      message: 'Read browser storage estimates.',
      details: {
        usageBytes: estimate?.usage,
        quotaBytes: estimate?.quota,
        availableBytes: typeof estimate?.quota === 'number' && typeof estimate.usage === 'number'
          ? estimate.quota - estimate.usage
          : undefined,
      },
    });
  } catch (error) {
    emitLog(onLog, {
      type: 'environment',
      phase: 'storage-error',
      timestamp: Date.now(),
      message: 'Browser storage estimates could not be read.',
      error: errorMessage(error),
    });
  }

  try {
    const cacheNames = typeof caches === 'undefined' ? [] : await caches.keys();
    emitLog(onLog, {
      type: 'cache',
      phase: 'snapshot',
      timestamp: Date.now(),
      message: 'Listed browser Cache Storage entries before model loading.',
      details: { cacheNames },
    });
  } catch (error) {
    emitLog(onLog, {
      type: 'cache',
      phase: 'snapshot-error',
      timestamp: Date.now(),
      message: 'Cache Storage entries could not be listed.',
      error: errorMessage(error),
    });
  }
}

async function chooseModel(onLog?: LocalAILog): Promise<string> {
  void logEnvironment(onLog);
  const currentNavigator = navigator as NavigatorDiagnostics;
  const gpu = currentNavigator.gpu;
  emitLog(onLog, {
    type: 'webgpu',
    phase: 'check',
    timestamp: Date.now(),
    message: gpu ? 'WebGPU is exposed by this browser.' : 'WebGPU is not exposed by this browser.',
  });
  if (!gpu) throw new Error('Local AI requires a browser with WebGPU support.');

  const adapterStartedAt = performance.now();
  emitLog(onLog, {
    type: 'webgpu',
    phase: 'request-adapter-start',
    timestamp: Date.now(),
    message: 'Requesting the browser WebGPU adapter.',
  });
  const stopAdapterHeartbeat = startHeartbeat(onLog, {
    type: 'webgpu',
    phase: 'request-adapter-waiting',
    message: 'Still waiting for the browser to return a WebGPU adapter.',
  });
  let adapter: GPUAdapterLike | null;
  try {
    adapter = await gpu.requestAdapter();
  } finally {
    stopAdapterHeartbeat();
  }
  if (!adapter) {
    emitLog(onLog, {
      type: 'webgpu',
      phase: 'request-adapter-empty',
      timestamp: Date.now(),
      durationMs: Math.round(performance.now() - adapterStartedAt),
      message: 'The browser returned no WebGPU adapter.',
    });
    throw new Error('No WebGPU adapter is available on this device.');
  }
  emitLog(onLog, {
    type: 'webgpu',
    phase: 'request-adapter-finish',
    timestamp: Date.now(),
    durationMs: Math.round(performance.now() - adapterStartedAt),
    message: 'The browser returned a WebGPU adapter.',
    details: {
      adapterInfo: adapter.info,
      limits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
        maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
      },
    },
  });

  const deviceMemory = currentNavigator.deviceMemory;
  const model = typeof deviceMemory === 'number' && deviceMemory >= 8 ? STANDARD_MODEL : COMPACT_MODEL;
  emitLog(onLog, {
    type: 'model',
    phase: 'select',
    timestamp: Date.now(),
    message: `Selected the ${model === COMPACT_MODEL ? 'compact' : 'standard'} local model.`,
    model,
    details: {
      deviceMemoryGiB: deviceMemory ?? 'unreported',
      selectionRule: 'Use the standard model when reported device memory is at least 8 GiB; otherwise use compact.',
    },
  });
  return model;
}

function workerErrorDetails(event: ErrorEvent): Record<string, unknown> {
  return {
    message: event.message,
    filename: event.filename,
    line: event.lineno,
    column: event.colno,
    error: event.error ? errorMessage(event.error) : undefined,
  };
}

function workerResourceSnapshot(): Array<Record<string, unknown>> {
  return performance.getEntriesByType('resource')
    .filter((entry) => /worker|web-llm|local\.js|@fs|@id/i.test(entry.name))
    .slice(-20)
    .map((entry) => {
      const resource = entry as PerformanceResourceTiming;
      return {
        name: resource.name,
        initiatorType: resource.initiatorType,
        durationMs: Math.round(resource.duration),
        transferSize: resource.transferSize,
        encodedBodySize: resource.encodedBodySize,
        decodedBodySize: resource.decodedBodySize,
      };
    });
}

function attachWorkerDiagnostics(currentWorker: Worker, onLog?: LocalAILog): Promise<never> {
  let settled = false;
  let rejectFailure: (reason: Error) => void = () => undefined;
  const failure = new Promise<never>((_resolve, reject) => {
    rejectFailure = reject;
  });

  const fail = (error: Error): void => {
    if (settled) return;
    settled = true;
    rejectFailure(error);
  };

  currentWorker.addEventListener('error', (event) => {
    emitLog(onLog, {
      type: 'worker',
      phase: 'error-event',
      timestamp: Date.now(),
      message: 'The model worker emitted an error event before WebLLM initialization completed.',
      error: event.message || 'unknown worker error',
      details: {
        ...workerErrorDetails(event),
        pageUrl: location.href,
        importerUrl: import.meta.url,
        resources: workerResourceSnapshot(),
        hint: 'The worker is loaded through Vite\'s explicit ?worker import. Check the browser Network panel for the failing worker or dependency request if filename is blank.',
      },
    });
    fail(new Error(`Model worker failed: ${event.message || 'unknown worker error'}`));
  });

  currentWorker.addEventListener('messageerror', (event) => {
    emitLog(onLog, {
      type: 'worker',
      phase: 'message-error-event',
      timestamp: Date.now(),
      message: 'The browser could not deserialize a message from the model worker.',
      details: {
        dataType: typeof event.data,
        resources: workerResourceSnapshot(),
      },
    });
    fail(new Error('Model worker failed because a worker message could not be deserialized.'));
  });

  return failure;
}

async function getEngine(onStatus: LocalAIStatus, onLog?: LocalAILog): Promise<WebWorkerMLCEngine> {
  if (engine) {
    emitLog(onLog, {
      type: 'model',
      phase: 'reuse',
      timestamp: Date.now(),
      message: 'Reusing the loaded local model.',
      model: loadedModel,
    });
    return engine;
  }
  if (loading) {
    emitLog(onLog, {
      type: 'engine',
      phase: 'join-existing-load',
      timestamp: Date.now(),
      message: 'Another caller is already loading the local model; waiting for that load.',
      model: loadedModel,
    });
    return loading;
  }

  loading = (async () => {
    loadedModel = await chooseModel(onLog);
    onStatus(`Preparing private on-device AI (${loadedModel === COMPACT_MODEL ? 'compact' : 'standard'})…`);
    emitLog(onLog, {
      type: 'worker',
      phase: 'construct-start',
      timestamp: Date.now(),
      message: 'Constructing the Vite-managed WebLLM worker.',
      model: loadedModel,
      details: {
        workerSpecifier: './worker.js?worker',
        importerUrl: import.meta.url,
        strategy: 'Vite explicit worker import',
      },
    });

    const workerStartedAt = performance.now();
    const currentWorker = new FlockModelWorker({ name: 'flock-local-ai' });
    worker = currentWorker;
    emitLog(onLog, {
      type: 'worker',
      phase: 'construct-finish',
      timestamp: Date.now(),
      durationMs: Math.round(performance.now() - workerStartedAt),
      message: 'The browser accepted the Vite-managed model worker construction request.',
      model: loadedModel,
      details: {
        workerSpecifier: './worker.js?worker',
        importerUrl: import.meta.url,
        strategy: 'Vite explicit worker import',
      },
    });
    const workerFailure = attachWorkerDiagnostics(currentWorker, onLog);

    let progressCount = 0;
    let lastProgressAt: number | undefined;
    let lastProgressText = '';
    let lastProgress = 0;
    const engineStartedAt = performance.now();
    emitLog(onLog, {
      type: 'engine',
      phase: 'initialize-start',
      timestamp: Date.now(),
      message: 'Calling CreateWebWorkerMLCEngine.',
      model: loadedModel,
      details: { workerSpecifier: './worker.js?worker', importerUrl: import.meta.url, strategy: 'Vite explicit worker import' },
    });
    const stopEngineHeartbeat = startHeartbeat(onLog, {
      type: 'engine',
      phase: 'initialize-waiting',
      message: 'CreateWebWorkerMLCEngine has not resolved yet.',
      model: loadedModel,
    }, () => ({
      progressEvents: progressCount,
      lastProgress,
      lastProgressText,
      msSinceLastProgress: lastProgressAt === undefined ? undefined : Date.now() - lastProgressAt,
      hint: progressCount === 0
        ? 'No WebLLM initialization progress has arrived yet. Check the worker events immediately before this heartbeat.'
        : undefined,
    }));

    try {
      const enginePromise = CreateWebWorkerMLCEngine(currentWorker, loadedModel, {
        initProgressCallback(progress: InitProgressReport) {
          progressCount += 1;
          lastProgressAt = Date.now();
          lastProgressText = progress.text || 'Loading local AI';
          lastProgress = progress.progress;
          const percent = Math.max(0, Math.min(100, Math.round(progress.progress * 100)));
          onStatus(`${lastProgressText}${percent ? ` · ${percent}%` : ''}`);
          emitLog(onLog, {
            type: 'engine',
            phase: 'initialize-progress',
            timestamp: Date.now(),
            durationMs: Math.round(performance.now() - engineStartedAt),
            message: lastProgressText,
            model: loadedModel,
            details: {
              progressEvent: progressCount,
              progress: progress.progress,
              percent,
              text: progress.text,
            },
          });
        },
      });
      engine = await Promise.race([enginePromise, workerFailure]);
    } finally {
      stopEngineHeartbeat();
    }

    onStatus('Local AI ready. Stored on this device.');
    emitLog(onLog, {
      type: 'engine',
      phase: 'initialize-finish',
      timestamp: Date.now(),
      durationMs: Math.round(performance.now() - engineStartedAt),
      message: 'CreateWebWorkerMLCEngine resolved successfully.',
      model: loadedModel,
      details: { progressEvents: progressCount },
    });
    emitLog(onLog, {
      type: 'model',
      phase: 'ready',
      timestamp: Date.now(),
      message: 'Local model is ready.',
      model: loadedModel,
    });
    return engine;
  })();

  try {
    return await loading;
  } catch (error) {
    emitLog(onLog, {
      type: 'model',
      phase: 'error',
      timestamp: Date.now(),
      message: 'Local model failed to load.',
      model: loadedModel,
      error: errorMessage(error),
    });
    worker?.terminate();
    worker = undefined;
    engine = undefined;
    loadedModel = undefined;
    throw error;
  } finally {
    loading = undefined;
  }
}

function explicitlyAuthorizes(instruction: string, kind: 'content' | 'links' | 'assets'): boolean {
  const action = String.raw`(?:change|replace|rewrite|edit|remove|delete|add|update|set|rename|use|point)`;
  const terms = {
    content: String.raw`(?:copy|text|heading|headline|title|subtitle|eyebrow|label|caption|body|content|wording|words?)`,
    links: String.raw`(?:link|url|href|destination|route)`,
    assets: String.raw`(?:image|photo|picture|video|icon|logo|asset|media|poster|background)`,
  }[kind];
  const normalized = instruction.toLowerCase();
  return new RegExp(`\\b${action}\\b[\\s\\S]{0,60}\\b${terms}\\b|\\b${terms}\\b[\\s\\S]{0,60}\\b${action}\\b`, 'i').test(normalized)
    || (kind === 'content' && /\b(?:say|read)\s+["“'`]/i.test(instruction))
    || (kind === 'links' && /https?:\/\//i.test(instruction));
}

function messageText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('The local model returned an empty result.');
  return value.trim();
}

function stripCodeFence(source: string): string {
  const trimmed = source.trim();
  const match = trimmed.match(/^```(?:astro|html|tsx|jsx)?\s*\n([\s\S]*?)\n```$/i);
  return (match?.[1] ?? trimmed).trim();
}

export async function interpretInstruction(
  packet: FlockSectionPacket,
  instruction: string,
  onStatus: LocalAIStatus,
  onLog?: LocalAILog,
): Promise<FlockEditIntent> {
  const startedAt = performance.now();
  const messages = [
    {
      role: 'system' as const,
      content: 'You classify one website section edit. Return only JSON. Be conservative: visual requests do not authorize changing copy, links, or assets.',
    },
    {
      role: 'user' as const,
      content: `Instruction:\n${instruction}\n\nSection context:\n${JSON.stringify(compactPacket(packet))}`,
    },
  ];
  emitLog(onLog, {
    type: 'call',
    phase: 'start',
    timestamp: Date.now(),
    call: 'interpret',
    message: 'Started the intent-classification call.',
    input: {
      messages,
      promptCharacters: messages.reduce((total, message) => total + message.content.length, 0),
      options: {
        responseFormat: { type: 'json_object', schema: JSON.parse(INTENT_SCHEMA) },
        temperature: 0.1,
        maxTokens: 300,
      },
    },
  });
  try {
    const local = await getEngine(onStatus, onLog);
    emitLog(onLog, {
      type: 'call',
      phase: 'engine-ready',
      timestamp: Date.now(),
      durationMs: Math.round(performance.now() - startedAt),
      call: 'interpret',
      message: 'The intent call has a ready WebLLM engine.',
      model: loadedModel,
    });
    onStatus('Understanding the requested change…');
    emitLog(onLog, {
      type: 'call',
      phase: 'request-start',
      timestamp: Date.now(),
      call: 'interpret',
      message: 'Submitting the non-streaming intent request to WebLLM.',
      model: loadedModel,
    });
    const stopCallHeartbeat = startHeartbeat(onLog, {
      type: 'call',
      phase: 'request-waiting',
      call: 'interpret',
      message: 'The intent request has not returned yet.',
      model: loadedModel,
    });
    let response: IntentCompletionResponse;
    try {
      response = await local.chat.completions.create({
        messages,
        response_format: { type: 'json_object', schema: INTENT_SCHEMA },
        temperature: 0.1,
        max_tokens: 300,
      }) as IntentCompletionResponse;
    } finally {
      stopCallHeartbeat();
    }
    emitLog(onLog, {
      type: 'call',
      phase: 'response-received',
      timestamp: Date.now(),
      durationMs: Math.round(performance.now() - startedAt),
      call: 'interpret',
      message: 'WebLLM returned the intent response object.',
      model: loadedModel,
      details: {
        choiceCount: Array.isArray(response.choices) ? response.choices.length : undefined,
        usage: response.usage,
      },
    });
    const raw = messageText(response.choices[0]?.message.content);
    const parsed = JSON.parse(raw) as FlockEditIntent;
    const effective: FlockEditIntent = {
      goals: Array.isArray(parsed.goals) ? parsed.goals.filter((goal): goal is string => typeof goal === 'string').slice(0, 5) : [],
      mayChangeContent: parsed.mayChangeContent === true && explicitlyAuthorizes(instruction, 'content'),
      mayChangeLinks: parsed.mayChangeLinks === true && explicitlyAuthorizes(instruction, 'links'),
      mayChangeAssets: parsed.mayChangeAssets === true && explicitlyAuthorizes(instruction, 'assets'),
      mayChangeStructure: parsed.mayChangeStructure === true,
    };
    emitLog(onLog, {
      type: 'call',
      phase: 'finish',
      timestamp: Date.now(),
      call: 'interpret',
      durationMs: Math.round(performance.now() - startedAt),
      message: 'Finished intent classification and deterministic authorization.',
      output: { raw, parsed, effective },
    });
    return effective;
  } catch (error) {
    emitLog(onLog, {
      type: 'call',
      phase: 'error',
      timestamp: Date.now(),
      call: 'interpret',
      durationMs: Math.round(performance.now() - startedAt),
      message: 'The intent-classification call failed.',
      error: errorMessage(error),
    });
    throw error;
  }
}

async function streamSource(
  call: 'generate' | 'repair',
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  onStatus: LocalAIStatus,
  onLog?: LocalAILog,
): Promise<string> {
  const startedAt = performance.now();
  emitLog(onLog, {
    type: 'call',
    phase: 'start',
    timestamp: Date.now(),
    call,
    message: `Started the ${call} model call.`,
    input: {
      messages,
      promptCharacters: messages.reduce((total, message) => total + message.content.length, 0),
      options: { stream: true, temperature: 0.15, maxTokens: 8_000 },
    },
  });
  try {
    const local = await getEngine(onStatus, onLog);
    emitLog(onLog, {
      type: 'call',
      phase: 'engine-ready',
      timestamp: Date.now(),
      durationMs: Math.round(performance.now() - startedAt),
      call,
      message: `The ${call} call has a ready WebLLM engine.`,
      model: loadedModel,
    });
    emitLog(onLog, {
      type: 'call',
      phase: 'request-start',
      timestamp: Date.now(),
      call,
      message: `Submitting the streaming ${call} request to WebLLM.`,
      model: loadedModel,
    });
    const stopRequestHeartbeat = startHeartbeat(onLog, {
      type: 'call',
      phase: 'request-waiting',
      call,
      message: `WebLLM has not returned the ${call} stream handle yet.`,
      model: loadedModel,
    });
    let chunks: AsyncIterable<StreamCompletionChunk>;
    try {
      chunks = await local.chat.completions.create({
        messages,
        stream: true,
        temperature: 0.15,
        max_tokens: 8_000,
      }) as AsyncIterable<StreamCompletionChunk>;
    } finally {
      stopRequestHeartbeat();
    }
    emitLog(onLog, {
      type: 'stream',
      phase: 'open',
      timestamp: Date.now(),
      durationMs: Math.round(performance.now() - startedAt),
      call,
      message: `WebLLM returned the ${call} stream handle.`,
      model: loadedModel,
    });

    let source = '';
    let chunkCount = 0;
    let lastChunkAt: number | undefined;
    const stopStreamHeartbeat = startHeartbeat(onLog, {
      type: 'stream',
      phase: 'waiting',
      call,
      message: `The ${call} stream is open but no new chunk has arrived.`,
      model: loadedModel,
    }, () => ({
      chunks: chunkCount,
      characters: source.length,
      msSinceLastChunk: lastChunkAt === undefined ? undefined : Date.now() - lastChunkAt,
    }));
    try {
      for await (const chunk of chunks) {
        chunkCount += 1;
        lastChunkAt = Date.now();
        const choice = chunk.choices[0];
        const delta = choice?.delta?.content ?? '';
        source += delta;
        emitLog(onLog, {
          type: 'stream',
          phase: 'chunk',
          timestamp: Date.now(),
          durationMs: Math.round(performance.now() - startedAt),
          call,
          message: `Received ${call} stream chunk ${chunkCount}.`,
          model: loadedModel,
          details: {
            chunk: chunkCount,
            deltaCharacters: delta.length,
            totalCharacters: source.length,
            finishReason: choice?.finish_reason,
            deltaPreview: delta.slice(0, 240),
          },
        });
        if (source.length % 500 < Math.max(40, delta.length)) {
          onStatus(`Writing section… ${source.length.toLocaleString()} characters`);
        }
      }
    } finally {
      stopStreamHeartbeat();
    }
    const candidate = stripCodeFence(source);
    emitLog(onLog, {
      type: 'stream',
      phase: 'close',
      timestamp: Date.now(),
      durationMs: Math.round(performance.now() - startedAt),
      call,
      message: `The ${call} stream completed.`,
      model: loadedModel,
      details: { chunks: chunkCount, rawCharacters: source.length, candidateCharacters: candidate.length },
    });
    emitLog(onLog, {
      type: 'call',
      phase: 'finish',
      timestamp: Date.now(),
      call,
      durationMs: Math.round(performance.now() - startedAt),
      message: `Finished the ${call} model call.`,
      output: source === candidate
        ? { candidate, characters: candidate.length, chunks: chunkCount }
        : { raw: source, candidate, characters: candidate.length, chunks: chunkCount, strippedCodeFence: true },
    });
    return candidate;
  } catch (error) {
    emitLog(onLog, {
      type: 'call',
      phase: 'error',
      timestamp: Date.now(),
      call,
      durationMs: Math.round(performance.now() - startedAt),
      message: `The ${call} model call failed.`,
      error: errorMessage(error),
    });
    throw error;
  }
}

export async function generateCandidate(
  packet: FlockSectionPacket,
  instruction: string,
  intent: FlockEditIntent,
  onStatus: LocalAIStatus,
  onLog?: LocalAILog,
): Promise<string> {
  onStatus('Writing the replacement section…');
  return streamSource('generate', [
    {
      role: 'system',
      content: [
        'You are Flock, a private in-browser editor for one Astro section.',
        'Return exactly the complete replacement .astro file and nothing else.',
        'Preserve existing imports, project conventions, text, links, assets, accessibility identities, and data-stitch attributes unless explicitly authorized.',
        'Use existing Astro and Tailwind patterns. Do not add dependencies, remote scripts, markdown fences, or explanations.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `OWNER INSTRUCTION:\n${instruction}`,
        `EDIT INTENT:\n${JSON.stringify(intent)}`,
        `SECTION INTELLIGENCE:\n${JSON.stringify(compactPacket(packet))}`,
        `CURRENT ASTRO SOURCE:\n${packet.section.source}`,
      ].join('\n\n'),
    },
  ], onStatus, onLog);
}

export async function repairCandidate(
  packet: FlockSectionPacket,
  instruction: string,
  intent: FlockEditIntent,
  candidate: string,
  failures: string[],
  onStatus: LocalAIStatus,
  onLog?: LocalAILog,
): Promise<string> {
  onStatus('Repairing the candidate once…');
  return streamSource('repair', [
    {
      role: 'system',
      content: 'Repair one Astro section. Return exactly the complete corrected .astro file. Do not explain, add dependencies, or add external scripts.',
    },
    {
      role: 'user',
      content: [
        `OWNER INSTRUCTION:\n${instruction}`,
        `EDIT INTENT:\n${JSON.stringify(intent)}`,
        `VALIDATION FAILURES:\n${failures.map((failure) => `- ${failure}`).join('\n')}`,
        `SECTION INTELLIGENCE:\n${JSON.stringify(compactPacket(packet))}`,
        `ORIGINAL SOURCE:\n${packet.section.source}`,
        `FAILED CANDIDATE:\n${candidate}`,
      ].join('\n\n'),
    },
  ], onStatus, onLog);
}

export async function removeLocalModel(onLog?: LocalAILog): Promise<void> {
  const model = loadedModel;
  emitLog(onLog, {
    type: 'model',
    phase: 'unload-start',
    timestamp: Date.now(),
    message: 'Unloading the local model and terminating its worker.',
    model,
  });
  try {
    await engine?.unload();
    emitLog(onLog, {
      type: 'model',
      phase: 'unload-finish',
      timestamp: Date.now(),
      message: 'The local engine unloaded successfully.',
      model,
    });
  } catch (error) {
    emitLog(onLog, {
      type: 'model',
      phase: 'unload-error',
      timestamp: Date.now(),
      message: 'The local engine reported an error while unloading.',
      model,
      error: errorMessage(error),
    });
  }
  worker?.terminate();
  engine = undefined;
  worker = undefined;
  loading = undefined;
  loadedModel = undefined;

  for (const cachedModel of [COMPACT_MODEL, STANDARD_MODEL]) {
    const startedAt = performance.now();
    emitLog(onLog, {
      type: 'cache',
      phase: 'delete-start',
      timestamp: Date.now(),
      message: 'Deleting cached model information.',
      model: cachedModel,
    });
    try {
      await deleteModelAllInfoInCache(cachedModel);
      emitLog(onLog, {
        type: 'cache',
        phase: 'delete-finish',
        timestamp: Date.now(),
        durationMs: Math.round(performance.now() - startedAt),
        message: 'Deleted cached model information.',
        model: cachedModel,
      });
    } catch (error) {
      emitLog(onLog, {
        type: 'cache',
        phase: 'delete-error',
        timestamp: Date.now(),
        durationMs: Math.round(performance.now() - startedAt),
        message: 'Cached model information could not be deleted.',
        model: cachedModel,
        error: errorMessage(error),
      });
    }
  }
}
