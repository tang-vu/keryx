import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { runInNewContext } from "node:vm";
import { spawn } from "node:child_process";
import test from "node:test";
import "./solana-rpc-security.test.mjs";

const require = createRequire(import.meta.url);
const proxyaddr = require("proxy-addr");
const { SourceMapConsumer, SourceNode } = require("source-map-js");
const redirectHttp = require("follow-redirects").http;

// GHSA-378v-28hj-76wf: legacy development conversion helpers pin an older BN
// whose maskn(0) corrupts its state. Bound the worker so a regression cannot
// hang this test process while serializing or dividing the resulting zero.
test("legacy development BN instances remain usable after masking to zero", { timeout: 15000 }, async t => {
  for (const parent of ["ethjs-unit", "number-to-bn"]) {
    const parentRequire = createRequire(require.resolve(parent));
    const bnPath = parentRequire.resolve("bn.js");
    const child = spawn(process.execPath, ["--input-type=commonjs", "-e", `
      const BN = require(process.argv[1]);
      process.stdout.write("ready\\n");
      const zero = new BN(255).maskn(0);
      process.stdout.write(JSON.stringify({ decimal: zero.toString(10), quotient: zero.div(new BN(3)).toString(10), bits: zero.bitLength() }));
    `, bnPath], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    t.after(() => child.kill());
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 4000);
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (stdout.length > 4096) child.kill();
    });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-4096); });
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    }).finally(() => clearTimeout(timer));
    assert.ok(stdout.startsWith("ready\n"), `${parent} worker did not initialize: ${stderr}`);
    assert.equal(timedOut, false, `${parent} BN worker exceeded deadline`);
    assert.equal(code, 0, `${parent}: ${stderr}`);
    assert.deepEqual(JSON.parse(stdout.slice("ready\n".length)), { decimal: "0", quotient: "0", bits: 0 });
  }
});

test("legacy development integer and unit conversions retain exact values and errors", () => {
  const numberToBN = require("number-to-bn");
  const { toWei, fromWei } = require("ethjs-unit");
  const cases = [
    [0, "0"], [1, "1"], [-1, "-1"], [Number.MAX_SAFE_INTEGER, "9007199254740991"],
    [" 00123 ", "123"], ["0xff", "255"], ["-0xff", "-255"],
    ["123456789012345678901234567890", "123456789012345678901234567890"],
  ];
  for (const [input, expected] of cases) assert.equal(numberToBN(input).toString(10), expected);
  for (const input of ["1.5", "0xzz", "Infinity", undefined, null, {}, [], true])
    assert.throws(() => numberToBN(input));
  for (const [value, unit, expected] of [
    ["1", "ether", "1000000000000000000"],
    ["-1.000000000000000001", "ether", "-1000000000000000001"],
    ["123456789.123456789123456789", "ether", "123456789123456789123456789"],
    ["1.000001", "mwei", "1000001"], ["0.000000001", "gwei", "1"],
  ]) {
    assert.equal(toWei(value, unit).toString(10), expected);
    assert.equal(fromWei(expected, unit), value);
  }
  for (const input of [".", "1.2.3", "invalid", "0.0000000000000000001"])
    assert.throws(() => toWei(input, "ether"));
  assert.throws(() => toWei("1", "unknown-unit"));
});

