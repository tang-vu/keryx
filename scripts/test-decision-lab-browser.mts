/** Mounted React + real browser crypto. Synthetic inputs; no app, wallets or providers. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { syntheticDecisionShowcasePacket } from "../lib/research-audit/decision-inspection.ts";
import { actualReadPacketHash } from "../lib/research-audit/actual-read-record.ts";
import { signDecisionBundle, decisionAuditTrustAnchorFromPem } from "../lib/research-audit/signed-decision-bundle-node.ts";
import { decisionLabCopy as copy } from "../lib/research-audit/decision-lab-copy.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, sourcefile: "decision-lab-fixture.tsx", loader: "tsx", contents: `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import { DecisionLab } from "./components/keryx/decision-lab";
  createRoot(document.getElementById("fixture")).render(<DecisionLab />);
  let gate;
  window.fixture = {
    defer: () => {
      const original = File.prototype.arrayBuffer;
      let release; const wait = new Promise(resolve => { release = resolve; });
      gate = { started: false, finished: false, release, restore: () => { File.prototype.arrayBuffer = original; } };
      File.prototype.arrayBuffer = async function() {
        gate.started = true; const result = await original.call(this); await wait; gate.finished = true; return result;
      };
    }, release: () => gate.release(), restore: () => gate.restore(), observed: () => ({ started: gate.started, finished: gate.finished })
  };
` }, bundle: true, write: false, platform: "browser", format: "iife", target: "es2022", metafile: true,
  define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
assert(!Object.keys(bundle.metafile!.inputs).some(path => /signed-decision-bundle-node|lib\/(db|payments|gateway)|lib\/config|node:/.test(path)), "No privileged browser import");
assert(bundle.outputFiles[0].contents.byteLength < 1_500_000);
const packet = syntheticDecisionShowcasePacket();
// Runtime round>0 run-context captures can carry a default BUY marker. That
// marker must not be presented as a model proposal for any source.
for (const row of packet.records) if (row.candidate === 0) { row.proposal = "BUY"; row.plan = "BUY"; row.round = 1; }
const digest = await actualReadPacketHash(packet);
const keys = generateKeyPairSync("ed25519"), other = generateKeyPairSync("ed25519");
const anchor = decisionAuditTrustAnchorFromPem(keys.publicKey.export({ format: "pem", type: "spki" }).toString());
const otherAnchor = decisionAuditTrustAnchorFromPem(other.publicKey.export({ format: "pem", type: "spki" }).toString());
const signed = await signDecisionBundle(packet, { signingKeyPem: keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString(), exportedAt: "2026-10-12T00:00:00.000Z" });
const requests: string[] = [], blocked: string[] = [], errors: string[] = [];
const server = createServer((request, response) => {
  requests.push(`${request.method} ${request.url}`);
  response.setHeader("Cache-Control", "no-store"); response.setHeader("Connection", "close");
  response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; connect-src 'none'; base-uri 'none'");
  if (request.method === "GET" && request.url === "/") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end('<!doctype html><html lang="en"><body><div id="fixture"></div><script src="/fixture.js"></script></body></html>');
  } else if (request.method === "GET" && request.url === "/fixture.js") {
    response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].text);
  } else response.writeHead(403).end();
});
server.maxConnections = 4; server.headersTimeout = 5_000; server.requestTimeout = 5_000;
let browser: Browser | undefined;
try {
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); assert(address && typeof address === "object"); const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true, timeout: 15_000,
    ...(process.env.KERYX_OFFLINE_BROWSER_EXECUTABLE ? { executablePath: process.env.KERYX_OFFLINE_BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", route => {
    if ([`${origin}/`, `${origin}/fixture.js`].includes(route.request().url()) && route.request().method() === "GET") return route.continue();
    blocked.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(8_000); await page.goto(origin, { waitUntil: "load", timeout: 8_000 });
  await page.getByText(copy.sample, { exact: true }).waitFor();
  for (const action of ["BUY", "SKIP", "CACHE", "ESCALATE", "STOP"]) assert(await page.getByText(action, { exact: true }).count() > 0);
  await page.getByLabel(copy.remaining, { exact: true }).fill("0");
  await page.getByRole("button", { name: copy.preview, exact: true }).click();
  await page.getByText(copy.previewScope, { exact: true }).waitFor();
  await page.getByLabel(copy.remaining, { exact: true }).fill("0.0000001");
  assert.equal(await page.getByText(copy.previewScope, { exact: true }).count(), 0);
  await page.getByRole("button", { name: copy.preview, exact: true }).click();
  await page.getByText(copy.noPreview, { exact: true }).waitFor();
  const upload = async (value: unknown) => page.getByLabel(copy.file, { exact: true }).setInputFiles({ name: "recording.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
  await upload(packet); await page.getByLabel(copy.digest, { exact: true }).fill(digest);
  await page.getByRole("button", { name: copy.inspect, exact: true }).click();
  await page.getByText(copy.recorded, { exact: true }).waitFor(); await page.getByText(copy.verified, { exact: true }).waitFor();
  const runRow = page.getByRole("row").filter({ has: page.getByText(copy.runContext, { exact: true }) });
  assert.equal(await runRow.count(), 1); assert(!/BUY/.test(await runRow.innerText()), "Run markers are not model source proposals");
  await page.getByLabel(copy.digest, { exact: true }).fill("0".repeat(64));
  assert.equal(await page.getByText(copy.verified, { exact: true }).count(), 0);
  await page.getByRole("button", { name: copy.inspect, exact: true }).click(); await page.getByText(copy.refused, { exact: true }).waitFor();
  await page.getByLabel(copy.digest, { exact: true }).fill(digest);
  await page.evaluate(() => (window as unknown as { fixture: { defer(): void } }).fixture.defer());
  await page.getByRole("button", { name: copy.inspect, exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { fixture: { observed(): { started: boolean } } }).fixture.observed().started);
  await page.getByRole("button", { name: copy.reset, exact: true }).click();
  await page.evaluate(() => (window as unknown as { fixture: { release(): void } }).fixture.release());
  await page.waitForFunction(() => (window as unknown as { fixture: { observed(): { finished: boolean } } }).fixture.observed().finished);
  await page.evaluate(() => (window as unknown as { fixture: { restore(): void } }).fixture.restore());
  await page.getByText(copy.sample, { exact: true }).waitFor(); assert.equal(await page.getByText(copy.recorded, { exact: true }).count(), 0);
  const signatureUpload = async (value: unknown) => page.getByLabel(copy.signedFile, { exact: true }).setInputFiles({ name: "signed.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
  await signatureUpload(signed); await page.getByLabel(copy.publicKey, { exact: true }).fill(anchor.publicKeySpki);
  await page.getByRole("button", { name: copy.verifySignature, exact: true }).click(); await page.getByText(copy.signedPassed, { exact: true }).waitFor();
  await page.getByLabel(copy.publicKey, { exact: true }).fill(otherAnchor.publicKeySpki);
  assert.equal(await page.getByText(copy.signedPassed, { exact: true }).count(), 0);
  await page.getByRole("button", { name: copy.verifySignature, exact: true }).click(); await page.getByText(copy.signedRefused, { exact: true }).waitFor();
  const changed = structuredClone(signed); changed.envelope.exportedAt = "2026-10-13T00:00:00.000Z";
  await signatureUpload(changed); await page.getByLabel(copy.publicKey, { exact: true }).fill(anchor.publicKeySpki);
  await page.getByRole("button", { name: copy.verifySignature, exact: true }).click(); await page.getByText(copy.signedRefused, { exact: true }).waitFor();
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []); assert.deepEqual(requests, ["GET /", "GET /fixture.js"]);
  console.log(JSON.stringify({ synthetic: true, realBrowserCrypto: true, policyPreview: true, integrityImport: true, staleImportRefused: true,
    signatureAndSeparateAnchor: true, tamperRefused: true, privilegedBrowserImports: 0, externalRequests: 0 }));
} finally {
  if (browser) await browser.close();
  if (server.listening) { const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); server.closeAllConnections(); await closed; }
}
