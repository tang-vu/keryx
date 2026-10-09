import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, expect, it, vi } from "vitest";
import * as database from "../db";
import { createRemoteMcpServer } from "../mcp/remote-server";
import type { ApiKeyScope } from "../api-key-scopes";
import { registerIdentityReadTool } from "./identity-mcp";

const owner = `0x${"a".repeat(40)}`, foreign = `0x${"b".repeat(40)}`;
const record = { wallet: owner, provider: "github", externalId: "123", label: "fixture-user", verifiedAt: "2026-10-09T00:00:00.000Z" };
const snapshot = { wallet: owner, identities: [record] };
afterEach(() => vi.restoreAllMocks());
async function connected(server: McpServer) {
  const client = new Client({ name: "identity-fixture", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
it.each([undefined, [], ["ask"], ["export"], ["profile:write"]] as (ApiKeyScope[] | undefined)[])("remote identities refuse non-read or legacy scope %j before storage/network/research", async profileScopes => {
  const db = vi.spyOn(database, "getDb").mockRejectedValue(new Error("No storage permitted"));
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network permitted")), research = vi.fn();
  const link = await connected(createRemoteMcpServer({ budgetCap: 0, actor: owner, clientChannel: "other", profileScopes }, research));
  try {
    expect((await link.client.callTool({ name: "profile_identities_read", arguments: {} })).isError).toBe(true);
    expect(db).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled(); expect(research).not.toHaveBeenCalled();
  } finally { await link.close(); }
});
it.each([undefined, "foreign-wallet"])("remote identities require a valid verified owner %s even with read scope", async actor => {
  const db = vi.spyOn(database, "getDb").mockRejectedValue(new Error("No storage permitted"));
  const link = await connected(createRemoteMcpServer({ budgetCap: 0, actor, clientChannel: "other", profileScopes: ["profile:read"] }, vi.fn()));
  try { expect((await link.client.callTool({ name: "profile_identities_read", arguments: {} })).isError).toBe(true); expect(db).not.toHaveBeenCalled(); }
  finally { await link.close(); }
});
it("a remote read is bound to the verified owner and leaves profile_read unchanged", async () => {
  const list = vi.fn().mockResolvedValue(snapshot), profileSnapshot = { profile: null, activity: { untouched: "fixture" } }, get = vi.fn().mockResolvedValue(profileSnapshot);
  vi.spyOn(database, "getDb").mockResolvedValue({ profileIdentities: { list }, privateProfiles: { get } } as unknown as Awaited<ReturnType<typeof database.getDb>>);
  const research = vi.fn(), network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No provider calls"));
  const link = await connected(createRemoteMcpServer({ budgetCap: 0, actor: owner.toUpperCase().replace("0X", "0x"), clientChannel: "other", profileScopes: ["profile:read"] }, research));
  try {
    const result = await link.client.callTool({ name: "profile_identities_read", arguments: {} });
    expect(result.isError).not.toBe(true); expect(result.structuredContent).toEqual(snapshot); expect(list).toHaveBeenCalledExactlyOnceWith(owner);
    expect((await link.client.callTool({ name: "profile_read", arguments: {} })).structuredContent).toEqual(profileSnapshot);
    expect(research).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  } finally { await link.close(); }
});
it("a consistent but foreign storage snapshot is refused rather than exposed", async () => {
  vi.spyOn(database, "getDb").mockResolvedValue({ profileIdentities: { list: vi.fn().mockResolvedValue({ wallet: foreign, identities: [{ ...record, wallet: foreign }] }) } } as unknown as Awaited<ReturnType<typeof database.getDb>>);
  const link = await connected(createRemoteMcpServer({ budgetCap: 0, actor: owner, clientChannel: "other", profileScopes: ["profile:read"] }, vi.fn()));
  try { const result = await link.client.callTool({ name: "profile_identities_read", arguments: {} }); expect(result.isError).toBe(true); expect(JSON.stringify(result)).not.toContain(foreign); }
  finally { await link.close(); }
});
it("a missing identity storage port fails closed", async () => {
  vi.spyOn(database, "getDb").mockResolvedValue({} as Awaited<ReturnType<typeof database.getDb>>);
  const link = await connected(createRemoteMcpServer({ budgetCap: 0, actor: owner, clientChannel: "other", profileScopes: ["profile:read"] }, vi.fn()));
  try { expect((await link.client.callTool({ name: "profile_identities_read", arguments: {} })).isError).toBe(true); }
  finally { await link.close(); }
});
it("shared registration is read-only, strict and reveals no owner data during discovery", async () => {
  const read = vi.fn().mockResolvedValue(snapshot), server = new McpServer({ name: "identity-stdio-fixture", version: "1" });
  registerIdentityReadTool(server, read); const link = await connected(server);
  try {
    const tools = await link.client.listTools(); expect(read).not.toHaveBeenCalled(); expect(JSON.stringify(tools)).not.toContain("fixture-user");
    expect(tools.tools.map(tool => tool.name)).toEqual(["profile_identities_read"]);
    expect(tools.tools[0].annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(tools.tools[0].inputSchema.additionalProperties).toBe(false);
    expect((await link.client.callTool({ name: "profile_identities_read", arguments: { wallet: foreign } })).isError).toBe(true); expect(read).not.toHaveBeenCalled();
    expect((await link.client.callTool({ name: "profile_identities_read", arguments: {} })).structuredContent).toEqual(snapshot); expect(read).toHaveBeenCalledOnce();
  } finally { await link.close(); }
});
it.each([
  { ...snapshot, access_token: "fixture-secret" }, { wallet: owner, identities: [{ ...record, refresh_token: "fixture-secret" }] },
  { wallet: owner, identities: [{ ...record, wallet: foreign }] }, { wallet: owner, identities: [record, record] },
  { wallet: owner, identities: [{ ...record, label: "fixture\nsecret" }] }, { wallet: owner, identities: [{ ...record, verifiedAt: "yesterday" }] },
])("shared identity output rejects unallowlisted or malformed storage data %j", async value => {
  const server = new McpServer({ name: "identity-refusal-fixture", version: "1" }); registerIdentityReadTool(server, vi.fn().mockResolvedValue(value));
  const link = await connected(server);
  try { const result = await link.client.callTool({ name: "profile_identities_read", arguments: {} }); expect(result.isError).toBe(true); expect(result.structuredContent).toBeUndefined(); expect(JSON.stringify(result)).not.toContain("fixture-secret"); }
  finally { await link.close(); }
});
it("shared identity errors never disclose transport/storage exception messages", async () => {
  const server = new McpServer({ name: "identity-error-fixture", version: "1" }); registerIdentityReadTool(server, vi.fn().mockRejectedValue(new Error("fixture-secret-provider-token")));
  const link = await connected(server);
  try { const result = await link.client.callTool({ name: "profile_identities_read", arguments: {} }); expect(result.isError).toBe(true); expect(JSON.stringify(result)).not.toContain("fixture-secret"); }
  finally { await link.close(); }
});