// GHSA-rmxm-3fg6-px4f: the static adapter must not decode a routed path again
// and serve a protected file without running its prefix middleware. This is a
// synthetic dependency regression, not a claim that Keryx mounts serveStatic.
test("static adapter preserves protected prefixes and ordinary file responses", { timeout: 10000 }, async t => {
  const { Hono } = require("hono");
  const { createAdaptorServer } = require("@hono/node-server");
  const { serveStatic } = require("@hono/node-server/serve-static");
  const root = await mkdtemp(join(tmpdir(), "keryx-static-security-"));
  let server;
  t.after(async () => {
    if (server?.listening) await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, "files", "admin"), { recursive: true });
  await writeFile(join(root, "files", "admin", "private.txt"), "synthetic protected content");
  for (const name of ["public.txt", "hello world.txt", "炎.txt"])
    await writeFile(join(root, "files", name), "synthetic public content");
  const app = new Hono();
  app.use("/files/admin/*", c => c.text("Unauthorized", 401));
  app.use("/files/*", serveStatic({ root }));
  // The patch also changes HTTP response framing in getRequestListener, which
  // the SDK's Node transport imports. Exercise bodies and bodyless statuses.
  app.get("/adapter/text", c => c.text("adapter 炎"));
  app.get("/adapter/bytes", () => new Response(new Uint8Array([65, 66])));
  app.get("/adapter/blob", () => new Response(new Blob(["adapter blob"])));
  for (const status of [204, 304])
    app.get(`/adapter/${status}`, () => new Response(null, { status, headers: { "X-Adapter": "retained" } }));
  app.get("/adapter/events", () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("event: result\ndata: synthetic\n\n"));
      controller.close();
    },
  }), { headers: { "Content-Type": "text/event-stream" } }));
  server = createAdaptorServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  // Send the literal request target: a URL helper could normalize it first.
  const request = (path, method = "GET") => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port: server.address().port, path, method, agent: false }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    req.on("error", reject);
    req.setTimeout(2000, () => req.destroy(new Error("Loopback static request timed out")));
    req.end();
  });
  for (const path of ["/files/admin/private.txt", "/files/%61dmin/private.txt"])
    assert.deepEqual(await request(path).then(({ status, body }) => ({ status, body })), { status: 401, body: "Unauthorized" });
  for (const path of ["/files/%%36%31dmin/private.txt", "/files/%2561dmin/private.txt", "/files/admin%2Fprivate.txt"]) {
    const response = await request(path);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(response.body, /synthetic protected content/, path);
  }
  for (const path of ["/files/public.txt", "/files/hello%20world.txt", "/files/%E7%82%8E.txt"]) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.body, "synthetic public content", path);
    assert.match(response.headers["content-type"], /^text\/plain/);
  }
  const head = await request("/files/public.txt", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  assert.equal(Number(head.headers["content-length"]), Buffer.byteLength("synthetic public content"));
  assert.equal((await request("/files/missing.txt")).status, 404);
  for (const [path, body] of [["/adapter/text", "adapter 炎"], ["/adapter/bytes", "AB"], ["/adapter/blob", "adapter blob"]]) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.body, body, path);
    assert.equal(Number(response.headers["content-length"]), Buffer.byteLength(body), path);
    assert.equal(response.headers["transfer-encoding"], undefined, path);
  }
  for (const status of [204, 304]) {
    const response = await request(`/adapter/${status}`);
    assert.equal(response.status, status);
    assert.equal(response.body, "");
    assert.equal(response.headers["x-adapter"], "retained");
    assert.equal(response.headers["transfer-encoding"], undefined);
  }
  const events = await request("/adapter/events");
  assert.equal(events.status, 200);
  assert.equal(events.headers["content-type"], "text/event-stream");
  assert.equal(events.body, "event: result\ndata: synthetic\n\n");
});

