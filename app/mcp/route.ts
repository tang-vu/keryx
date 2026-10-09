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
import { clientIp } from "@/lib/rate-limit";
import { checkSponsoredResearchAdmission } from "@/lib/sponsored-admission";
import { readMcpBody } from "@/lib/mcp/request-body";
import { isAllowedMcpOrigin, isPaperLookupCall, normalizeMcpClient, researchCallCount } from "@/lib/mcp/route-helpers";
import { readResearchAvailability } from "@/lib/research/availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const METHODS = "POST, DELETE, OPTIONS";
const REQUEST_HEADERS =
  "Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID";

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

function jsonRpcHttpError(req: NextRequest, status: number, code: number, message: string, data?: unknown) {
  const headers = corsHeaders(req);
  if (status === 401) headers.set("WWW-Authenticate", 'Bearer realm="Keryx MCP"');
  return Response.json(
    { jsonrpc: "2.0", error: { code, message, ...(data ? { data } : {}) }, id: null },
    { status, headers },
  );
}

async function resolveAccess(
  req: NextRequest,
  researchCall: boolean,
  paperLookupOnly: boolean,
): Promise<RemoteMcpAccess | Response> {
  if (paperLookupOnly) return {
    budgetCap: config.anonMaxBudget,
    clientChannel: normalizeMcpClient(req.nextUrl.searchParams.get("client")),
    paperCaller: clientIp(req), signal: req.signal,
  };
  const heldResponse = () => {
    const availability = readResearchAvailability();
    return availability.state === "paused" ? jsonRpcHttpError(req, 503, -32000, availability.message,
      { code: "research_paused", availability }) : null;
  };
  const auth = req.headers.get("authorization");
  const rawKey = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : undefined;

  if (rawKey?.startsWith("kx_live_")) {
    const key = await verifyApiKey(rawKey);
    if (!key) return jsonRpcHttpError(req, 401, -32001, "Invalid or revoked API key.");
    const scopes = parseScopes(key.scopes);
    if (!hasScope(scopes, "ask") && (researchCall || !scopes.some(scope => scope === "profile:read" || scope === "profile:write" || scope === "history:read" || scope === "operator:read"))) {
      return jsonRpcHttpError(req, 403, -32003, "API key is not scoped for research.");
    }
    if (researchCall) {
      const held = heldResponse(); if (held) return held;
      const limited = await checkSponsoredResearchAdmission({ kind: "key", wallet: key.walletAddress, ip: clientIp(req) });
      if (limited) return limited;
      const db = await getDb();
      void db.incrementUsage(key.keyId);
    }
    return {
      budgetCap: config.a2aMaxBudget,
      actor: key.walletAddress.toLowerCase(),
      profileScopes: scopes,
      historyScopes: scopes,
      operatorScopes: scopes,
      clientChannel: normalizeMcpClient(req.nextUrl.searchParams.get("client")),
      paperCaller: clientIp(req), signal: req.signal,
    };
  }

  if (researchCall) {
    const held = heldResponse(); if (held) return held;
    const limited = await checkSponsoredResearchAdmission({ kind: "anonymous", ip: clientIp(req) });
    if (limited) return limited;
  }
  return {
    budgetCap: config.anonMaxBudget,
    clientChannel: normalizeMcpClient(req.nextUrl.searchParams.get("client")),
    paperCaller: clientIp(req), signal: req.signal,
  };
}

async function handle(req: NextRequest): Promise<Response> {
  if (!isAllowedMcpOrigin(req)) {
    return jsonRpcHttpError(req, 403, -32003, "Forbidden Origin header.");
  }

  let parsedBody: unknown;
  if (req.method === "POST") {
    try { parsedBody = await readMcpBody(req); }
    catch { return jsonRpcHttpError(req, 400, -32700, "Invalid JSON body; limit 64 KiB and 5 seconds."); }
  }
  const researchCalls = researchCallCount(parsedBody);
  if (researchCalls > 1) {
    return jsonRpcHttpError(
      req,
      400,
      -32600,
      "A request may contain at most one treasury-funded research call.",
    );
  }
  const access = await resolveAccess(req, researchCalls === 1, isPaperLookupCall(parsedBody));
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
  headers.set("Cache-Control", "no-store");
  corsHeaders(req).forEach((value, key) => headers.set(key, value));
  return new Response(response.body, { status: response.status, headers });
}

export function OPTIONS(req: NextRequest) {
  if (!isAllowedMcpOrigin(req)) {
    return jsonRpcHttpError(req, 403, -32003, "Forbidden Origin header.");
  }
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export function GET(req: NextRequest) {
  if (!isAllowedMcpOrigin(req)) {
    return jsonRpcHttpError(req, 403, -32003, "Forbidden Origin header.");
  }
  // This stateless JSON endpoint has no server-initiated notification stream.
  // Refuse before resolving credentials or constructing the SDK's unbounded GET SSE stream.
  const response = jsonRpcHttpError(req, 405, -32000,
    "Standalone SSE is not supported. Send MCP messages with POST.");
  response.headers.set("Allow", METHODS);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const POST = handle;
export const DELETE = handle;
