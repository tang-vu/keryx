import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it, vi } from "vitest";
import { createRemoteMcpServer } from "./remote-server";

it("explains each advertised argument through real MCP discovery without invoking research", async () => {
  const research = vi.fn(async () => { throw new Error("Research is forbidden during discovery"); });
  const server = createRemoteMcpServer({ budgetCap: 0.03, clientChannel: "other" }, research);
  const client = new Client({ name: "metadata-contract", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    const missing = listed.tools.flatMap(tool => Object.entries(tool.inputSchema.properties ?? {})
      .filter(([, schema]) => !schema || typeof schema !== "object" || !("description" in schema) ||
        typeof schema.description !== "string" || !schema.description.trim())
      .map(([name]) => `${tool.name}.${name}`));
    expect(missing).toEqual([]);
    const submission = listed.tools.find(tool => tool.name === "deliverable_acceptance_submit")!
      .inputSchema.properties!.submission as { properties: Record<string, { description?: string }> };
    expect(Object.values(submission.properties).every(field => !!field.description?.trim())).toBe(true);
    expect(research).not.toHaveBeenCalled();
  } finally {
    await client.close();
    await server.close();
  }
});
