import { expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerPublicJobLedger } from "./mcp";
import { ledgerFixture } from "./test-fixture";

it("uses actual MCP registration to expose one public read-only contract and reject selectors before hydration", async () => {
  const server = new McpServer({ name: "public-ledger-fixture", version: "1.0.0" }), client = new Client({ name: "offline-fixture", version: "1.0.0" });
  const read = vi.fn(async () => ledgerFixture()); registerPublicJobLedger(server, read);
  const [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(right); await client.connect(left);
    const list = await client.listTools(); expect(list.tools.map(tool => tool.name)).toEqual(["keryx_public_job_ledger"]);
    expect(list.tools[0].annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(list.tools[0].inputSchema.additionalProperties).toBe(false);
    for (const args of [{ wallet: "private" }, { network: "eip155:5042" }, { days: 32 }]) {
      const response = await client.callTool({ name: "keryx_public_job_ledger", arguments: args }); expect(response.isError).toBe(true);
    }
    expect(read).not.toHaveBeenCalled();
    const result = await client.callTool({ name: "keryx_public_job_ledger", arguments: { days: 7 } });
    expect(result.isError).toBeUndefined(); expect(read).toHaveBeenCalledWith(7);
    expect(JSON.parse((result.content as { text: string }[])[0].text)).toEqual(ledgerFixture());
  } finally { await client.close(); await server.close(); }
});
