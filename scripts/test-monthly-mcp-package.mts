/** Execute the built stdio distribution using synthetic key and hermetic read-only HTTP. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalJson } from "../lib/canonical-json";
import { RESEARCH_RECEIPT_SCHEMA } from "../lib/research-receipt-types";
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
  const comparisonTool = tools.tools.find(tool => tool.name === "compare_saved_research"); assert(comparisonTool);
  assert.equal(comparisonTool.annotations?.openWorldHint, false);
  const comparisonPayload = { schema: RESEARCH_RECEIPT_SCHEMA, dispatch: { question: "Synthetic local comparison" }, claims: [], citations: [] };
  const comparisonReceipt = JSON.stringify({ payload: comparisonPayload, integrity: { algorithm: "sha256", canonicalization: "keryx-json-v1", scope: "payload",
    digest: `sha256:${createHash("sha256").update(canonicalJson(comparisonPayload)).digest("hex")}` } });
  const comparison = await client.callTool({ name: comparisonTool.name, arguments: { before: comparisonReceipt, after: comparisonReceipt } });
  assert.notEqual(comparison.isError, true);
  assert.equal((comparison.structuredContent as { comparison: { sameReceipt: boolean } }).comparison.sameReceipt, true);
  const invalidComparison = await client.callTool({ name: comparisonTool.name, arguments: { before: "PRIVATE_FORBIDDEN_COMPARISON", after: comparisonReceipt } });
  assert.equal(invalidComparison.isError, true); assert(!JSON.stringify(invalidComparison).includes("PRIVATE_FORBIDDEN_COMPARISON"));
  for (const input of [{ question: "Synthetic review request", reviewFirst: true }, { question: "Synthetic review request", mode: "review-first" }, { question: "Synthetic review request", researchMode: "review-first" }]) {
    const refused = await client.callTool({ name: "ask_keryx", arguments: input });
    assert.equal(refused.isError, true); // Input validation before buyer signing/payment/provider.
  }
  assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ["evidence_draft", "research_feedback_read", "research_feedback_submit", "draft_check", "compare_saved_research", "evidence_procurement", "deliverable_acceptance_read", "deliverable_acceptance_submit", "operator_obligations_read", "paper_lookup", "ask_keryx", "ask_keryx_sponsored", "keryx_wallet_status", "keryx_recover", "research_monthly", "keryx_operator_status", "keryx_public_job_ledger", "keryx_purchase_outcomes", "keryx_source_learning", "profile_read", "profile_update", "history_read", "history_owned_read", "history_export", "history_private_jobs_list", "history_private_jobs_detail", "history_private_jobs_export", "profile_identities_read", "run_privacy_read", "run_owner_export"].sort());
  for (const name of ["run_privacy_read", "run_owner_export"]) {
    const reader = tools.tools.find(item => item.name === name)!;
    assert.equal(reader.annotations?.readOnlyHint, true);assert.equal(reader.annotations?.destructiveHint, false);
    assert.deepEqual(Object.keys(reader.inputSchema.properties ?? {}).sort(), (name === "run_owner_export" ? ["id", "requestId"] : ["id"]).sort());
    assert(!("wallet" in (reader.inputSchema.properties ?? {})));
    const refused = await client.callTool({ name, arguments: { id: "synthetic-run", ...(name === "run_owner_export" ? { requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } : {}) } });
    assert.equal(refused.isError, true); // A buyer wallet grants no history:read key or owner authority.
    assert.match(JSON.stringify(refused), /No research or payment was performed/);
  }
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
