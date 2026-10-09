import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { GET, OPTIONS, POST } from "../../app/mcp/route";
import * as apiKeys from "../api-keys";
import * as database from "../db";

const methods = "POST, DELETE, OPTIONS";

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function denyEffects() {
  const key = vi.spyOn(apiKeys, "verifyApiKey").mockRejectedValue(new Error("No key resolution allowed"));
  const db = vi.spyOn(database, "getDb").mockRejectedValue(new Error("No database access allowed"));
  const provider = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No provider transport allowed"));
  return {
    check() { expect(key).not.toHaveBeenCalled(); expect(db).not.toHaveBeenCalled(); expect(provider).not.toHaveBeenCalled(); },
    restore() { key.mockRestore(); db.mockRestore(); provider.mockRestore(); },
  };
}

describe("stateless MCP HTTP lifetime", () => {
  it("refuses GET before credentials, database or provider access and advertises truthful methods", async () => {
    const effects = denyEffects();
    try {
      for (const accept of ["text/event-stream", "application/json", "*/*"]) {
        const request = new NextRequest("http://localhost/mcp", { headers: {
          accept, origin: "http://localhost", authorization: "Bearer kx_live_synthetic",
          "MCP-Session-Id": "untrusted", "Last-Event-ID": "untrusted",
        } });
        const response = GET(request);
        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe(methods);
        expect(response.headers.get("access-control-allow-methods")).toBe(methods);
        expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost");
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("content-type")).toContain("application/json");
        expect(await response.json()).toEqual({ jsonrpc: "2.0", id: null,
          error: { code: -32000, message: "Standalone SSE is not supported. Send MCP messages with POST." } });
      }
      const options = OPTIONS(new NextRequest("http://localhost/mcp", { method: "OPTIONS" }));
      expect(options.status).toBe(204);
      expect(options.headers.get("access-control-allow-methods")).toBe(methods);
      effects.check();
    } finally { effects.restore(); }
  });

  it("retains invalid-Origin refusal on GET and OPTIONS before any effect", async () => {
    const effects = denyEffects();
    try {
      for (const handler of [GET, OPTIONS]) {
        const response = handler(new NextRequest("http://localhost/mcp", { headers: {
          origin: "https://untrusted.example", authorization: "Bearer kx_live_synthetic",
        } }));
        expect(response.status).toBe(403);
        expect(response.headers.get("access-control-allow-origin")).toBeNull();
        expect((await response.json()).error.code).toBe(-32003);
      }
      effects.check();
    } finally { effects.restore(); }
  });

  it("lets the real SDK continue with JSON POST after GET405 and gracefully drains an active POST", async () => {
    const localFetch = globalThis.fetch;
    const effects = denyEffects();
    const getCompleted = barrier(), postStarted = barrier(), releasePost = barrier();
    const observed: { method: string; status: number }[] = [];
    const errors: unknown[] = [];
    const events: string[] = [];
    let holdPost = false;
    const server: Server = createServer(async (incoming, outgoing) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        if (holdPost && incoming.method === "POST") {
          events.push("post-started"); postStarted.release(); await releasePost.promise;
        }
        const request = new NextRequest(`http://127.0.0.1/mcp`, {
          method: incoming.method, headers: new Headers(incoming.headers as Record<string, string>),
          ...(incoming.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
        });
        const response = incoming.method === "GET" ? GET(request) : await POST(request);
        outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
        if (holdPost && incoming.method === "POST") events.push("post-finished");
      } catch (error) { errors.push(error); outgoing.writeHead(500).end(); }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing loopback address");
    const endpoint = new URL(`http://127.0.0.1:${address.port}/mcp`);
    const transport = new StreamableHTTPClientTransport(endpoint, { fetch: async (url, init) => {
      expect(new URL(String(url)).href).toBe(endpoint.href);
      const response = await localFetch(url, init);
      observed.push({ method: init?.method ?? "GET", status: response.status });
      if (init?.method === "GET") getCompleted.release();
      return response;
    } });
    const client = new Client({ name: "offline-http-lifetime-regression", version: "1.0.0" });
    client.onerror = (error) => errors.push(error);
    let closed = false;
    try {
      await client.connect(transport);
      await getCompleted.promise;
      expect(observed.filter((request) => request.method === "GET")).toEqual([{ method: "GET", status: 405 }]);
      expect((await client.listTools()).tools.some((tool) => tool.name === "research")).toBe(true);
      expect(await client.callTool({ name: "keryx_status", arguments: {} })).toMatchObject({
        structuredContent: { endpoint: "connected" },
      });
      // Exercise an actual active HTTP response without research, authorization or synthetic payment.
      holdPost = true;
      const pending = client.listTools();
      await postStarted.promise;
      events.push("close-started");
      const closing = new Promise<void>((resolve, reject) => server.close((error) => {
        if (error) reject(error); else { closed = true; events.push("closed"); resolve(); }
      }));
      expect(closed).toBe(false);
      releasePost.release();
      expect((await pending).tools.some((tool) => tool.name === "research")).toBe(true);
      await closing;
      expect(events).toEqual(["post-started", "close-started", "post-finished", "closed"]);
      expect(server.listening).toBe(false);
      expect(observed.filter((request) => request.method === "GET")).toHaveLength(1);
      expect(errors).toEqual([]);
      effects.check();
    } finally {
      releasePost.release();
      await client.close();
      if (!closed) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      effects.restore();
    }
  }, 10_000);
});
