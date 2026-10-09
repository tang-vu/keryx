/** Actual CLI process and freshly built stdio entrypoint; hermetic HTTPS response only. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { nativeInspectionFixture } from "../test-support/operator-obligations.ts";

const directory = await mkdtemp(join(tmpdir(), "keryx-obligation-transport-"));
assert(resolve(directory).startsWith(resolve(tmpdir()) + sep));
const bootstrap = join(directory, "transport.mjs"), records = join(directory, "requests.json"), expected = nativeInspectionFixture();
const key = `kx_live_${"a".repeat(96)}`;
await writeFile(bootstrap, `import{writeFileSync}from'node:fs';const calls=[];globalThis.fetch=async(url,init)=>{
if(String(url)!=='https://synthetic.example/api/operator/obligations'||init.method!=='GET'||init.redirect!=='error'||init.credentials!=='omit'||init.body!==undefined||init.headers.Authorization!=='Bearer '+process.env.KERYX_API_KEY)throw Error('Unexpected transport');
calls.push({url:String(url),method:init.method});writeFileSync(${JSON.stringify(records)},JSON.stringify(calls));
return Response.json(${JSON.stringify(expected)});};`);
const env = { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", KERYX_BASE_URL: "https://synthetic.example", KERYX_OPERATOR_URL: "https://synthetic.example",
  KERYX_API_KEY: key, KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1",
  KERYX_WALLET_FILE: join(directory, "forbidden-wallet.json"), KERYX_PAYMENT_JOURNAL: join(directory, "forbidden-payment.json") };

async function cli() {
  return new Promise<string>((accept, reject) => {
    const child = spawn(process.execPath, ["--import", pathToFileURL(bootstrap).href,
      "--import", pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href, resolve("scripts/operator-obligations.mts"), "read"],
    { cwd: directory, env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = []; let bytes = 0, stderrBytes = 0, failure = "", done = false;
    let reap: NodeJS.Timeout | undefined;
    const fail = (message: string) => {
      if (failure || done) return; failure = message; child.kill("SIGKILL");
      reap = setTimeout(() => { if (done) return; done = true; clearTimeout(deadline); child.stdout.destroy(); child.stderr.destroy(); child.unref(); reject(new Error("CLI exit unconfirmed")); }, 2000);
    };
    const deadline = setTimeout(() => fail("CLI deadline exceeded"), 20000);
    child.stdout.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 32768) fail("CLI output bound exceeded"); else stdout.push(chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 8192) fail("CLI stderr bound exceeded"); });
    child.on("error", () => fail("CLI launch refused"));
    child.on("close", (code, signal) => { if (done) return; done = true; clearTimeout(deadline); clearTimeout(reap);
      if (failure || code !== 0 || signal) reject(new Error(failure || "CLI failed")); else accept(Buffer.concat(stdout).toString("utf8")); });
  });
}
try {
  assert.deepEqual(JSON.parse(await cli()), expected);
  assert.equal(JSON.parse(await readFile(records, "utf8")).length, 1);
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", pathToFileURL(bootstrap).href, resolve("mcp/dist/keryx-mcp.mjs")], cwd: directory, env, stderr: "pipe" });
  const client = new Client({ name: "obligation-package-fixture", version: "1" }); let stderrBytes = 0;
  transport.stderr?.on("data", (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 8192) void transport.close(); });
  let childPid: number | null = null;
  try {
    await client.connect(transport); childPid = transport.pid; assert(childPid);
    const tools = await client.listTools({}, { timeout: 10000 }); assert(tools.tools.some(t => t.name === "operator_obligations_read"));
    assert(!JSON.stringify(tools).includes(expected.projection.protectedMicroUsdc));
    const result = await client.callTool({ name: "operator_obligations_read", arguments: {} }, undefined, { timeout: 10000 });
    assert(!result.isError); assert.deepEqual(result.structuredContent, expected); assert(stderrBytes <= 8192);
    assert.equal(JSON.parse(await readFile(records, "utf8")).length, 1); // New process made exactly one read, never research/retry.
  } finally { await client.close(); await transport.close(); }
  if (childPid) { let gone = false; try { process.kill(childPid, 0); } catch (error) { gone = (error as NodeJS.ErrnoException).code === "ESRCH"; } assert(gone, "stdio child exit must be observed"); }
  assert(!(await readdir(directory)).some(name => name.startsWith("forbidden-")));
  console.log("Operator obligation CLI + built stdio passed: exact synthetic HTTPS contract, scoped credential shape, outside-cwd reads, no discovery books/retries/research/wallet files, observed child exits. No install, live native cash, publication or funded proof.");
} finally { assert(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true }); }
