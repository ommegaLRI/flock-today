import {
  CreateWebWorkerMLCEngine,
  deleteModelAllInfoInCache,
  type InitProgressReport,
  type WebWorkerMLCEngine,
} from '@mlc-ai/web-llm';
import type { FlockEditIntent, FlockSectionPacket } from '../types.js';

const COMPACT_MODEL = 'Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC';
const STANDARD_MODEL = 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC';
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

let engine: WebWorkerMLCEngine | undefined;
let worker: Worker | undefined;
let loading: Promise<WebWorkerMLCEngine> | undefined;
let loadedModel: string | undefined;

function compactPacket(packet: FlockSectionPacket): Omit<FlockSectionPacket, 'section'> & {
  section: Omit<FlockSectionPacket['section'], 'source'>;
} {
  const { source: _source, ...section } = packet.section;
  return { ...packet, section };
}

async function chooseModel(): Promise<string> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ limits: { maxStorageBufferBindingSize: number } } | null> } }).gpu;
  if (!gpu) throw new Error('Local AI requires a browser with WebGPU support.');
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter is available on this device.');
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof deviceMemory === 'number' && deviceMemory >= 8 ? STANDARD_MODEL : COMPACT_MODEL;
}

async function getEngine(onStatus: LocalAIStatus): Promise<WebWorkerMLCEngine> {
  if (engine) return engine;
  if (loading) return loading;
  loading = (async () => {
    loadedModel = await chooseModel();
    onStatus(`Preparing private on-device AI (${loadedModel === COMPACT_MODEL ? 'compact' : 'standard'})…`);
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    engine = await CreateWebWorkerMLCEngine(worker, loadedModel, {
      initProgressCallback(progress: InitProgressReport) {
        const percent = Math.max(0, Math.min(100, Math.round(progress.progress * 100)));
        onStatus(`${progress.text || 'Loading local AI'}${percent ? ` · ${percent}%` : ''}`);
      },
    });
    onStatus('Local AI ready. Stored on this device.');
    return engine;
  })();
  try {
    return await loading;
  } catch (error) {
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
): Promise<FlockEditIntent> {
  const local = await getEngine(onStatus);
  onStatus('Understanding the requested change…');
  const response = await local.chat.completions.create({
    messages: [
      {
        role: 'system',
        content: 'You classify one website section edit. Return only JSON. Be conservative: visual requests do not authorize changing copy, links, or assets.',
      },
      {
        role: 'user',
        content: `Instruction:\n${instruction}\n\nSection context:\n${JSON.stringify(compactPacket(packet))}`,
      },
    ],
    response_format: { type: 'json_object', schema: INTENT_SCHEMA },
    temperature: 0.1,
    max_tokens: 300,
  });
  const parsed = JSON.parse(messageText(response.choices[0]?.message.content)) as FlockEditIntent;
  return {
    goals: Array.isArray(parsed.goals) ? parsed.goals.filter((goal): goal is string => typeof goal === 'string').slice(0, 5) : [],
    mayChangeContent: parsed.mayChangeContent === true && explicitlyAuthorizes(instruction, 'content'),
    mayChangeLinks: parsed.mayChangeLinks === true && explicitlyAuthorizes(instruction, 'links'),
    mayChangeAssets: parsed.mayChangeAssets === true && explicitlyAuthorizes(instruction, 'assets'),
    mayChangeStructure: parsed.mayChangeStructure === true,
  };
}

async function streamSource(
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  onStatus: LocalAIStatus,
): Promise<string> {
  const local = await getEngine(onStatus);
  const chunks = await local.chat.completions.create({
    messages,
    stream: true,
    temperature: 0.15,
    max_tokens: 8_000,
  });
  let source = '';
  for await (const chunk of chunks) {
    source += chunk.choices[0]?.delta.content ?? '';
    if (source.length % 500 < 40) onStatus(`Writing section… ${source.length.toLocaleString()} characters`);
  }
  return stripCodeFence(source);
}

export async function generateCandidate(
  packet: FlockSectionPacket,
  instruction: string,
  intent: FlockEditIntent,
  onStatus: LocalAIStatus,
): Promise<string> {
  onStatus('Writing the replacement section…');
  return streamSource([
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
  ], onStatus);
}

export async function repairCandidate(
  packet: FlockSectionPacket,
  instruction: string,
  intent: FlockEditIntent,
  candidate: string,
  failures: string[],
  onStatus: LocalAIStatus,
): Promise<string> {
  onStatus('Repairing the candidate once…');
  return streamSource([
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
  ], onStatus);
}

export async function removeLocalModel(): Promise<void> {
  await engine?.unload().catch(() => undefined);
  worker?.terminate();
  engine = undefined;
  worker = undefined;
  loading = undefined;
  loadedModel = undefined;
  await Promise.all([
    deleteModelAllInfoInCache(COMPACT_MODEL).catch(() => undefined),
    deleteModelAllInfoInCache(STANDARD_MODEL).catch(() => undefined),
  ]);
}
