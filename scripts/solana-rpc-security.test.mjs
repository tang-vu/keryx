import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { webcrypto } from "node:crypto";
import { createContext, runInContext } from "node:vm";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);
const solanaRequire = createRequire(require.resolve("@solana/web3.js"));

// The exact Solana override uses ClientBrowser over HTTP, not Jayson's changed
// TCP framing. Exercise the actual SDK consumer and browser entry with synthetic
// loopback data; no signing, provider endpoint or funded account is involved.
test("Solana HTTP RPC preserves responses, prototype safety and transport failures", { timeout: 15000 }, async t => {
  const Client = solanaRequire("jayson/lib/client/browser");
  const parser = new Client((message, callback) => callback(null,
    '{"jsonrpc":"2.0","id":"parser-fixture","result":{"__proto__":{"inheritedPrivilege":true},"value":1}}',
  ));
  const parsed = await new Promise((resolve, reject) => parser.request("synthetic", [], "parser-fixture", (error, response) => error ? reject(error) : resolve(response)));
  assert.equal(Object.hasOwn(parsed.result, "__proto__"), true);
  assert.equal(parsed.result.inheritedPrivilege, undefined);
  assert.equal(Object.getPrototypeOf(parsed.result), Object.prototype);
  const { Connection } = require("@solana/web3.js");
  const requests = [];
  let mode = "version";
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 4096) request.destroy();
    });
    request.on("end", () => {
      const rpc = JSON.parse(body);
      requests.push(rpc);
      response.setHeader("Content-Type", "application/json");
      if (mode === "disconnect") return response.destroy();
      if (mode === "malformed") return response.end("{invalid");
      if (mode === "unavailable" || mode === "rate-limit") {
        response.statusCode = mode === "unavailable" ? 503 : 429;
        return response.end("synthetic transport failure");
      }
      if (mode === "rpc-error")
        return response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32000, message: "synthetic RPC failure" } }));
      const result = mode === "height" ? 123456 : JSON.parse(
        '{"solana-core":"synthetic-version","feature-set":1,"__proto__":{"inheritedPrivilege":true},"constructor":{"prototype":{"polluted":true}}}',
      );
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
    });
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const connection = new Connection(`http://127.0.0.1:${server.address().port}`, {
    commitment: "confirmed", disableRetryOnRateLimit: true,
  });
  const result = await connection.getVersion();
  assert.equal(result["solana-core"], "synthetic-version");
  assert.equal(result.inheritedPrivilege, undefined);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal({}.polluted, undefined);
  mode = "height";
  assert.equal(await connection.getBlockHeight(), 123456);
  mode = "rpc-error";
  await assert.rejects(connection.getVersion(), error => error.code === -32000 && /synthetic RPC failure/.test(error.message));
  for (const [nextMode, error] of [["malformed", /JSON|Unexpected|property/i], ["unavailable", /503/], ["rate-limit", /429/], ["disconnect", /socket|fetch|hang up|ECONN/i]]) {
    mode = nextMode;
    const before = requests.length;
    await assert.rejects(connection.getVersion(), error);
    assert.equal(requests.length, before + 1, nextMode);
  }
  assert.equal(requests.length, 7);
  const ids = new Set();
  for (const request of requests) {
    assert.equal(request.jsonrpc, "2.0");
    assert.match(request.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(ids.has(request.id), false);
    ids.add(request.id);
  }
  assert.deepEqual(requests.map(request => request.method), ["getVersion", "getBlockHeight", "getVersion", "getVersion", "getVersion", "getVersion", "getVersion"]);
});

test("Solana browser RPC entry works with native WebCrypto and its ID fallback", { timeout: 10000 }, async t => {
  const esbuild = require("esbuild");
  t.after(() => esbuild.stop());
  const entry = solanaRequire.resolve("jayson/lib/client/browser").replaceAll("\\", "/");
  const bundle = esbuild.buildSync({
    stdin: { contents: 'import Client from "./index.js"; globalThis.RpcClient = Client;', resolveDir: dirname(entry) },
    bundle: true, platform: "browser", format: "iife", target: "es2022", write: false,
  }).outputFiles[0].text;
  for (const nativeUuid of [true, false]) {
    let uuidCalls = 0, randomCalls = 0;
    const crypto = {
      ...(nativeUuid ? { randomUUID() { uuidCalls++; return webcrypto.randomUUID(); } } : {}),
      getRandomValues(bytes) { randomCalls++; return webcrypto.getRandomValues(bytes); },
    };
    // No Node globals or require: esbuild must resolve a real browser closure.
    const context = createContext({ crypto });
    runInContext(bundle, context);
    const Client = context.RpcClient;
    const messages = [];
    const client = new Client((message, callback) => {
      const request = JSON.parse(message);
      messages.push(request);
      callback(null, JSON.stringify({ jsonrpc: "2.0", id: request.id, result: JSON.parse('{"ok":true,"__proto__":{"inheritedPrivilege":true}}') }));
    });
    const call = () => new Promise((resolve, reject) => client.request("synthetic", [], (error, response) => error ? reject(error) : resolve(response)));
    const response = await call();
    await call();
    assert.equal(response.result.ok, true);
    assert.equal(response.result.inheritedPrivilege, undefined);
    assert.equal(Object.getPrototypeOf(response.result), runInContext("Object.prototype", context));
    for (const request of messages)
      assert.match(request.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.notEqual(messages[0].id, messages[1].id);
    assert.equal(uuidCalls, nativeUuid ? 2 : 0);
    assert.equal(randomCalls, nativeUuid ? 0 : 2);
  }
  const noCrypto = createContext({});
  runInContext(bundle, noCrypto);
  const client = new noCrypto.RpcClient(() => assert.fail("An unavailable ID generator must not dispatch"));
  assert.throws(() => client.request("synthetic", []), /crypto/i);
  const manual = new noCrypto.RpcClient(() => {}, { generator: () => "explicit-fixture-id" });
  assert.equal(manual.request("synthetic", []).id, "explicit-fixture-id");
});
