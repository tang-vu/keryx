import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, expect, it, vi } from "vitest";
import { createRemoteMcpServer } from "../mcp/remote-server";
import * as database from "../db";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProfileTools } from "./profile-mcp";
import type { ApiKeyScope } from "../api-key-scopes";
const input = { displayName: "Alice", handle: "reader_01", bio: "Reader", purpose: "Papers", links: [] };
afterEach(() => vi.restoreAllMocks());
async function connected(server: McpServer) { const client = new Client({ name: "profile-fixture", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct); return { client, close: async () => { await client.close(); await server.close(); } }; }
it.each([undefined, [], ["ask"], ["export"]] as (ApiKeyScope[] | undefined)[])("remote profile tools refuse missing explicit scope before storage/research/network", async profileScopes => {
  const db = vi.spyOn(database, "getDb").mockRejectedValue(new Error("No storage allowed")), research = vi.fn(), network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network allowed"));
  const link = await connected(createRemoteMcpServer({ budgetCap: 0, clientChannel: "other", actor: `0x${"a".repeat(40)}`, profileScopes }, research));
  try { for (const [name, args] of [["profile_read", {}], ["profile_update", { profile: input }]] as const) expect((await link.client.callTool({ name, arguments: args })).isError).toBe(true); expect(db).not.toHaveBeenCalled(); expect(research).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled(); } finally { await link.close(); }
});
it("a scoped remote key is bound to its wallet, and update is not a new dispatch/payment", async () => {
  const owner = `0x${"a".repeat(40)}`, read = vi.fn().mockResolvedValue({ profile: null, activity: {} }), update = vi.fn().mockResolvedValue(input);
  vi.spyOn(database, "getDb").mockResolvedValue({ privateProfiles: { get: read, update, delete: vi.fn() } } as unknown as Awaited<ReturnType<typeof database.getDb>>);
  const research = vi.fn(), link = await connected(createRemoteMcpServer({ budgetCap: 0, clientChannel: "other", actor: owner, profileScopes: ["profile:read", "profile:write"] }, research));
  try { expect((await link.client.callTool({ name: "profile_read", arguments: {} })).isError).not.toBe(true); expect((await link.client.callTool({ name: "profile_update", arguments: { profile: input } })).isError).not.toBe(true); expect(read.mock.calls[0][0]).toBe(owner); expect(update).toHaveBeenCalledWith(owner, input); expect(research).not.toHaveBeenCalled(); expect((await link.client.callTool({ name: "profile_update", arguments: { profile: { ...input, wallet: "foreign" } } })).isError).toBe(true); expect(update).toHaveBeenCalledTimes(1); } finally { await link.close(); }
});
it("shared stdio registration keeps owner out of model arguments and profile fields out of discovery responses", async () => {
  const read = vi.fn().mockResolvedValue({ profile: input }), server = new McpServer({ name: "stdio-profile-fixture", version: "1" }); registerProfileTools(server, { read, update: vi.fn() }); const link = await connected(server);
  try { const tools = await link.client.listTools(); expect(JSON.stringify(tools)).not.toContain("Alice"); expect(tools.tools.find(tool => tool.name === "profile_read")?.annotations?.readOnlyHint).toBe(true); expect((await link.client.callTool({ name: "profile_read", arguments: {} })).structuredContent).toEqual({ profile: input }); expect(read).toHaveBeenCalledOnce(); } finally { await link.close(); }
});
