import { afterEach, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { literatureBackupFixture } from "../../test-support/literature-backup-fixture";
import { serializeLiteratureWorkspace } from "./literature-workspace";
import { literatureInspectionTool, registerLiteratureInspectionTool } from "./literature-inspection-tool";

const clients: Client[] = [];
afterEach(async () => { for (const client of clients.splice(0)) await client.close(); vi.unstubAllGlobals(); });
it("inspects through the real local MCP protocol with closed-world readonly annotations and no network", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const server = new McpServer({ name: "library-inspection-test", version: "1" }); registerLiteratureInspectionTool(server);
  const client = new Client({ name: "library-inspection-client", version: "1" }); clients.push(client);
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  const [tool] = (await client.listTools()).tools;
  expect(tool.name).toBe("inspect_saved_literature");
  expect(Object.keys(tool.inputSchema.properties ?? {})).toEqual(["backup"]);
  expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  const input = { backup: serializeLiteratureWorkspace(literatureBackupFixture()) };
  const result = await client.callTool({ name: tool.name, arguments: input });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({ format: "keryx-literature-inspection-v1", count: 2, screening: { include: 1, exclude: 1 } });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_"); expect(JSON.stringify(result)).not.toContain("https://");
  expect(await client.callTool({ name: tool.name, arguments: input })).toEqual(result);
  const bad = await client.callTool({ name: tool.name, arguments: { backup: "PRIVATE_MALFORMED_BACKUP" } });
  expect(bad.isError).toBe(true); expect(bad.structuredContent).toBeUndefined();
  expect(JSON.stringify(bad)).not.toContain("PRIVATE_MALFORMED_BACKUP"); expect(fetch).not.toHaveBeenCalled();
});
it("returns a fixed private error without schema or input details", () => {
  const result = literatureInspectionTool({ backup: "PRIVATE_INVALID_JSON" });
  expect(result.isError).toBe(true); expect(result.structuredContent).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain("PRIVATE_INVALID_JSON");
});
