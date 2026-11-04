import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, realpath, rm, readdir, readFile } from "node:fs/promises";
import { writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { Worker } from "node:worker_threads";
import { dependencyGraphScopes, parseDependencyAudit } from "./audit-dependency-graphs.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const from = scope => createRequire(join(root, scope, "package.json"));
const requireRoot = from(".");
const execute = promisify(execFile);
const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
const report = value => JSON.stringify({ metadata: { vulnerabilities: value } });

test("all locked graphs are covered; lower findings stay visible and CLI/errors cannot become acceptance", () => {
  assert.deepEqual(dependencyGraphScopes, [".", "desktop", "mcp", "cloudflare/migration", "cloudflare/ops-monitor", "cloudflare/source-upkeep"]);
  assert.deepEqual(parseDependencyAudit(report({ ...counts, moderate: 2, total: 2 }), 0), { counts: { ...counts, moderate: 2, total: 2 }, passed: true });
  assert.equal(parseDependencyAudit(report({ ...counts, high: 1, total: 1 }), 1).passed, false);
  assert.equal(parseDependencyAudit(report(counts), 1).passed, false);
  assert.equal(parseDependencyAudit(report(counts), null).passed, false);
  for (const raw of ["null", "[]", "{}", "unavailable", report({ ...counts, total: 1 }), report({ ...counts, high: -1 }),
    report({ ...counts, future: 0 }), JSON.stringify({ error: { code: "EHTTP" }, metadata: { vulnerabilities: counts } })]) {
    assert.throws(() => parseDependencyAudit(raw, 0));
  }
});

async function sandbox(t) {
  const directory = await mkdtemp(join(tmpdir(), "keryx-dependency-security-"));
  t.after(async () => {
    const parent = await realpath(tmpdir()), actual = await realpath(directory);
    assert(actual.startsWith(parent + sep) && actual !== parent);
    await rm(actual, { recursive: true, force: true });
  });
  return directory;
}

test("legacy solc temporary files reject traversal/type confusion and retain ordinary file cleanup", async t => {
  const temporary = requireRoot("tmp"), directory = await sandbox(t), base = join(directory, "base");
  await mkdir(base);
  for (const prefix of ["../escape", ["../escape"], Buffer.from("../escape"), { includes: () => false, toString: () => "../escape" }]) {
    assert.throws(() => temporary.fileSync({ tmpdir: base, prefix }));
  }
  assert.deepEqual(await readdir(directory), ["base"]);
  const file = temporary.fileSync({ tmpdir: base, prefix: "valid-" });
  try { assert.equal(dirname(file.name), base); writeSync(file.fd, "compiler fixture"); assert.equal(await readFile(file.name, "utf8"), "compiler fixture"); }
  finally { file.removeCallback(); }
  assert.deepEqual(await readdir(base), []);
});

test("legacy compiler ZIP extraction retains exact bounded ordinary files", async t => {
  const AdmZip = requireRoot("adm-zip"), directory = await sandbox(t), zip = new AdmZip();
  zip.addFile("nested/compiler.txt", Buffer.from("Controlled compiler artifact"));
  const parsed = new AdmZip(zip.toBuffer());
  assert.equal(parsed.getEntry("nested/compiler.txt").getData().toString(), "Controlled compiler artifact");
  parsed.extractAllTo(directory, false);
  assert.equal(await readFile(join(directory, "nested/compiler.txt"), "utf8"), "Controlled compiler artifact");
});

test("Mocha serialization preserves Date/RegExp while refusing injected executable fields", () => {
  const serialize = requireRoot("serialize-javascript");
  const ordinary = runInNewContext("(" + serialize({ date: new Date("2026-10-01T00:00:00Z"), expression: /source/giu }) + ")", {}, { timeout: 1000 });
  assert.equal(ordinary.date.toISOString(), "2026-10-01T00:00:00.000Z"); assert.equal(ordinary.expression.source, "source"); assert.equal(ordinary.expression.flags, "giu");
  for (const field of ["date", "regexp"]) {
    const marker = "__keryxDependencyExecution__", value = field === "date" ? new Date("2026-10-01T00:00:00Z") : /source/g;
    const payload = '\");globalThis.' + marker + '=true;new ' + (field === "date" ? 'Date(\"' : 'RegExp(\"');
    Object.defineProperty(value, field === "date" ? "toISOString" : "flags", field === "date" ? { value: () => payload } : { get: () => payload });
    const context = { [marker]: false };
    try { runInNewContext(serialize(value), context, { timeout: 1000 }); } catch { /* Refusal is safe; ordinary API above must still work. */ }
    assert.equal(context[marker], false);
  }
});

test("MCP URI normalization cannot activate encoded executable schemes", () => {
  const uri = from("mcp")("fast-uri");
  assert.equal(uri.normalize("https://example.org/source"), "https://example.org/source");
  for (const input of ["%6Aavascript:alert(1)", "%u006Aavascript:alert(1)"]) {
    for (const normalize of [() => uri.normalize(input), () => uri.resolve("https://example.org/", input), () => uri.parse(input).scheme]) {
      let result;
      try { result = normalize(); } catch { continue; }
      assert(!/^(?:javascript|vbscript|data)(?::|$)/iu.test(String(result)));
    }
  }
});

test("MCP IPv6 rejects a long zone suffix in a bounded worker without changing valid address parsing", { timeout: 8000 }, async () => {
  const address = from("mcp")("ip-address");
  assert.equal(address.Address6.isValid("2001:db8::1"), true);
  const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');const {createRequire}=require('node:module');
    const {Address6}=createRequire(workerData)('ip-address');parentPort.postMessage(Address6.isValid('%'.repeat(100000)+'\\n'));`,
  { eval: true, workerData: join(root, "mcp/package.json"), resourceLimits: { maxOldGenerationSizeMb: 64 } });
  try {
    const result = await new Promise((accept, reject) => {
      const timer = setTimeout(() => reject(new Error("IPv6 rejection exceeded bounded worker deadline")), 2000);
      worker.once("message", value => { clearTimeout(timer); accept(value); }); worker.once("error", error => { clearTimeout(timer); reject(error); });
    });
    assert.equal(result, false);
  } finally { await worker.terminate(); }
});

const clients = [
  ["Hardhat", join(root, "node_modules/hardhat/package.json")],
  ["verification plugin", join(root, "node_modules/@nomicfoundation/hardhat-verify/package.json")],
  ["monitor tooling", join(root, "cloudflare/ops-monitor/package.json")],
  ["upkeep tooling", join(root, "cloudflare/source-upkeep/package.json")],
];
test("legacy Hardhat and Worker HTTP clients preserve bounded request/body behavior", async t => {
  const server = createServer((_request, response) => { response.setHeader("content-type", "application/json"); response.end('{"fixture":"retained"}'); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(accept => { server.close(accept); server.closeAllConnections(); }));
  for (const [name, context] of clients) {
    const client = createRequire(context)("undici"), result = await client.request(`http://127.0.0.1:${server.address().port}/fixture`);
    assert.equal(result.statusCode, 200, name); assert.deepEqual(await result.body.json(), { fixture: "retained" }, name);
  }
});

