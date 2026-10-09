/** Actual built stdio distribution; synthetic retained reports, no external calls. */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { evidenceDraftFixture } from "../lib/research/fixtures/evidence-draft";

const directory = await mkdtemp(join(tmpdir(), "keryx-evidence-draft-mcp-"));
assert(resolve(directory).startsWith(resolve(tmpdir()) + sep));
const bootstrap = join(directory, "no-network.mjs");
await writeFile(bootstrap, "globalThis.fetch=async()=>{throw Error('Unexpected network call in private draft transformation');};");
try {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ["--import", pathToFileURL(bootstrap).href, resolve("mcp/dist/keryx-mcp.mjs")],
    env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", KERYX_BASE_URL: "https://fixture.invalid",
      KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet",
      KERYX_WALLET_FILE: join(directory, "forbidden-wallet.json"), KERYX_PAYMENT_JOURNAL: join(directory, "forbidden-payment.json") }, stderr: "pipe" });
  const client = new Client({ name: "private-draft-distribution-fixture", version: "1" });
  try {
    await client.connect(transport); const tools = await client.listTools(); assert(tools.tools.some(tool => tool.name === "evidence_draft"));
    const response = await client.callTool({ name: "evidence_draft", arguments: { draft: evidenceDraftFixture() } });
    assert(!response.isError); const content = response.structuredContent as { draft: { scope: string; origin: string; claims: Array<{ status: string }> } };
    assert.equal(content.draft.scope, "private-evidence-draft"); assert.equal(content.draft.origin, "caller-supplied-report");
    assert.equal(content.draft.claims[0].status, "assessment-pending");
    const refused = await client.callTool({ name: "evidence_draft", arguments: { draft: { passage: "PRIVATE_SECRET_FIXTURE" } } });
    assert(refused.isError); assert(!JSON.stringify(refused).includes("PRIVATE_SECRET_FIXTURE"));
    for (const span of [{ start: 0, end: 1 }, { start: 1, end: 2 }]) {
      const input = evidenceDraftFixture(); input.passage = "\u{1F600}x"; Object.assign(input.claims[0], span);
      const split = await client.callTool({ name: "evidence_draft", arguments: { draft: input } });
      assert(split.isError); assert.equal(split.structuredContent, undefined);
      assert.deepEqual(split.content, [{ type: "text", text: "Invalid or changed private evidence draft. Use the version-1 bounded contract; no research or payment started." }]);
    }
    const scalarInput = evidenceDraftFixture(); scalarInput.passage = "\u{1F600}x"; scalarInput.claims[0].end = 2;
    const scalar = await client.callTool({ name: "evidence_draft", arguments: { draft: scalarInput } });
    assert(!scalar.isError);
    assert.equal((scalar.structuredContent as { draft: { claims: Array<{ text: string }> } }).draft.claims[0].text, "\u{1F600}");
  } finally { await client.close(); }
  assert(!(await readdir(directory)).some(name => name.startsWith("forbidden-")));
  console.log("Built stdio private draft tool passed: retained fixture matching, pending semantics, UTF-16 span validation, fixed invalid-input errors and no network/custody writes. Not publication or a fresh-consumer install claim.");
} finally { await rm(directory, { recursive: true, force: true }); }
