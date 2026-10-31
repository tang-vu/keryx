import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { runInNewContext } from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const proxyaddr = require("proxy-addr");
const { SourceMapConsumer, SourceNode } = require("source-map-js");
const redirectHttp = require("follow-redirects").http;

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
