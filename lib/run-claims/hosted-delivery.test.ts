import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deliveryFixture } from "./delivery.test-fixture";
import { privateRunClaimPacketSchema } from "./delivery";
const mocks = vi.hoisted(() => ({ db: vi.fn(), collect: vi.fn(), verifyKey: vi.fn() }));
vi.mock("@/lib/agent", () => ({ collectRun: mocks.collect }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/api-keys", () => ({ verifyApiKey: mocks.verifyKey }));
vi.mock("@/lib/llm", () => ({ resolveModelChoice: () => null }));
vi.mock("@/lib/sponsored-admission", () => ({ checkSponsoredResearchAdmission: async () => null }));
vi.mock("@/lib/config", async original => {
  const actual = await original<typeof import("../config")>();
  return { ...actual, config: { ...actual.config, networkId: "eip155:5042002", baseUrl: "https://claims.example",
    sellerAddress: `0x${"1".repeat(40)}`, botKey: "synthetic-engine-key" } };
});
import { POST } from "../../app/api/v1/chat/completions/route";
import { createRemoteMcpServer, remoteResearchResult } from "../mcp/remote-server";
let f: ReturnType<typeof deliveryFixture>;
beforeEach(() => {
  vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "true"); mocks.collect.mockReset(); mocks.db.mockReset(); mocks.verifyKey.mockReset();
  f = deliveryFixture(); mocks.db.mockResolvedValue(f.db);
  mocks.collect.mockImplementation(async (input: { queryId: string; asker?: string }) => f.save(input.queryId, input.asker ? { asker: input.asker } : {}));
});
afterEach(() => { f.sql.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const request = (stream = false, query = "") => new NextRequest(`https://claims.example/api/v1/chat/completions${query}`, { method: "POST",
  body: JSON.stringify({ messages: [{ role: "user", content: "Synthetic private delivery" }], budget: 0, stream }) });
it.each([false, true])("OpenAI %s keeps private packet out of choices/metadata and issues after saved completion", async stream => {
  const issue = vi.spyOn(f.store, "issue"), response = await POST(request(stream));
  expect(response.headers.get("cache-control")).toContain("no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  const body = stream ? (await response.text()).split("\n\n").filter(value => value.startsWith("data: {")).map(value => JSON.parse(value.slice(6))) : [await response.json()];
  const final = stream ? body.find(value => value.choices[0].finish_reason === "stop") : body[0];
  const packet = privateRunClaimPacketSchema.parse(final.keryx_private); expect(packet.status).toBe("available");
  if (packet.status !== "available") throw new Error("Expected private delivery");
  const token = new URL(packet.delivery.claimUrl).hash.slice(1);
  expect(JSON.stringify(body.map(value => ({ choices: value.choices, keryx: value.keryx })))).not.toContain(token);
  expect(issue).toHaveBeenCalledOnce(); expect(f.sql.prepare("SELECT id FROM query_runs WHERE id=?").get(packet.runId)).toBeDefined();
  expect(JSON.stringify(f.sql.prepare("SELECT * FROM query_runs").all())).not.toContain(token);
});
it.each([false, true])("unavailable OpenAI admission starts zero research calls: %s", async stream => {
  mocks.db.mockResolvedValue({}); const response = await POST(request(stream));
  if (!stream) expect(response.status).toBe(503);
  expect(await response.text()).toContain("claims_unavailable"); expect(mocks.collect).not.toHaveBeenCalled();
});
it("owned keys and verified internal engine callers do not issue anonymous ownership links", async () => {
  const wallet = `0x${"a".repeat(40)}`;
  mocks.verifyKey.mockResolvedValue({ walletAddress: wallet, keyId: "synthetic-key", scopes: "ask" });
  mocks.db.mockResolvedValue({ ...f.db, incrementUsage: vi.fn() });
  const owned = request(); owned.headers.set("authorization", "Bearer kx_live_synthetic");
  expect(await (await POST(owned)).json()).not.toHaveProperty("keryx_private");
  expect(await (await POST(request(false, "?bot=synthetic-engine-key"))).json()).not.toHaveProperty("keryx_private");
  expect(f.sql.prepare("SELECT * FROM anonymous_run_claims").all()).toEqual([]);
});
it("remote MCP returns private caller content/meta while retaining its exact public structured result", async () => {
  const server = createRemoteMcpServer({ budgetCap: 0, clientChannel: "other" }, mocks.collect);
  const client = new Client({ name: "private-synthetic", version: "1" }), [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st); await client.connect(ct);
    const result = await client.callTool({ name: "research", arguments: { question: "Synthetic private delivery", budget: 0 } });
    const packet = privateRunClaimPacketSchema.parse(result._meta?.["keryx/privateRunClaim"]);
    if (packet.status !== "available") throw new Error("Expected private delivery");
    const run = JSON.parse(String(f.sql.prepare("SELECT data FROM query_runs WHERE id=?").get(packet.runId)?.data));
    expect(result.structuredContent).toEqual(JSON.parse(JSON.stringify(remoteResearchResult(run))));
    expect(JSON.stringify(result.structuredContent)).not.toContain(new URL(packet.delivery.claimUrl).hash.slice(1));
    expect(result.content).toHaveLength(2); expect(JSON.stringify(result.content)).toContain(packet.delivery.claimUrl);
  } finally { await client.close(); await server.close(); }
});
it("remote MCP unavailable claim domain refuses before its research runner", async () => {
  mocks.db.mockResolvedValue({}); const server = createRemoteMcpServer({ budgetCap: 0, clientChannel: "other" }, mocks.collect);
  const client = new Client({ name: "private-refusal", version: "1" }), [ct, st] = InMemoryTransport.createLinkedPair();
  try { await server.connect(st); await client.connect(ct);
    const result = await client.callTool({ name: "research", arguments: { question: "Synthetic private delivery", budget: 0 } });
    expect(result.isError).toBe(true); expect(mocks.collect).not.toHaveBeenCalled();
  } finally { await client.close(); await server.close(); }
});
