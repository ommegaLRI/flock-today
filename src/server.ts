import { readFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ViteDevServer } from "vite";
import { FlockProjectError, StitchProject } from "./project.js";
import type { FlockEditIntent, FlockPreviewInput } from "./types.js";
import {
  OpenAIInference,
  type OpenAIInferenceAction,
} from "./inference/openai.js";

const API_PREFIX = "/_flock/api";
const MAX_BODY_BYTES = 256 * 1024;
const MAX_ASSET_BODY_BYTES = 8 * 1024 * 1024;

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(JSON.stringify(value));
}

function sendError(
  response: ServerResponse,
  error: unknown,
  fallbackStatus = 400,
): void {
  if (error instanceof FlockProjectError) {
    return sendJson(response, error.status, {
      error: error.message,
      code: error.code,
      failures: error.failures,
    });
  }
  return sendJson(response, fallbackStatus, {
    error: error instanceof Error ? error.message : String(error),
    code: "flock_error",
  });
}

async function readJsonBody(
  request: IncomingMessage,
  maxBytes = MAX_BODY_BYTES,
): Promise<Record<string, unknown>> {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new FlockProjectError(
      "Flock accepts application/json requests only.",
      415,
      "invalid_content_type",
    );
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes)
      throw new FlockProjectError(
        "Request body is too large.",
        413,
        "body_too_large",
      );
    chunks.push(buffer);
  }
  const parsed = JSON.parse(
    Buffer.concat(chunks).toString("utf8") || "{}",
  ) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FlockProjectError(
      "Request body must be a JSON object.",
      400,
      "invalid_body",
    );
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

function isLoopback(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress ?? "";
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address.startsWith("::ffff:127.")
  );
}

function parseIntent(value: unknown): FlockEditIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FlockProjectError("intent is required.", 400, "invalid_intent");
  }
  const input = value as Record<string, unknown>;
  return {
    goals: Array.isArray(input.goals)
      ? input.goals
          .filter((goal): goal is string => typeof goal === "string")
          .slice(0, 5)
      : [],
    mayChangeContent: input.mayChangeContent === true,
    mayChangeLinks: input.mayChangeLinks === true,
    mayChangeAssets: input.mayChangeAssets === true,
    mayChangeStructure: input.mayChangeStructure === true,
  };
}

function sectionRoute(
  pathname: string,
): { id: string; action: string } | undefined {
  const match = pathname.match(
    /^\/_flock\/api\/sections\/([^/]+)\/(context|infer|preview|keep|revert|assets)$/,
  );
  if (!match?.[1] || !match[2]) return undefined;
  return { id: decodeURIComponent(match[1]), action: match[2] };
}

