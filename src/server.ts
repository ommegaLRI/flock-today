import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';
import { StitchProject } from './project.js';
import type { GenerateSection } from './types.js';

const API_PREFIX = '/_flock/api';
const MAX_BODY_BYTES = 64 * 1024;
const MAX_INSTRUCTION_LENGTH = 8_000;

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify(value));
}

function sendError(response: ServerResponse, status: number, error: unknown): void {
  sendJson(response, status, {
    error: error instanceof Error ? error.message : String(error),
  });
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  const parsed = JSON.parse(body || '{}') as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function installFlockMiddleware(
  server: ViteDevServer,
  project: StitchProject,
  generateSection?: GenerateSection,
): void {
  server.middlewares.use(async (request, response, next) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (!url.pathname.startsWith(API_PREFIX)) return next();
    if (!sameOrigin(request)) return sendError(response, 403, new Error('Cross-origin Flock requests are not allowed.'));

    try {
      if (request.method === 'GET' && url.pathname === `${API_PREFIX}/project`) {
        return sendJson(response, 200, await project.summary(Boolean(generateSection)));
      }

      if (request.method === 'GET' && url.pathname.startsWith(`${API_PREFIX}/visual/`)) {
        const sectionId = decodeURIComponent(url.pathname.slice(`${API_PREFIX}/visual/`.length));
        const visual = await project.visual(sectionId);
        if (!visual) return sendError(response, 404, new Error('No Stitch visual exists for this section.'));
        const details = await readFile(visual.path);
        response.statusCode = 200;
        response.setHeader('content-type', visual.mimeType);
        response.setHeader('cache-control', 'no-store');
        return response.end(details);
      }

      if (request.method === 'POST' && url.pathname === `${API_PREFIX}/regenerate`) {
        if (!generateSection) return sendError(response, 501, new Error('Flock AI is not implemented in this phase.'));
        const body = await readJsonBody(request);
        const sectionId = typeof body.sectionId === 'string' ? body.sectionId : '';
        const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
        const route = typeof body.route === 'string' ? body.route : '/';
        if (!sectionId) throw new Error('sectionId is required.');
        if (!instruction) throw new Error('instruction is required.');
        if (instruction.length > MAX_INSTRUCTION_LENGTH) throw new Error('instruction is too long.');

        const context = await project.context(sectionId);
        const generatedSource = await generateSection({ instruction, route, context });
        const section = await project.replaceSection(sectionId, generatedSource);
        server.watcher.emit('change', path.resolve(project.root, section.file));
        return sendJson(response, 200, { section, canRevert: true });
      }

      if (request.method === 'POST' && url.pathname === `${API_PREFIX}/revert`) {
        const body = await readJsonBody(request);
        const sectionId = typeof body.sectionId === 'string' ? body.sectionId : '';
        if (!sectionId) throw new Error('sectionId is required.');
        const section = await project.revertSection(sectionId);
        server.watcher.emit('change', path.resolve(project.root, section.file));
        return sendJson(response, 200, { section, canRevert: false });
      }

      return sendError(response, 404, new Error('Unknown Flock endpoint.'));
    } catch (error) {
      return sendError(response, 400, error);
    }
  });
}
