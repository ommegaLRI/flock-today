import OpenAI from 'openai';
import type { FlockEditIntent, FlockSectionPacket } from '../types.js';

const DEFAULT_MODEL = 'gpt-5.5';

export interface OpenAIInferenceOptions {
  apiKey?: string;
  model?: string;
}

export type OpenAIInferenceAction = 'interpret' | 'generate' | 'repair';

export interface OpenAIInferenceInput {
  action: OpenAIInferenceAction;
  instruction: string;
  intent?: FlockEditIntent;
  candidate?: string;
  failures?: string[];
}

function compactPacket(packet: FlockSectionPacket): Omit<FlockSectionPacket, 'section'> & {
  section: Omit<FlockSectionPacket['section'], 'source'>;
} {
  const { source: _source, ...section } = packet.section;
  return { ...packet, section };
}

function explicitlyAuthorizes(instruction: string, kind: 'content' | 'links' | 'assets'): boolean {
  const action = String.raw`(?:change|replace|rewrite|edit|remove|delete|add|update|set|rename|use|point)`;
  const terms = {
    content: String.raw`(?:copy|text|heading|headline|title|subtitle|eyebrow|label|caption|body|content|wording|words?)`,
    links: String.raw`(?:link|url|href|destination|route)`,
    assets: String.raw`(?:image|photo|picture|video|icon|logo|asset|media|poster|background)`,
  }[kind];
  return new RegExp(`\\b${action}\\b[\\s\\S]{0,60}\\b${terms}\\b|\\b${terms}\\b[\\s\\S]{0,60}\\b${action}\\b`, 'i').test(instruction)
    || (kind === 'content' && /\b(?:say|read)\s+["“'`]/i.test(instruction))
    || (kind === 'links' && /https?:\/\//i.test(instruction));
}

function stripCodeFence(source: string): string {
  const trimmed = source.trim();
  const match = trimmed.match(/^```(?:astro|html|tsx|jsx)?\s*\n([\s\S]*?)\n```$/i);
  return (match?.[1] ?? trimmed).trim();
}

export class OpenAIInference {
  readonly model: string;
  private readonly client?: OpenAI;

  constructor(options: OpenAIInferenceOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    this.model = options.model ?? process.env.FLOCK_OPENAI_MODEL ?? DEFAULT_MODEL;
    if (apiKey) this.client = new OpenAI({ apiKey });
  }

  get available(): boolean {
    return Boolean(this.client);
  }

  async run(packet: FlockSectionPacket, input: OpenAIInferenceInput): Promise<FlockEditIntent | string> {
    if (!this.client) throw new Error('OpenAI inference requires OPENAI_API_KEY.');
    if (!input.instruction.trim()) throw new Error('instruction is required.');

    if (input.action === 'interpret') {
      const response = await this.client.responses.create({
        model: this.model,
        instructions: 'Classify one website section edit. Return only a JSON object with goals, mayChangeContent, mayChangeLinks, mayChangeAssets, and mayChangeStructure. Be conservative: visual requests do not authorize changing copy, links, or assets.',
        input: `Instruction:\n${input.instruction}\n\nSection context:\n${JSON.stringify(compactPacket(packet))}`,
      });
      const raw = response.output_text.trim();
      const json = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```$/i, '').trim();
      const parsed = JSON.parse(json) as FlockEditIntent;
      return {
        goals: Array.isArray(parsed.goals) ? parsed.goals.filter((goal): goal is string => typeof goal === 'string').slice(0, 5) : [],
        mayChangeContent: parsed.mayChangeContent === true && explicitlyAuthorizes(input.instruction, 'content'),
        mayChangeLinks: parsed.mayChangeLinks === true && explicitlyAuthorizes(input.instruction, 'links'),
        mayChangeAssets: parsed.mayChangeAssets === true && explicitlyAuthorizes(input.instruction, 'assets'),
        mayChangeStructure: parsed.mayChangeStructure === true,
      };
    }

    if (!input.intent) throw new Error('intent is required.');
    const repair = input.action === 'repair';
    if (repair && typeof input.candidate !== 'string') throw new Error('candidate is required for repair.');

    const response = await this.client.responses.create({
      model: this.model,
      instructions: repair
        ? 'Repair one Astro section. Return exactly the complete corrected .astro file. Preserve and use exact uploadedAssets publicUrl values when requested. Do not explain, add dependencies, or add external scripts.'
        : 'You are Flock, an editor for one Astro section. Return exactly the complete replacement .astro file and nothing else. Preserve existing imports, project conventions, text, links, assets, accessibility identities, and data-stitch attributes unless explicitly authorized. Use existing Astro and Tailwind patterns. When uploadedAssets are present, use their exact publicUrl values directly in src, poster, or CSS url() references; do not invent imports or remote URLs. Do not add dependencies, remote scripts, markdown fences, or explanations.',
      input: repair
        ? [
            `OWNER INSTRUCTION:\n${input.instruction}`,
            `EDIT INTENT:\n${JSON.stringify(input.intent)}`,
            `VALIDATION FAILURES:\n${(input.failures ?? []).map((failure) => `- ${failure}`).join('\n')}`,
            `SECTION INTELLIGENCE:\n${JSON.stringify(compactPacket(packet))}`,
            `ORIGINAL SOURCE:\n${packet.section.source}`,
            `FAILED CANDIDATE:\n${input.candidate}`,
          ].join('\n\n')
        : [
            `OWNER INSTRUCTION:\n${input.instruction}`,
            `EDIT INTENT:\n${JSON.stringify(input.intent)}`,
            `SECTION INTELLIGENCE:\n${JSON.stringify(compactPacket(packet))}`,
            `CURRENT ASTRO SOURCE:\n${packet.section.source}`,
          ].join('\n\n'),
    });
    return stripCodeFence(response.output_text);
  }
}
