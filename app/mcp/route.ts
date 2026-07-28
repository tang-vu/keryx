/**
 * Keryx Remote MCP — stateless Streamable HTTP at https://keryx.cc/mcp.
 *
 * The protocol surface is public so any MCP client can initialize and inspect tools. `research`
 * uses the same guarded treasury-funded path as the OpenAI compatibility API: anonymous callers
 * get a small IP-limited free tier, while a verified ask-scoped Keryx key gets the A2A cap and a
 * stable wallet attribution. A key is identity/rate-limit only; creators are paid by Keryx.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextRequest } from "next/server";
import { verifyApiKey } from "@/lib/api-keys";
import { hasScope, parseScopes } from "@/lib/api-key-scopes";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { createRemoteMcpServer, type RemoteMcpAccess } from "@/lib/mcp/remote-server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import type { McpClientChannel } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const METHODS = "GET, POST, DELETE, OPTIONS";
const REQUEST_HEADERS =
  "Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID";

function configuredOrigins(req: NextRequest): Set<string> {
  const values = [
    req.nextUrl.origin,
    config.baseUrl,
    ...(process.env.KERYX_MCP_ALLOWED_ORIGINS ?? "").split(","),
  ];
  return new Set(
    values.flatMap((value) => {
      try {
        return value.trim() ? [new URL(value.trim()).origin] : [];
      } catch {
        return [];
      }
    }),
  );
}

export function isAllowedMcpOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  return !origin || configuredOrigins(req).has(origin);
}

function corsHeaders(req: NextRequest): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": METHODS,
    "Access-Control-Allow-Headers": REQUEST_HEADERS,
    "Access-Control-Expose-Headers": "MCP-Session-Id, MCP-Protocol-Version",
    Vary: "Origin",
  });
  const origin = req.headers.get("origin");
  if (origin && isAllowedMcpOrigin(req)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function jsonRpcHttpError(req: NextRequest, status: number, code: number, message: string) {
  const headers = corsHeaders(req);
  if (status === 401) headers.set("WWW-Authenticate", 'Bearer realm="Keryx MCP"');
  return Response.json(
    { jsonrpc: "2.0", error: { code, message }, id: null },
    { status, headers },
  );
}

export function researchCallCount(body: unknown): number {
  if (Array.isArray(body)) {
    return body.reduce((count, message) => count + researchCallCount(message), 0);
  }
  if (!body || typeof body !== "object") return 0;
  const message = body as { method?: unknown; params?: { name?: unknown } };
  return message.method === "tools/call" && message.params?.name === "research"
    ? 1
    : 0;
}

export function normalizeMcpClient(value: string | null): McpClientChannel {
  if (!value) return "direct";
  const normalized = value.trim().toLowerCase();
  if (normalized === "codex" || normalized === "claude" || normalized === "cursor") {
    return normalized;
  }
  return "other";
}

async function resolveAccess(
  req: NextRequest,
  researchCall: boolean,
): Promise<RemoteMcpAccess | Response> {
  const auth = req.headers.get("authorization");
  const rawKey = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : undefined;

  if (rawKey?.startsWith("kx_live_")) {
    const key = await verifyApiKey(rawKey);
    if (!key) return jsonRpcHttpError(req, 401, -32001, "Invalid or revoked API key.");
    if (!hasScope(parseScopes(key.scopes), "ask")) {
      return jsonRpcHttpError(req, 403, -32003, "API key is not scoped for research.");
    }
    if (researchCall) {
      const limited = await checkRateLimit(key.keyId, "ask");
      if (limited) return limited;
      const db = await getDb();
      void db.incrementUsage(key.keyId);
    }
    return {
      budgetCap: config.a2aMaxBudget,
      actor: key.walletAddress.toLowerCase(),
      clientChannel: normalizeMcpClient(req.nextUrl.searchParams.get("client")),
    };
  }

  if (researchCall) {
    const limited = await checkRateLimit(clientIp(req), "treasuryAsk", {
      code: "free_trial_limit",
      message:
        "Remote MCP free research is rate-limited. Use an ask-scoped kx_live_ API key for higher limits.",
    });
    if (limited) return limited;
  }
  return {
    budgetCap: config.anonMaxBudget,
    clientChannel: normalizeMcpClient(req.nextUrl.searchParams.get("client")),
  };
}

async function handle(req: NextRequest): Promise<Response> {
  if (!isAllowedMcpOrigin(req)) {
    return jsonRpcHttpError(req, 403, -32003, "Forbidden Origin header.");
  }

  const parsedBody =
    req.method === "POST" ? await req.clone().json().catch(() => undefined) : undefined;
  const researchCalls = researchCallCount(parsedBody);
  if (researchCalls > 1) {
    return jsonRpcHttpError(
      req,
      400,
      -32600,
      "A request may contain at most one treasury-funded research call.",
    );
  }
  const access = await resolveAccess(req, researchCalls === 1);
  if (access instanceof Response) {
    const headers = new Headers(access.headers);
    corsHeaders(req).forEach((value, key) => headers.set(key, value));
    return new Response(access.body, { status: access.status, headers });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createRemoteMcpServer(access);
  await server.connect(transport);
  const response = await transport.handleRequest(req, { parsedBody });
  const headers = new Headers(response.headers);
  corsHeaders(req).forEach((value, key) => headers.set(key, value));
  return new Response(response.body, { status: response.status, headers });
}

export function OPTIONS(req: NextRequest) {
  if (!isAllowedMcpOrigin(req)) {
    return jsonRpcHttpError(req, 403, -32003, "Forbidden Origin header.");
  }
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