test("malformed encoded responses cannot terminate updated client processes", { timeout: 30000 }, async t => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-length": "100", "content-encoding": "gzip, deflate, br, gzip, deflate, br" });
    response.flushHeaders(); setTimeout(() => response.destroy(), 20);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(accept => { server.close(accept); server.closeAllConnections(); }));
  const entry = `const{createRequire}=require('node:module');const client=createRequire(process.argv[1])('undici');
    (async()=>{try{const response=await client.fetch(process.argv[2]);await response.text();}catch{}await new Promise(r=>setTimeout(r,100));console.log('client-survived');})().catch(()=>{process.exitCode=1});`;
  for (const [name, context] of clients) {
    const { stdout } = await execute(process.execPath, ["--max-old-space-size=64", "-e", entry, context, `http://127.0.0.1:${server.address().port}/malformed`],
      { windowsHide: true, timeout: 5000, maxBuffer: 16384 });
    assert.match(stdout, /client-survived/u, name);
  }
});

test("upkeep configuration validation rejects oversized arrays before traversing elements", () => {
  const { z } = from("cloudflare/source-upkeep")("zod");
  let visited = 0;
  const schema = z.array(z.any().transform(value => { visited++; return value; })).max(1);
  assert.equal(schema.safeParse(Array.from({ length: 10 }, () => "fixture")).success, false);
  assert.equal(visited, 0); assert.equal(schema.safeParse(["fixture"]).success, true); assert.equal(visited, 1);
});
