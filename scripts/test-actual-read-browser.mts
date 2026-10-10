/** Actual offline React report + browser WebCrypto. Synthetic assertions, no application authority. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { createReadCheckpointCapture } from "../lib/agent/read-checkpoint-capture.ts";
import { actualReadCheckpoint } from "../lib/research-audit/actual-read-policy.ts";
import { actualReadCopy as copy } from "../lib/research-audit/actual-read-copy.ts";
import type * as Audit from "../lib/research-audit/actual-read-record.ts";
import type { ReadCheckpointCapture } from "../lib/agent/read-checkpoint-capture.ts";

async function bounded<T>(promise: Promise<T>, milliseconds = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Error("Offline browser fixture deadline")), milliseconds);
  })]); } finally { clearTimeout(timer); }
}
const root = fileURLToPath(new URL("../", import.meta.url));
const bundled = await build({ absWorkingDir: root, stdin: { resolveDir: root, sourcefile: "actual-read-browser-fixture.tsx", loader: "tsx", contents: `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import { ReadCheckpointVerify } from "./components/keryx/read-checkpoint-verify";
  import * as audit from "./lib/research-audit/actual-read-record";
  const root = createRoot(document.getElementById("report"));
  window.fixture = { audit, mount: capture => root.render(<ReadCheckpointVerify key={capture?.retainedDigest ?? "unavailable"} capture={capture} />) };
` }, bundle: true, write: false, platform: "browser", format: "iife", target: "es2022", metafile: true,
  define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
const inputs = Object.keys(bundled.metafile!.inputs);
assert(inputs.every(input => input.includes("node_modules/react/") || input.includes("node_modules/react-dom/") ||
  input.includes("node_modules/scheduler/") || ["actual-read-browser-fixture.tsx", "components/keryx/read-checkpoint-verify.tsx",
    "lib/research-audit/actual-read-record.ts", "lib/research-audit/actual-read-policy.ts", "lib/research-audit/actual-read-copy.ts"].includes(input)), "Closed browser import graph");
assert(bundled.outputFiles[0].contents.byteLength < 1_500_000);
const collector = createReadCheckpointCapture(true), check = { kind: "channel", creatorFree: false, cache: false } as const;
collector.append(check, actualReadCheckpoint(check), { candidate: 1, round: 0, proposal: "BUY", plan: "BUY", price: 0.002 });
const capture = collector.finish(); assert(capture?.status === "available");
const requests: string[] = [], refused: string[] = [];
const server = createServer((request, response) => {
  requests.push(`${request.method} ${request.url}`);
  response.setHeader("Cache-Control", "no-store"); response.setHeader("Connection", "close");
  response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; connect-src 'none'; base-uri 'none'");
  if (request.method === "GET" && request.url === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html><body><div id="report"></div><script src="/fixture.js"></script></body></html>');
  } else if (request.method === "GET" && request.url === "/fixture.js") {
    response.setHeader("Content-Type", "text/javascript"); response.end(bundled.outputFiles[0].text);
  } else response.writeHead(403).end();
});
server.maxConnections = 4; server.headersTimeout = 5000; server.requestTimeout = 5000;
let browser: Browser | undefined;
try {
  await bounded(new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }));
  const address = server.address(); assert(address && typeof address === "object"); const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true, timeout: 15_000,
    ...(process.env.KERYX_OFFLINE_BROWSER_EXECUTABLE ? { executablePath: process.env.KERYX_OFFLINE_BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", route => {
    if ([`${origin}/`, `${origin}/fixture.js`].includes(route.request().url()) && route.request().method() === "GET") return route.continue();
    refused.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage(), errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin, { waitUntil: "load", timeout: 5000 }); await context.setOffline(true);
  type Fixture = { audit: typeof Audit; mount(capture: ReadCheckpointCapture | null): void };
  await page.evaluate(capture => (window as unknown as { fixture: Fixture }).fixture.mount(capture), capture);
  await page.getByText(copy.boundary, { exact: true }).waitFor();
  const downloaded = page.waitForEvent("download", { timeout: 5000 });
  await page.getByRole("button", { name: copy.download, exact: true }).click();
  const artifact = await downloaded; assert.equal(artifact.suggestedFilename(), "read-checkpoints.json");
  const stream = await artifact.createReadStream(); assert(stream); const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of stream) { bytes += chunk.length; assert(bytes <= 256 * 1024); chunks.push(Buffer.from(chunk)); }
  const downloadedPacket = JSON.parse(Buffer.concat(chunks).toString("utf8")); assert.deepEqual(downloadedPacket, capture.packet);
  assert(!Object.hasOwn(downloadedPacket, "retainedDigest"));
  const upload = async (value: unknown) => { await page.getByLabel(copy.choose).setInputFiles({ name: "synthetic-checkpoints.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) }); };
  await upload(downloadedPacket); await page.getByRole("button", { name: copy.verify, exact: true }).click();
  await page.getByText(copy.passed, { exact: true }).waitFor();
  const changed = structuredClone(capture.packet); changed.records[0].check = { kind: "channel", creatorFree: false, cache: true };
  changed.records[0].outcome = actualReadCheckpoint(changed.records[0].check);
  await upload(changed); await page.getByRole("button", { name: copy.verify, exact: true }).click(); await page.getByText(copy.refused, { exact: true }).waitFor();
  await upload(capture); await page.getByRole("button", { name: copy.verify, exact: true }).click(); await page.getByText(copy.refused, { exact: true }).waitFor();
  await page.getByLabel(copy.choose).setInputFiles({ name: "oversized.json", mimeType: "application/json", buffer: Buffer.alloc(256 * 1024 + 1, 32) });
  await page.getByRole("button", { name: copy.verify, exact: true }).click(); await page.getByText(copy.refused, { exact: true }).waitFor();
  const hostile = await bounded(page.evaluate(async capture => {
    const api = (window as unknown as { fixture: Fixture }).fixture.audit;
    let getters = 0;
    const accessor = structuredClone(capture.packet); Object.defineProperty(accessor.records, 0, { get() { getters++; return capture.packet.records[0]; } });
    const mutable = structuredClone(capture.packet), pending = api.verifyActualReadPacket(mutable, capture.retainedDigest);
    mutable.records[0].amounts.priceMicros = "1";
    return { actualWebCrypto: isSecureContext && typeof crypto.subtle.digest === "function",
      accessor: await api.verifyActualReadPacket(accessor, capture.retainedDigest), getters,
      mutation: await pending, unknown: await api.verifyActualReadPacket({ ...capture.packet, policy: "future" }, capture.retainedDigest),
      privateField: await api.verifyActualReadPacket({ ...capture.packet, question: "synthetic-private-sentinel" }, capture.retainedDigest) };
  }, capture));
  assert(hostile.actualWebCrypto); assert.equal(hostile.accessor, false); assert.equal(hostile.getters, 0);
  assert.equal(hostile.mutation, false); assert.equal(hostile.unknown, false); assert.equal(hostile.privateField, false);
  await page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture.mount(null));
  await page.getByText(copy.unavailable, { exact: true }).waitFor(); assert.equal(await page.getByText(copy.passed, { exact: true }).count(), 0);
  assert.deepEqual(errors, []); assert.deepEqual(refused, []); assert.deepEqual(requests.sort(), ["GET /", "GET /fixture.js"]);
  console.log(JSON.stringify({ gate: "actual-read-report-offline-browser", node: process.version, browser: browser.version(),
    actualReactReport: true, actualPacketDownload: true, separatelyRetainedDigest: true, forgedPairRefused: true, accessorNotInvoked: true,
    mutationRefused: true, unavailableReset: true, externalRequests: 0, paymentAuthority: false }));
} finally {
  try { if (browser) await bounded(browser.close(), 5000); }
  finally { if (server.listening) { const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections(); await bounded(closed, 5000); } }
}
