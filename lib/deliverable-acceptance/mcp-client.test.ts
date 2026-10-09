import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, expect, it, vi } from "vitest";
import * as database from "../db";
import { createRemoteMcpServer, type RemoteMcpAccess } from "../mcp/remote-server";
import { registerAcceptanceTools } from "./mcp";
import { createAcceptanceClient } from "./client";
import { acceptanceFixture } from "./test-fixture";
import { acceptanceMetricsSchema, acceptanceInputSchema } from "./contracts";
import { API_KEY_SCOPES, parseScopes, normalizeScopes } from "../api-key-scopes";
afterEach(() => vi.restoreAllMocks());
const id = `a2a_${"1".repeat(64)}`, owner = `0x${"11".repeat(20)}`;
const key = `kx_live_${"a".repeat(96)}`;
const input = { originalFingerprint: "1".repeat(64), deliveredDigest: "2".repeat(64), expectedRevision: 0,
  idempotencyKey: "synthetic-request-0001", choice: "accept" as const, reason: "", publishState: false };
async function connected(server: McpServer) {
  const client = new Client({ name: "acceptance-fixture", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
it("adds explicit deliverable scopes without widening old keys", () => {
  for (const scope of ["deliverable:read", "deliverable:write"] as const) {
    expect(API_KEY_SCOPES).toContain(scope); expect(normalizeScopes([scope])).toEqual([scope]);
    for (const stored of [null, "", "retired", "ask,export"]) expect(parseScopes(stored)).not.toContain(scope);
  }
});
it.each([{}, { actor: owner }, { actor: owner, keyId: "synthetic" }, { actor: owner, keyId: "synthetic", deliverableScopes: ["ask"] },
  { actor: owner, keyId: "synthetic", profileScopes: ["profile:write"] } ] as Partial<RemoteMcpAccess>[])("remote choice tools refuse absent/non-deliverable authority before storage/research %j", async access => {
  const db = vi.spyOn(database, "getDb").mockRejectedValue(new Error("No DB")), network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No HTTP")), research = vi.fn();
  const link = await connected(createRemoteMcpServer({ budgetCap: 0, clientChannel: "other", ...access }, research));
  try {
    expect((await link.client.callTool({ name: "deliverable_acceptance_read", arguments: { id } })).isError).toBe(true);
    expect((await link.client.callTool({ name: "deliverable_acceptance_submit", arguments: { id, submission: input } })).isError).toBe(true);
    expect(db).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled(); expect(research).not.toHaveBeenCalled();
  } finally { await link.close(); }
});
it("shared MCP inventory is strict, closed and accurately marks request mutation", async () => {
  const read = vi.fn(), submit = vi.fn(), server = new McpServer({ name: "acceptance-fixture", version: "1" });
  registerAcceptanceTools(server, { read, submit }); const link = await connected(server);
  try {
    const tools = (await link.client.listTools()).tools; expect(tools.map(tool => tool.name)).toEqual(["deliverable_acceptance_read", "deliverable_acceptance_submit"]);
    expect(tools[0].annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(tools[1].annotations?.readOnlyHint).toBe(false); expect(tools[1].annotations?.idempotentHint).toBe(true);
    expect(tools.every(tool => tool.inputSchema.additionalProperties === false)).toBe(true);
    expect((await link.client.callTool({ name: "deliverable_acceptance_submit", arguments: { id, submission: input, owner } })).isError).toBe(true);
    expect(submit).not.toHaveBeenCalled();
    expect((await link.client.callTool({ name: "deliverable_acceptance_submit", arguments: { id, submission: { ...input, network: "eip155:5042" } } })).isError).toBe(true);
    expect(submit).not.toHaveBeenCalled();
  } finally { await link.close(); }
});
it("remote adapter records actual private ordinary choice and never calls research/network", async () => {
  const f = await acceptanceFixture(); const db = vi.spyOn(database, "getDb").mockResolvedValue(f.db), network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No HTTP")), research = vi.fn();
  const link = await connected(createRemoteMcpServer({ budgetCap: 0, clientChannel: "other", actor: owner, keyId: f.authority.id, deliverableScopes: ["deliverable:read", "deliverable:write"] }, research));
  try {
    const read = await link.client.callTool({ name: "deliverable_acceptance_read", arguments: { id: f.fixture.order.id } }); expect(read.isError).not.toBe(true); expect(read.structuredContent).toEqual(f.snapshot);
    const result = await link.client.callTool({ name: "deliverable_acceptance_submit", arguments: { id: f.fixture.order.id, submission: { ...f.input, choice: "revise", reason: "Synthetic private request" } } });
    expect(result.isError).not.toBe(true); expect(result.structuredContent).toMatchObject({ state: "revision_requested", revision: 1, revisionExecution: "withheld", refundExecution: "withheld" });
    expect(db).toHaveBeenCalled(); expect(network).not.toHaveBeenCalled(); expect(research).not.toHaveBeenCalled();
  } finally { await link.close(); f.db.close(); }
});
it("key-only HTTPS client sends bounded exact request without cookies/retries/redirects and validates response binding", async () => {
  const f = await acceptanceFixture();
  try {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(f.snapshot)));
    const client = createAcceptanceClient("https://keryx.example", () => key, fetcher);
    expect(await client.read(f.fixture.order.id)).toEqual(f.snapshot);
    const [url, options] = fetcher.mock.calls[0]; expect(String(url)).toBe(`https://keryx.example/api/me/deliverables/${f.fixture.order.id}/acceptance`);
    expect(options).toMatchObject({ method: "GET", credentials: "omit", redirect: "error", cache: "no-store", headers: { Authorization: `Bearer ${key}` } });
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...f.snapshot, id })));
    await expect(client.read(f.fixture.order.id)).rejects.toThrow("binding mismatch");
    fetcher.mockResolvedValueOnce(new Response("refused", { status: 409 })); await expect(client.submit(f.fixture.order.id, f.input)).rejects.toThrow("Read current state");
    expect(fetcher).toHaveBeenCalledTimes(3);
  } finally { f.db.close(); }
});
it.each(["http://keryx.example", "https://user:pass@keryx.example", "https://keryx.example?", "https://keryx.example#", "https://keryx.example/.", "https://keryx.example\u0000"])("client refuses malformed deployment origin %s", base => {
  expect(() => createAcceptanceClient(base, () => key)).toThrow("HTTPS deployment origin");
});
it("consented current counts stay unclassified, with no invented whole-population rate", async () => {
  const f = await acceptanceFixture();
  try {
    expect(await f.port.metrics(f.fixture.binding.network)).toEqual(acceptanceMetricsSchema.parse({ format: "keryx-deliverable-choice-counts-v1", scope: "consented-current-prepaid-a2a",
      accepted: 0, revisionRequested: 0, rejected: 0, outsideCustomers: null, team: null, noResponse: null, acceptanceRate: null, classification: "unmeasured" }));
    await f.port.submit(owner, f.fixture.binding.network, f.fixture.order.id, acceptanceInputSchema.parse({ ...f.input, publishState: true }), f.authority);
    expect((await f.port.metrics(f.fixture.binding.network)).accepted).toBe(1);
  } finally { f.db.close(); }
});