export function installFlockMiddleware(
  server: ViteDevServer,
  project: StitchProject,
  openai: OpenAIInference,
): void {
  server.middlewares.use(async (request, response, next) => {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );
    if (!url.pathname.startsWith(API_PREFIX)) return next();
    if (!isLoopback(request))
      return sendError(
        response,
        new FlockProjectError(
          "Flock is available from localhost only.",
          403,
          "local_only",
        ),
      );
    if (!sameOrigin(request))
      return sendError(
        response,
        new FlockProjectError(
          "Cross-origin Flock requests are not allowed.",
          403,
          "cross_origin",
        ),
      );

    try {
      if (
        request.method === "GET" &&
        url.pathname === `${API_PREFIX}/project`
      ) {
        const summary = await project.summary();
        return sendJson(response, 200, {
          ...summary,
          inference: {
            openaiAvailable: openai.available,
            openaiModel: openai.available ? openai.model : undefined,
          },
        });
      }

      if (
        request.method === "GET" &&
        url.pathname.startsWith(`${API_PREFIX}/visual/`)
      ) {
        const sectionId = decodeURIComponent(
          url.pathname.slice(`${API_PREFIX}/visual/`.length),
        );
        const visual = await project.visual(sectionId);
        if (!visual)
          throw new FlockProjectError(
            "No Stitch visual exists for this section.",
            404,
            "visual_missing",
          );
        response.statusCode = 200;
        response.setHeader("content-type", visual.mimeType);
        response.setHeader("cache-control", "no-store");
        response.setHeader("x-content-type-options", "nosniff");
        return response.end(await readFile(visual.path));
      }

      const route = sectionRoute(url.pathname);
      if (!route)
        throw new FlockProjectError(
          "Unknown Flock endpoint.",
          404,
          "unknown_endpoint",
        );

      if (request.method === "GET" && route.action === "context") {
        return sendJson(response, 200, await project.packet(route.id));
      }

      if (request.method === "POST" && route.action === "assets") {
        const body = await readJsonBody(request, MAX_ASSET_BODY_BYTES);
        if (typeof body.filename !== "string" || !body.filename.trim()) {
          throw new FlockProjectError(
            "filename is required.",
            400,
            "invalid_asset_filename",
          );
        }
        if (typeof body.mimeType !== "string") {
          throw new FlockProjectError(
            "mimeType is required.",
            400,
            "invalid_asset_type",
          );
        }
        if (typeof body.dataBase64 !== "string") {
          throw new FlockProjectError(
            "dataBase64 is required.",
            400,
            "invalid_asset_data",
          );
        }
        const asset = await project.stageAsset(route.id, {
          filename: body.filename,
          mimeType: body.mimeType,
          dataBase64: body.dataBase64,
        });
        return sendJson(response, 201, { asset });
      }

      if (request.method === "DELETE" && route.action === "assets") {
        await project.discardStagedAssets(route.id);
        return sendJson(response, 200, { discarded: true });
      }

      if (request.method === "POST" && route.action === "infer") {
        const body = await readJsonBody(request);
        const action = body.action;
        if (
          action !== "interpret" &&
          action !== "generate" &&
          action !== "repair"
        ) {
          throw new FlockProjectError(
            "Unknown inference action.",
            400,
            "invalid_inference_action",
          );
        }
        if (typeof body.instruction !== "string" || !body.instruction.trim()) {
          throw new FlockProjectError(
            "instruction is required.",
            400,
            "invalid_instruction",
          );
        }
        const packet = await project.packet(route.id);
        const inferenceInput = {
          action: action as OpenAIInferenceAction,
          instruction: body.instruction,
          ...(action === "interpret"
            ? {}
            : { intent: parseIntent(body.intent) }),
          ...(typeof body.candidate === "string"
            ? { candidate: body.candidate }
            : {}),
          ...(Array.isArray(body.failures)
            ? {
                failures: body.failures.filter(
                  (value): value is string => typeof value === "string",
                ),
              }
            : {}),
        };
        const result = await openai.run(packet, inferenceInput);
        return sendJson(response, 200, { result, model: openai.model });
      }

      if (request.method === "POST" && route.action === "preview") {
        const body = await readJsonBody(request);
        if (typeof body.baseHash !== "string" || !body.baseHash) {
          throw new FlockProjectError(
            "baseHash is required.",
            400,
            "invalid_base_hash",
          );
        }
        if (typeof body.source !== "string") {
          throw new FlockProjectError(
            "source is required.",
            400,
            "invalid_source",
          );
        }
        const input: FlockPreviewInput = {
          baseHash: body.baseHash,
          source: body.source,
          intent: parseIntent(body.intent),
        };
        const section = await project.previewSection(route.id, input);
        server.watcher.emit("change", path.resolve(project.root, section.file));
        return sendJson(response, 200, { section });
      }

      if (request.method === "POST" && route.action === "keep") {
        const section = await project.keepSection(route.id);
        return sendJson(response, 200, { section });
      }

      if (request.method === "POST" && route.action === "revert") {
        const section = await project.revertSection(route.id);
        server.watcher.emit("change", path.resolve(project.root, section.file));
        return sendJson(response, 200, { section });
      }

      throw new FlockProjectError(
        "Unknown Flock endpoint.",
        404,
        "unknown_endpoint",
      );
    } catch (error) {
      return sendError(response, error);
    }
  });
}
