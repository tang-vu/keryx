import assert from "node:assert/strict";
import test from "node:test";
import { previewResponse } from "../src/preview-policy.mjs";

const secret = "x".repeat(43), env = { MIGRATION_PREVIEW_TOKEN: secret };
const request = (path, method = "GET", token = secret) => new Request(`https://preview.invalid${path}`,
  { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });

test("health explicitly refuses production readiness without invoking the application", async () => {
  const response = await previewResponse(request("/__migration/health", "GET", null), {}, () => assert.fail(), "a".repeat(40));
  const body = await response.json();
  assert.equal(body.productionReady, false); assert.equal(body.payments, "disabled");
  assert.match(response.headers.get("Cache-Control"), /no-store/);
});

test("every page and static asset requires the separate preview credential", async () => {
  for (const path of ["/", "/sources", "/_next/static/client.js", "/api/ask"]) {
    for (const token of [null, "wrong", "x".repeat(42) + "y"]) {
      const response = await previewResponse(request(path, "GET", token), env, () => assert.fail(), "a".repeat(40));
      assert.equal(response.status, 401);
    }
  }
  assert.equal((await previewResponse(request("/"), {}, () => assert.fail(), "a".repeat(40))).status, 401);
});

test("an authenticated preview cannot submit research, signatures, MCP, or writes", async () => {
  for (const path of ["/api/ask", "/api/ask/sign", "/api/sources", "/mcp", "/"]) {
    for (const method of ["POST", "PUT", "DELETE"]) {
      const response = await previewResponse(request(path, method), env, () => assert.fail(), "a".repeat(40));
      assert.equal(response.status, 503);
    }
  }
  for (const path of ["/api/health", "/api/sources", "/mcp", "/mcp/", "/%61pi/ask", "/api%2fask", "/%2561pi/ask"]) {
    assert.equal((await previewResponse(request(path), env, () => assert.fail(), "a".repeat(40))).status, 503);
  }
});

test("HEAD health returns no body", async () => {
  const response = await previewResponse(request("/__migration/health", "HEAD", null), {}, () => assert.fail(), "a".repeat(40));
  assert.equal(response.status, 200); assert.equal(await response.text(), "");
});

test("authorized pages stream through with no-store and noindex; HEAD has no body", async () => {
  for (const method of ["GET", "HEAD"]) {
    const response = await previewResponse(request("/pricing", method), env,
      () => new Response("preview", { headers: { "Content-Type": "text/html", "Cache-Control": "public, max-age=3600" } }), "a".repeat(40));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Cache-Control"), /private, no-store/);
    assert.match(response.headers.get("X-Robots-Tag"), /noindex/);
    assert.equal(await response.text(), method === "HEAD" ? "" : "preview");
  }
});
