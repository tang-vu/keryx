/** Execute the built stdio distribution using synthetic key and hermetic read-only HTTP. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const temporary = await mkdtemp(join(tmpdir(), "keryx-monthly-mcp-"));
assert(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
const bootstrap = join(temporary, "http.mjs");
await writeFile(bootstrap, `globalThis.fetch=async()=>new Response(JSON.stringify({quote:{plan:'research-monthly-v1',requests:4,termDays:30,researchMode:'deep',packageVersion:'1.0.0',creatorBudgetMicros:50000,serviceFeeMicros:160000,totalMicros:360000,separateTotalMicros:400000,roundingMicros:0,payee:'0x'+'b'.repeat(40),network:'eip155:5042002',quoteId:'a'.repeat(64)}}),{headers:{'content-type':'application/json'}});`);
const transport = new StdioClientTransport({ command: process.execPath,
  args: ["--import", pathToFileURL(bootstrap).href, resolve("mcp/dist/keryx-mcp.mjs")],
  env: { PATH: process.env.PATH ?? "", KERYX_BUYER_PRIVATE_KEY: `0x${"1".repeat(64)}` }, stderr: "pipe" });
const client = new Client({ name: "monthly-distribution-test", version: "1.0.0" });
try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ["evidence_draft", "paper_lookup", "ask_keryx", "keryx_wallet_status", "keryx_recover", "research_monthly", "keryx_operator_status", "profile_read", "profile_update", "history_read"].sort());
  const bibliography = tools.tools.find(tool => tool.name === "paper_lookup")!;
  assert.equal(bibliography.annotations?.readOnlyHint, true);
  assert.equal(bibliography.annotations?.destructiveHint, false);
  const operator=tools.tools.find(tool=>tool.name==="keryx_operator_status")!;
  assert.equal(operator.annotations?.readOnlyHint,true);
  assert.equal(operator.annotations?.destructiveHint,false);
  const unavailable=await client.callTool({name:"keryx_operator_status",arguments:{}});
  assert.equal(unavailable.isError,true); // Monthly JSON must not fabricate business state.
  const tool = tools.tools.find(tool => tool.name === "research_monthly")!;
  assert.equal(tool.annotations?.readOnlyHint, true);
  assert.doesNotMatch(tool.description ?? "", /Arc[- ]testnet/i);
  assert.match(tool.description ?? "", /quote/i);
  const result = await client.callTool({ name: "research_monthly", arguments: {} });
  assert.equal(result.isError, undefined);
  const text = (result.content as { type: string; text: string }[])[0].text;
  const body = JSON.parse(text); assert.equal(body.available, true); assert.equal(body.quote.requests, 4);
  assert.match(body.boundary, /never spends/);
  console.log("Built stdio MCP Monthly discovery passed with synthetic wallet and intercepted read-only HTTP (no settlement or custody writes).");
} finally { await client.close(); await rm(temporary, { recursive: true, force: true }); }