// GHSA-mrwp-f3q8-3g9p: caller-declared custom credentials must not follow a
// cross-origin redirect when sensitiveHeaders was created in another realm.
async function redirectHeaders(t, { crossOrigin, crossRealm, arrayHeaders }) {
  const destination = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(request.headers));
  });
  const origin = createServer((request, response) => {
    if (request.url === "/final") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(request.headers));
    } else {
      response.writeHead(302, { Location: crossOrigin ? `http://127.0.0.1:${destination.address().port}/final` : "/final" });
      response.end();
    }
  });
  for (const server of [destination, origin]) {
    t.after(() => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
  }
  const sensitiveHeaders = crossRealm ? runInNewContext("['X-API-Key']") : ["X-API-Key"];
  assert.equal(Array.isArray(sensitiveHeaders), true);
  assert.equal(sensitiveHeaders instanceof Array, !crossRealm);
  const fields = { "X-API-Key": "synthetic-key", "X-Harmless": "keep", Authorization: "synthetic-auth", "Proxy-Authorization": "synthetic-proxy", Cookie: "synthetic=cookie" };
  return new Promise((resolve, reject) => {
    const request = redirectHttp.get(`http://127.0.0.1:${origin.address().port}/start`, {
      headers: arrayHeaders ? Object.entries(fields).flat() : fields,
      sensitiveHeaders, maxRedirects: 2, agent: false,
    }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("error", reject);
      response.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.setTimeout(2000, () => request.destroy(new Error("Loopback redirect timed out")));
  });
}

for (const arrayHeaders of [false, true]) {
  for (const crossRealm of [false, true]) {
    test(`cross-origin redirects strip custom and built-in credentials (${arrayHeaders ? "array" : "object"} headers, ${crossRealm ? "cross" : "same"} realm)`, { timeout: 10000 }, async t => {
      const headers = await redirectHeaders(t, { crossOrigin: true, crossRealm, arrayHeaders });
      assert.equal(headers["x-api-key"], undefined);
      assert.equal(headers.authorization, undefined);
      assert.equal(headers["proxy-authorization"], undefined);
      assert.equal(headers.cookie, undefined);
      assert.equal(headers["x-harmless"], "keep");
    });
  }
  test(`same-origin redirects retain declared custom credentials (${arrayHeaders ? "array" : "object"} headers, cross realm)`, { timeout: 10000 }, async t => {
    const headers = await redirectHeaders(t, { crossOrigin: false, crossRealm: true, arrayHeaders });
    assert.equal(headers["x-api-key"], "synthetic-key");
    assert.equal(headers.authorization, "synthetic-auth");
    assert.equal(headers.cookie, "synthetic=cookie");
    assert.equal(headers["x-harmless"], "keep");
  });
}

// GHSA-jqcg-44mw-7w3h: short IPv6 trust prefixes must not trust an unrelated
// IPv4 peer and let its forwarded header replace the actual socket origin.
test("untrusted IPv4 peers cannot supply a trusted forwarded identity", () => {
  const request = {
    socket: { remoteAddress: "203.0.113.7" },
    headers: { "x-forwarded-for": "198.51.100.44" },
  };
  for (const subnet of ["::ffff:10.0.0.0/8", "::/8"]) {
    assert.equal(proxyaddr(request, proxyaddr.compile(subnet)), "203.0.113.7");
  }
  assert.equal(
    proxyaddr(request, proxyaddr.compile(["::ffff:10.0.0.0/8", "192.0.2.0/24"])),
    "203.0.113.7",
  );
});

test("valid IPv4 and IPv6 proxy ranges retain forwarded chain behavior", () => {
  const trust = proxyaddr.compile(["10.0.0.0/8", "::ffff:10.0.0.0/104", "2001:db8:1::/48"]);
  for (const peer of ["10.0.0.7", "::ffff:10.0.0.7", "2001:db8:1::7"]) {
    assert.equal(proxyaddr({
      socket: { remoteAddress: peer },
      headers: { "x-forwarded-for": "198.51.100.44, 10.1.2.3" },
    }, trust), "198.51.100.44");
  }
  assert.equal(trust("203.0.113.7"), false);
  assert.equal(trust("2001:db8:2::7"), false);
});

const basicMap = {
  version: 3, sources: ["original.js"], names: [], mappings: "AAAA",
  sourcesContent: ["answer();\n"],
};
const indexedMap = (line, column = 0, map = basicMap) => ({
  version: 3, sections: [{ offset: { line, column }, map }],
});

// GHSA-68fv-2mgg-jv7q: reject malformed offsets at construction. Do not feed
// these offsets to SourceNode, which would perform excessive work before the fix.
test("indexed source maps reject invalid and cumulatively excessive offsets", () => {
  for (const value of [-1, 0.5, NaN, Infinity, "1", Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new SourceMapConsumer(indexedMap(value)), /offset/i);
    assert.throws(() => new SourceMapConsumer(indexedMap(0, value)), /offset/i);
  }
  assert.throws(() => new SourceMapConsumer(indexedMap(2 ** 31)), /offset/i);
  assert.throws(
    () => new SourceMapConsumer(indexedMap(6_000_000, 0, indexedMap(6_000_000))),
    /offset/i,
  );
});

test("ordinary indexed source maps and source nodes round trip", () => {
  const consumer = new SourceMapConsumer(indexedMap(1));
  assert.deepEqual(consumer.originalPositionFor({ line: 2, column: 1 }), {
    source: "original.js", line: 1, column: 0, name: null,
  });
  const node = SourceNode.fromStringWithSourceMap("\nanswer();\n", consumer);
  const output = node.toStringWithSourceMap({ file: "generated.js" });
  assert.equal(output.code, "\nanswer();\n");
  assert.deepEqual(new SourceMapConsumer(output.map.toJSON())
    .originalPositionFor({ line: 2, column: 0 }), {
    source: "original.js", line: 1, column: 0, name: null,
  });
  assert.equal(output.map.toJSON().sourcesContent[0], "answer();\n");
});
