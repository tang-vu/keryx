import { afterEach, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { literatureBackupFixture } from "../../test-support/literature-backup-fixture";
import { serializeLiteratureWorkspace } from "./literature-workspace";
import { literatureExportTool, registerLiteratureExportTool } from "./literature-export-tool";

const clients: Client[] = [];
afterEach(async () => { for (const client of clients.splice(0)) await client.close(); vi.unstubAllGlobals(); });
it("exports through the actual local MCP protocol with read-only closed-world annotations and no network", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const server = new McpServer({ name: "library-export-test", version: "1" }); registerLiteratureExportTool(server);
  const client = new Client({ name: "library-export-client", version: "1" }); clients.push(client);
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  const [tool] = (await client.listTools()).tools;
  expect(tool.name).toBe("export_saved_literature");
  expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  expect(Object.keys(tool.inputSchema.properties ?? {}).sort()).toEqual(["backup", "format", "paperUrls", "screening"]);
  const result = await client.callTool({ name: tool.name, arguments: {
    backup: serializeLiteratureWorkspace(literatureBackupFixture()), format: "csl-json", screening: "include" } });
  expect(result.isError).not.toBe(true); expect(result.structuredContent).toMatchObject({ count: 1, scope: "bibliography-only", format: "csl-json" });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_"); expect(fetch).not.toHaveBeenCalled();
  const workspace = literatureBackupFixture(), backup = serializeLiteratureWorkspace(workspace);
  const selected = await client.callTool({ name: tool.name, arguments: { backup, format: "csl-json", paperUrls: workspace.entries.map(entry => entry.paper.url).reverse() } });
  expect(selected.isError).not.toBe(true);
  const content = selected.structuredContent as { content: string };
  expect(JSON.parse(content.content).map((entry: { URL: string }) => entry.URL)).toEqual(workspace.entries.map(entry => entry.paper.url).reverse());
  const empty = await client.callTool({ name: tool.name, arguments: { backup, format: "ris", paperUrls: [] } });
  expect(empty.structuredContent).toMatchObject({ count: 0, content: "" });
  const missing = await client.callTool({ name: tool.name, arguments: { backup, format: "ris", paperUrls: ["https://arxiv.org/abs/PRIVATE_NOT_SAVED"] } });
  expect(missing.isError).toBe(true); expect(missing.structuredContent).toBeUndefined();
  expect(JSON.stringify(missing)).not.toContain("PRIVATE_NOT_SAVED"); expect(fetch).not.toHaveBeenCalled();
  const bad = await client.callTool({ name: tool.name, arguments: { backup: "PRIVATE_MALFORMED_BACKUP", format: "ris" } });
  expect(bad.isError).toBe(true); expect(JSON.stringify(bad)).not.toContain("PRIVATE_MALFORMED_BACKUP"); expect(bad.structuredContent).toBeUndefined();
});
it("uses fixed private errors without returning schema, paths or malformed content", () => {
  const result = literatureExportTool({ backup: "PRIVATE_INVALID_JSON", format: "bibtex" });
  expect(result.isError).toBe(true); expect(result.structuredContent).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain("PRIVATE_INVALID_JSON");
});
