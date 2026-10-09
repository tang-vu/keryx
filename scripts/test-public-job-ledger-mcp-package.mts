/** Built stdio + actual CLI process gate with closed loopback HTTP and no configured custody. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChildProcess } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ledgerFixture } from "../lib/operator-ledger/test-fixture.ts";
import { operatorLedgerCsv, verifyOperatorLedger } from "../lib/operator-ledger/export.ts";

const fixture = ledgerFixture(), temporary = await mkdtemp(join(tmpdir(), "keryx-public-ledger-package-"));
assert(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
let requests = 0;
const server = createServer((request, response) => {
  requests++;
  if (requests > 10 || request.method !== "GET" || request.url !== "/api/operator/ledger?days=7") { response.writeHead(403).end(); return; }
  response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "X-Keryx-Ledger-Digest": fixture.integrity.digest });
  response.end(JSON.stringify(fixture));
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const address = server.address(); assert(address && typeof address === "object"); const origin = `http://127.0.0.1:${address.port}`;
const bootstrap = join(temporary, "closed-fetch.mjs");
await writeFile(bootstrap, `const original=globalThis.fetch;globalThis.fetch=(url,opts)=>{if(new URL(url).origin!==${JSON.stringify(origin)})throw Error('External network refused');return original(url,opts)};`);
const env = { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", TEMP: temporary, TMP: temporary,
  KERYX_BASE_URL: origin, KERYX_OPERATOR_URL: origin, KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet",
  KERYX_WALLET_FILE: join(temporary, "absent-wallet.json"), KERYX_PAYMENT_JOURNAL: join(temporary, "absent-payment.json") };
const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", pathToFileURL(bootstrap).href, resolve("mcp/dist/keryx-mcp.mjs")],
  cwd: temporary, env, stderr: "pipe" });
const client = new Client({ name: "public-ledger-package-gate", version: "1.0.0" }); let child: ChildProcess | undefined;
try {
  await client.connect(transport); child = Reflect.get(transport, "_process") as ChildProcess; assert(child?.pid);
  const tools = await client.listTools(), tool = tools.tools.find(tool => tool.name === "keryx_public_job_ledger"); assert(tool);
  assert.equal(tool.annotations?.readOnlyHint, true); assert.equal(tool.inputSchema.additionalProperties, false);
  const bad = await client.callTool({ name: tool.name, arguments: { wallet: "private-selector" } }); assert.equal(bad.isError, true); assert.equal(requests, 0);
  const result = await client.callTool({ name: tool.name, arguments: {} }); assert(!result.isError);
  verifyOperatorLedger(JSON.parse((result.content as { text: string }[])[0].text), fixture.integrity.digest);
  const run = promisify(execFile), script = resolve("scripts/operator-ledger.mts"), loader = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;
  const json = await run(process.execPath, ["--import", pathToFileURL(bootstrap).href, "--import", loader, script], { cwd: temporary, env, timeout: 15_000, maxBuffer: 2_000_000 });
  verifyOperatorLedger(JSON.parse(json.stdout), fixture.integrity.digest);
  const csv = await run(process.execPath, ["--import", pathToFileURL(bootstrap).href, "--import", loader, script, "--csv", "--expect", fixture.integrity.digest],
    { cwd: temporary, env, timeout: 15_000, maxBuffer: 2_000_000 }); assert.equal(csv.stdout, operatorLedgerCsv(fixture));
  assert.equal(requests, 3);
} finally {
  try {
    child ??= Reflect.get(transport, "_process") as ChildProcess | undefined;
    await client.close();
    if (child && child.exitCode === null && child.signalCode === null) await Promise.race([once(child, "exit"), new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error("Stdio fixture exit timeout")), 5_000); timer.unref(); })]);
    assert(!child || child.exitCode !== null || child.signalCode !== null, "Stdio process exit must be observed");
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(temporary, { recursive: true, force: true });
  }
}
console.log(JSON.stringify({ gate: "public-job-ledger-built-mcp-cli", keylessPublicRead: true, privateSelectorRefused: true,
  actualCliJsonAndCsv: true, loopbackRequests: requests, observedStdioExit: true }));
