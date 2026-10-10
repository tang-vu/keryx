/** Actual built stdio read-only recovery projection. Synthetic held journal, no configured custody. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { ChildProcess } from "node:child_process";
import { build } from "esbuild";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createReadCheckpointCapture } from "../lib/agent/read-checkpoint-capture.ts";
import { actualReadCheckpoint } from "../lib/research-audit/actual-read-policy.ts";
import { verifyActualReadPacket } from "../lib/research-audit/actual-read-record.ts";

async function bounded<T>(promise: Promise<T>, milliseconds = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Error("Owned stdio fixture deadline")), milliseconds);
  })]); } finally { clearTimeout(timer); }
}

await build({ entryPoints: ["mcp/keryx-mcp-server.mts"], bundle: true, platform: "node", format: "esm", target: "node22",
  packages: "external", outfile: "mcp/dist/keryx-mcp.mjs", logLevel: "silent" });
const folder = await mkdtemp(join(tmpdir(), "keryx-read-checkpoint-package-"));
const collector = createReadCheckpointCapture(true), check = { kind: "channel", creatorFree: false, cache: true } as const;
collector.append(check, actualReadCheckpoint(check), { candidate: 1, round: 1, proposal: "BUY", plan: "CACHE", price: 0.002 });
const capture = collector.finish(); assert(capture?.status === "available");
const queryId = `a2a_${"a".repeat(64)}`, journal = join(folder, "synthetic-held-payment.json"), bootstrap = join(folder, "closed-fetch.mjs");
let malformed = false; const requests: string[] = [];
const server = createServer((request, response) => {
  requests.push(`${request.method} ${request.url}`);
  if (requests.length > 2 || request.method !== "GET" || request.url !== `/api/agent/ask?queryId=${queryId}` ||
    request.headers["payment-signature"] || request.headers.authorization) { response.writeHead(403).end(); return; }
  response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify({ queryId, status: "completed", answer: "Synthetic retained answer", citations: [],
    creatorsPaid: null, totalToCreators: 0, feePaid: 0, readCheckpoints: malformed ? { ...capture,
      packet: { ...capture.packet, question: "synthetic-private-sentinel" } } : capture }));
});
server.maxConnections = 2; server.headersTimeout = 5000; server.requestTimeout = 5000;
server.listen(0, "127.0.0.1"); await bounded(once(server, "listening"));
const address = server.address(); assert(address && typeof address === "object"); const origin = `http://127.0.0.1:${address.port}`;
await writeFile(journal, JSON.stringify({ schema: "keryx-mcp-payment-v2", network: "eip155:5042002", origin,
  queryId, authorizationId: `0x${"1".repeat(64)}`, amountUsdc: "0.1", status: "unconfirmed" }), { flag: "wx" });
await mkdir(`${journal}.lock`); const originalJournal = await readFile(journal);
await writeFile(bootstrap, `const original=globalThis.fetch;globalThis.fetch=(input,opts)=>{const url=new URL(String(input));if(url.origin!==${JSON.stringify(origin)}||url.pathname!=="/api/agent/ask"||(opts?.method??"GET")!=="GET"||opts?.body)throw Error("External or paid transport refused");return original(input,opts)};`, { flag: "wx" });
const env = { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", TEMP: folder, TMP: folder,
  KERYX_BASE_URL: origin, KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet",
  KERYX_WALLET_FILE: join(folder, "absent-wallet.json"), KERYX_PAYMENT_JOURNAL: journal };
const transport = new StdioClientTransport({ command: process.execPath,
  args: ["--import", pathToFileURL(bootstrap).href, resolve("mcp/dist/keryx-mcp.mjs")], cwd: folder, env, stderr: "pipe" });
const client = new Client({ name: "read-checkpoint-package-fixture", version: "1.0.0" }); let child: ChildProcess | undefined;
let phase = "connect"; let childDiagnostic = "";
let initializedPackageVersion: string | undefined;
transport.stderr?.on("data", chunk => { childDiagnostic += String(chunk); assert(childDiagnostic.length <= 16_384); });
try {
  await bounded(client.connect(transport)); child = Reflect.get(transport, "_process") as ChildProcess; assert(child?.pid);
  const packageInfo = JSON.parse(await readFile("mcp/package.json", "utf8"));
  initializedPackageVersion = client.getServerVersion()?.version;
  assert.equal(initializedPackageVersion, packageInfo.version);
  phase = "valid-recovery";
  const first = await bounded(client.callTool({ name: "keryx_recover", arguments: {} })); assert(!first.isError);
  const retained = JSON.parse((first.content as { text: string }[])[0].text);
  assert(await verifyActualReadPacket(retained.data.readCheckpoints.packet, capture.retainedDigest));
  assert.equal(retained.data.readCheckpoints.retainedDigest, capture.retainedDigest); assert.equal(retained.data.answer, "Synthetic retained answer");
  malformed = true;
  phase = "unknown-recovery";
  const second = await bounded(client.callTool({ name: "keryx_recover", arguments: {} })); assert(!second.isError);
  const text = (second.content as { text: string }[])[0].text; assert(!text.includes("synthetic-private-sentinel"));
  assert.deepEqual(JSON.parse(text).data.readCheckpoints, { status: "unavailable" });
  assert.deepEqual(await readFile(journal), originalJournal); assert.equal(requests.length, 2);
} catch (error) {
  // The owned child has only fixed synthetic inputs and the explicit environment above.
  console.error(JSON.stringify({ phase, loopbackRequests: requests, ownedChildDiagnostic: childDiagnostic }));
  throw error;
} finally {
  try {
    child ??= Reflect.get(transport, "_process") as ChildProcess | undefined; await client.close();
    if (child && child.exitCode === null && child.signalCode === null) await Promise.race([once(child, "exit"), new Promise((_, reject) => {
      const timer = setTimeout(() => reject(Error("Owned stdio exit deadline")), 5000); timer.unref(); })]);
    assert(!child || child.exitCode !== null || child.signalCode !== null);
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    const owned = relative(tmpdir(), folder); assert(owned.startsWith("keryx-read-checkpoint-package-") && !owned.includes("..") && !isAbsolute(owned));
    await rm(folder, { recursive: true, force: true });
  }
}
console.log(JSON.stringify({ gate: "actual-read-built-stdio", validRetainedPacket: true, unknownPrivatePacketRefused: true,
  initializedPackageVersion, heldJournalUnchanged: true, actualOwnedChildExit: true,
  loopbackGetRequests: requests.length, fundingCalls: 0, paymentCalls: 0 }));
