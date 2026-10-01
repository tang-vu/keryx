import { createServer, request as httpRequest } from "node:http";
import type { Server } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { readOwnedFixtureRequestBody } from "./enrolled-supabase-native-https.mjs";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Synthetic listener refused");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

it("real SDK receives a response delayed beyond the completed request-body deadline", async () => {
  const server = createServer(async (request, response) => {
    await readOwnedFixtureRequestBody(request, 100);
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    response.setHeader("Content-Type", "application/json");
    response.end("[]");
  });
  const origin = await listen(server);
  try {
    const client = createClient(origin, "synthetic-no-authority", { auth: { persistSession: false } });
    const result = await client.rpc("synthetic_metrics", {}).throwOnError();
    expect(result.data).toEqual([]);
    expect(result.error).toBeNull();
  } finally { await close(server); }
});

it("still refuses an incomplete request body at its own deadline", async () => {
  let resolveRefusal!: () => void;
  const refused = new Promise<void>((resolve) => { resolveRefusal = resolve; });
  const server = createServer(async (request, response) => {
    try {
      await readOwnedFixtureRequestBody(request, 100);
      response.end("unexpected");
    } catch { resolveRefusal(); }
  });
  const origin = await listen(server);
  try {
    const request = httpRequest(origin, { method: "POST", headers: { "Content-Length": "2" } });
    const disconnected = new Promise<string | undefined>((resolve) => request.once("error", (error: NodeJS.ErrnoException) => resolve(error.code)));
    request.write("{");
    const [, code] = await Promise.all([refused, disconnected]);
    expect(code).toBe("ECONNRESET");
    request.destroy();
  } finally { await close(server); }
});
