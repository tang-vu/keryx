/** Actual compiled stdio tool and CLI entry point, closed synthetic HTTPS only; no wallet/provider/store. */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { acceptanceFixture } from "../lib/deliverable-acceptance/test-fixture.ts";
import { acceptanceSnapshotSchema } from "../lib/deliverable-acceptance/contracts.ts";
const directory = await mkdtemp(join(tmpdir(), "keryx-acceptance-transports-")); assert(resolve(directory).startsWith(resolve(tmpdir()) + sep));
const fixture = await acceptanceFixture(), snapshot = fixture.snapshot, input = fixture.input; fixture.db.close();
const bootstrap = join(directory, "transport.mjs"), records = join(directory, "requests.json"), submission = join(directory, "submission.json");
const key = `kx_live_${"1".repeat(96)}`, endpoint = `https://synthetic.example/api/me/deliverables/${snapshot.id}/acceptance`;
await writeFile(submission, JSON.stringify(input));
await writeFile(bootstrap, `import{appendFileSync}from'node:fs';import{syncBuiltinESMExports}from'node:module';import{createRequire}from'node:module';
const require=createRequire(import.meta.url),deny=()=>{throw Error('Unexpected outbound/custody capability');};
for(const module of [require('node:net'),require('node:tls')])for(const name of ['connect','createConnection'])if(name in module)module[name]=deny;
for(const module of [require('node:http'),require('node:https')])for(const name of ['request','get'])module[name]=deny;syncBuiltinESMExports();
globalThis.fetch=async(url,init)=>{
if(String(url)!==${JSON.stringify(endpoint)}||!['GET','POST'].includes(init.method)||init.redirect!=='error'||init.credentials!=='omit'||init.cache!=='no-store'||init.headers.Authorization!==${JSON.stringify(`Bearer ${key}`)})throw Error('Unexpected transport');
appendFileSync(${JSON.stringify(records)},JSON.stringify({url:String(url),method:init.method,body:init.body?JSON.parse(init.body):null})+'\\n');
if(init.method==='POST'&&JSON.stringify(JSON.parse(init.body))!==JSON.stringify(${JSON.stringify(input)}))throw Error('Unexpected submission');
return Response.json(init.method==='POST'?{...${JSON.stringify(snapshot)},revision:1,state:'accepted',reason:'',publishState:false,submittedAt:'2026-10-09T00:00:00.000Z'}:${JSON.stringify(snapshot)});};`);
const env: Record<string, string> = {};
for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "ComSpec", "PATHEXT", "LOCALAPPDATA", "USERPROFILE"]) if (process.env[name]) env[name] = process.env[name]!;
Object.assign(env, { KERYX_BASE_URL: "https://synthetic.example", KERYX_API_KEY: key, KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1",
  NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "", KERYX_WALLET_FILE: join(directory, "forbidden-wallet.json"), KERYX_PAYMENT_JOURNAL: join(directory, "forbidden-payment.json") });
try {
  const client = new Client({ name: "synthetic-acceptance-package", version: "1" }), transport = new StdioClientTransport({ command: process.execPath,
    args: ["--import", pathToFileURL(bootstrap).href, resolve("mcp/dist/keryx-mcp.mjs")], env, stderr: "pipe" });
  try {
    await client.connect(transport); const all = (await client.listTools()).tools;
    assert.deepEqual(all.filter(tool => tool.name.startsWith("deliverable_acceptance_")).map(tool => tool.name), ["deliverable_acceptance_read", "deliverable_acceptance_submit"]);
    assert(!JSON.stringify(all).includes(snapshot.originalFingerprint));
    const read = await client.callTool({ name: "deliverable_acceptance_read", arguments: { id: snapshot.id } }); assert(!read.isError); assert.deepEqual(read.structuredContent, snapshot);
    const refused = await client.callTool({ name: "deliverable_acceptance_submit", arguments: { id: snapshot.id, submission: input, owner: snapshot.wallet } }); assert(refused.isError);
    const saved = await client.callTool({ name: "deliverable_acceptance_submit", arguments: { id: snapshot.id, submission: input } }); assert(!saved.isError);
    const parsed = acceptanceSnapshotSchema.parse(saved.structuredContent); assert.equal(parsed.revisionExecution, "withheld"); assert.equal(parsed.revision, 1);
  } finally { await client.close(); }
  const execute = promisify(execFile), args = ["--import", pathToFileURL(bootstrap).href, "--import", "tsx", resolve("scripts/deliverable-acceptance.mts")];
  const read = await execute(process.execPath, [...args, "read", snapshot.id], { env, timeout: 30000, maxBuffer: 32768, windowsHide: true }); assert.deepEqual(JSON.parse(read.stdout), snapshot);
  const saved = await execute(process.execPath, [...args, "submit", snapshot.id, submission], { env, timeout: 30000, maxBuffer: 32768, windowsHide: true }); assert.equal(JSON.parse(saved.stdout).revision, 1);
  await assert.rejects(() => execute(process.execPath, [...args, "submit", snapshot.id, directory], { env, timeout: 30000, maxBuffer: 32768, windowsHide: true }), /regular UTF-8 JSON file/);
  const calls = (await readFile(records, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(calls, [{ url: endpoint, method: "GET", body: null }, { url: endpoint, method: "POST", body: input }, { url: endpoint, method: "GET", body: null }, { url: endpoint, method: "POST", body: input }]);
  assert(!(await readdir(directory)).some(file => file.startsWith("forbidden-")));
} finally {
  for (const file of await readdir(directory)) { assert(["transport.mjs", "requests.json", "submission.json"].includes(file)); await unlink(join(directory, file)); } await rmdir(directory);
}
console.log("PASS actual built stdio and CLI strict choice/read schema, identical bounded HTTPS owner-key request, input refusal and no research/custody/payment. Synthetic transport only; native execution and live delivery are not established.");
