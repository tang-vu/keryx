/** Actual built stdio plus offline CLI, closed synthetic loopback and no custody. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { projectPurchaseOutcomes } from "../lib/research/purchase-outcomes-projector.ts";
import { validatePurchaseOutcomes } from "../lib/research/purchase-outcomes-contract.ts";

const source = resolve(import.meta.dirname, ".."), fixture = JSON.parse(await readFile(join(source, "fixtures/purchase-outcomes/retained-testnet.json"), "utf8"));
const report = projectPurchaseOutcomes(fixture.snapshot, "eip155:5042"), folder = await mkdtemp(join(tmpdir(), "purchase-outcomes-transports-"));
let requests = 0;
const server = createServer((request, response) => {
  requests++;
  if (requests > 2 || request.method !== "GET" || request.url !== `/api/dispatch/${report.dispatchId}/purchase-outcomes`
    || request.headers.authorization || request.headers.cookie || request.headers["payment-signature"])
    { response.writeHead(403).end(); return; }
  response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(report));
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const address = server.address(); assert(address && typeof address === "object"); const origin = `http://127.0.0.1:${address.port}`;
const bootstrap = join(folder, "closed-fetch.mjs");
await writeFile(bootstrap, `const original=globalThis.fetch;globalThis.fetch=(url,opts)=>{if(new URL(url).origin!==${JSON.stringify(origin)})throw Error('External network refused');return original(url,opts)};`);
const env = { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", TEMP: folder, TMP: folder, TSX_DISABLE_CACHE: "1",
  KERYX_BASE_URL: origin, KERYX_OPERATOR_URL: origin, KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet",
  KERYX_WALLET_FILE: join(folder, "absent-wallet.json"), KERYX_PAYMENT_JOURNAL: join(folder, "absent-payment.json") };
const transport = new StdioClientTransport({ command: process.execPath,
  args: ["--import", pathToFileURL(bootstrap).href, join(source, "mcp/dist/keryx-mcp.mjs")], cwd: folder, env, stderr: "pipe" });
const client = new Client({ name: "purchase-outcome-package-fixture", version: "1" }); let child: ChildProcess | undefined;
try {
  await client.connect(transport); child = Reflect.get(transport, "_process") as ChildProcess; assert(child?.pid);
  const tool = (await client.listTools()).tools.find(tool => tool.name === "keryx_purchase_outcomes"); assert(tool);
  assert.equal(tool.annotations?.readOnlyHint, true); assert.equal(tool.inputSchema.additionalProperties, false);
  const refused = await client.callTool({ name: tool.name, arguments: { dispatchId: report.dispatchId, wallet: "private-selector" } });
  assert.equal(refused.isError, true); assert.equal(requests, 0);
  const result = await client.callTool({ name: tool.name, arguments: { dispatchId: report.dispatchId } }); assert(!result.isError);
  assert.deepEqual(validatePurchaseOutcomes(JSON.parse((result.content as { text: string }[])[0].text), report.dispatchId), report);
  const input = join(folder, "retained.json"); await writeFile(input, JSON.stringify(fixture.snapshot));
  const cli = await promisify(execFile)(process.execPath, ["--import", pathToFileURL(bootstrap).href, "--import",
    pathToFileURL(join(source, "node_modules/tsx/dist/loader.mjs")).href, join(source, "scripts/inspect-purchase-outcomes.mts"),
    input, "--network", "eip155:5042"], { cwd: folder, env, timeout: 10_000, maxBuffer: 1024 * 1024 });
  assert.deepEqual(validatePurchaseOutcomes(JSON.parse(cli.stdout), report.dispatchId), report);
  assert.equal(requests, 1, "Offline CLI must not issue a request");
} finally {
  try {
    child ??= Reflect.get(transport, "_process") as ChildProcess | undefined;
    await client.close();
    if (child && child.exitCode === null && child.signalCode === null) await Promise.race([once(child, "exit"), new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error("Owned stdio fixture exit timeout")), 5000); timer.unref(); })]);
    assert(!child || child.exitCode !== null || child.signalCode !== null, "Actual owned stdio exit required");
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
console.log(JSON.stringify({ gate: "purchase-outcomes-built-stdio-offline-cli", loopbackRequests: requests,
  publicKeylessRead: true, privateSelectorRefused: true, offlineCliParity: true, observedStdioExit: true, evidence: folder }));
