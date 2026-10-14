/** Built initial-document and client delivery acceptance. The SSE answer and
 * private packet are explicit synthetic transport fixtures, never payments or
 * evidence of production claim-domain enrollment. All nonfixture browser
 * networking is refused. Run after the exact source's default production build. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { privateResearchCopy as copy } from "../locales/en/run-claim-research.ts";

const source = resolve(import.meta.dirname, ".."), root = resolve(process.env.KERYX_PRIVATE_WEB_BUILT_ROOT ?? source);
await readFile(join(root, ".next/BUILD_ID"));
for (const name of [".env", ".env.local", ".env.production", ".env.production.local"])
  await assert.rejects(readFile(join(root, name)), { code: "ENOENT" });
const listener = createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
const address = listener.address(); assert(address && typeof address === "object"); const port = address.port;
await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
const origin = `http://127.0.0.1:${port}`, token = "a".repeat(64), runId = "synthetic-private-web-run";
const osKeys = new Set(["path", "systemroot", "windir", "comspec", "pathext", "temp", "tmp", "userprofile", "home"]);
const env: NodeJS.ProcessEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => osKeys.has(key.toLowerCase()))),
  NODE_ENV: "production", NODE_NO_WARNINGS: "1", NODE_OPTIONS: "", NEXT_TELEMETRY_DISABLED: "1", BASE_URL: origin,
  KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1",
  KERYX_EXTERNAL_DISCOVERY: "0", KERYX_WEB_RESEARCH: "0", KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED: "true",
  JWT_SECRET: "synthetic-private-document-fixture-key-123456789" };
// A separately qualified local harness may provide its reviewed deny-outbound
// preload. Never inherit arbitrary NODE_OPTIONS or an existing environment.
if (process.env.KERYX_PRIVATE_WEB_NETWORK_GUARD) {
  env.NODE_OPTIONS = `--require ${process.env.KERYX_PRIVATE_WEB_NETWORK_GUARD}`;
  env.KERYX_PRIVATE_WEB_LOOPBACK_PORT = String(port);
}
const child = spawn(process.execPath, [join(source, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)],
  { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let output = "", exited = false, browser: Browser | undefined;
child.stdout.on("data", value => { output = (output + String(value)).slice(-6000); });
child.stderr.on("data", value => { output = (output + String(value)).slice(-6000); });
const closed = once(child, "close").then(() => { exited = true; });
const navigation = { "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document", Accept: "text/html" };
// Node fetch correctly rewrites Sec-Fetch-Mode to cors. Use literal owned HTTP
// bytes for server header inspection; actual browser navigation is tested below.
const read = (path: string, headers: Record<string, string> = {}, method = "GET", body?: string) => new Promise<Response>((resolve, reject) => {
  const request = httpRequest(origin + path, { headers, method, timeout: 10000 }, response => {
    const parts: Buffer[] = []; let bytes = 0;
    response.on("data", value => { bytes += value.length; if (bytes > 1048576) request.destroy(new Error("Owned response bound")); else parts.push(value); });
    response.on("end", () => {
      const fields = new Headers(); for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) fields.set(key, Array.isArray(value) ? value.join(", ") : value);
      resolve(new Response(Buffer.concat(parts), { status: response.statusCode, headers: fields }));
    });
  });
  request.on("error", reject); request.on("timeout", () => request.destroy(new Error("Owned request timeout"))); request.end(body);
});
const tests: string[] = [], errors: string[] = [];
try {
  let ready = false, lastStatus = 0, lastError = "";
  for (let attempt = 0; attempt < 80 && !exited; attempt++) {
    try { const response = await read("/research/private", navigation); lastStatus = response.status; ready = response.ok; } catch (error) { lastError = error instanceof Error ? error.message : "Owned request unavailable"; }
    if (ready) break; await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready, `Owned built private server unavailable (last status ${lastStatus}, error ${lastError}): ${output}`);
  const response = await read("/research/private", navigation), html = await response.text();
  const csp = response.headers.get("content-security-policy")!;
  const nonce = csp.match(/'nonce-([A-Za-z0-9_-]{43})'/)?.[1]; assert(nonce);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer"); assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(response.headers.get("x-frame-options"), "DENY"); assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  assert(!/cloudflare|unsafe-eval|script-src[^;]*unsafe-inline|connect-src[^;]*https:/.test(csp));
  assert(html.includes(`nonce="${nonce}"`)); assert(!html.includes(token));
  assert.notEqual((await read("/research/private", navigation)).headers.get("content-security-policy"), csp);
  // Next strips Flight headers before Proxy. Real RSC/client fetches cannot
  // assert navigate/document Fetch Metadata; real prefetches are likewise not
  // initial documents. Do not mistake a forged navigation plus RSC header's
  // framework cache-busting redirect for a document-bootstrap refusal.
  const refusedNavigations: Record<string, string>[] = [{}, { RSC: "1", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty" },
    { "Next-Router-Prefetch": "1", Purpose: "prefetch", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty" }];
  for (const headers of refusedNavigations)
    assert.equal((await read("/research/private", headers)).status, 409);
  tests.push("actual built initial HTML: fresh nonce, exact private headers, RSC/prefetch/non-document refusal");
  const ticket = html.match(/"ticket":"([A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43})"/)?.[1]; assert(ticket);
  const askBody = JSON.stringify({ question: "Synthetic unadmitted claim domain", budget: 0 });
  const apiHeaders = { "Content-Type": "application/json", Origin: origin, "Sec-Fetch-Site": "same-origin", "X-Keryx-Private-Document": ticket };
  // This owned offline build has no claim-domain schema/enrollment. Admission
  // must reach that refusal before providers; never initialize the claim schema.
  const api = await read("/api/ask", apiHeaders, "POST", askBody);
  assert.equal(api.status, 503); assert.deepEqual(await api.json(), { error: "claims_unavailable" });
  const refusedApi: Record<string, string>[] = [{ Origin: "https://other.example" }, { "X-Keryx-Private-Document": "invalid" }];
  for (const extra of refusedApi) {
    const refused = await read("/api/ask", { ...apiHeaders, ...extra }, "POST", askBody);
    assert.equal(refused.status, 503); assert.deepEqual(await refused.json(), { error: "private_research_document_required" });
  }
  tests.push("actual built API: configured loopback Origin/ticket reaches unadmitted ordinary-domain refusal; wrong Origin/ticket stops earlier");
  const publicResponse = await read("/privacy"); assert(publicResponse.ok);
  assert(publicResponse.headers.get("content-security-policy")?.includes("cloudflare"));
  assert.equal(publicResponse.headers.get("cross-origin-opener-policy"), "same-origin-allow-popups");
  tests.push("public document policy remains unchanged");

  browser = await chromium.launch({ headless: true, ...(process.env.KERYX_CLAIMS_BROWSER_EXECUTABLE ? { executablePath: process.env.KERYX_CLAIMS_BROWSER_EXECUTABLE } : {}) });
  let asks = 0, claimGets = 0, inject = false, mode: "complete" | "abort" | "unavailable" = "complete";
  const wire = (status: typeof mode) => {
    const run = { id: runId, question: "Synthetic private research", answer: "Synthetic completed answer", engine: "heuristic", budget: 0,
      totalSpent: 0, totalToCreators: 0, subClaims: [], decisions: [], citations: [], trace: [], createdAt: new Date().toISOString(), paymentMode: "offline" };
    const packet = status === "unavailable" ? { version: 1, runId, status: "unavailable" } : { version: 1, runId, status: "available",
      delivery: { version: 1, claimUrl: origin + "/claim-run#" + token, expiresAt: new Date(Date.now() + 86400000).toISOString() } };
    return `event: done\ndata: ${JSON.stringify(run)}\n\nevent: private-run-claim\ndata: ${JSON.stringify(packet)}\n\n`;
  };
  const route = async (context: BrowserContext) => {
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/api/ask") {
        asks++; assert.equal(request.method(), "POST");
        assert(request.headers()["x-keryx-private-document"]); assert.equal(request.headers()["referer"], undefined);
        assert(!request.postData()?.includes(token));
        if (mode === "abort") return route.abort("failed");
        return route.fulfill({ status: 200, contentType: "text/event-stream", body: wire(mode), headers: { "cache-control": "no-store" } });
      }
      if (url.pathname === "/api/research/availability") return route.fulfill({ json: { state: "not-paused" } });
      if (url.pathname.startsWith("/api/auth/")) return route.fulfill({ status: 401, json: {} });
      if (url.pathname.startsWith("/api/")) return route.fulfill({ json: {} });
      if (url.pathname === "/claim-run") { claimGets++; assert(!url.hash && !url.search); assert.equal(request.headers()["referer"], undefined); }
      if (inject && url.pathname === "/research/private" && request.isNavigationRequest()) {
        // Playwright APIRequestContext does not generate browser Fetch Metadata.
        // Replay the owned server's literal navigate/document HTTP response;
        // only the two deliberately unapproved scripts change. The preceding
        // hard-navigation case exercises the browser's unmodified live response.
        const actual = await read("/research/private", navigation);
        assert.equal(actual.status, 200);
        const headers = Object.fromEntries(actual.headers); delete headers["content-length"]; delete headers["transfer-encoding"];
        return route.fulfill({ status: actual.status, headers, body: (await actual.text()).replace("<head>", "<head><script>window.__unapproved=true</script><script src='https://static.cloudflareinsights.com/beacon.min.js'></script>") });
      }
      return route.continue();
    });
  };
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
  await route(context);
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  // A normal anchor must create a new initial document, not a router transition.
  await page.goto(origin + "/research");
  assert.equal(await page.getByRole("link", { name: copy.entry }).getAttribute("href"), "/research/private");
  await Promise.all([page.waitForNavigation(), page.getByRole("link", { name: copy.entry }).click()]);
  await page.getByRole("textbox", { name: "What do you want to know?", exact: true }).fill("Synthetic private research");
  await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
  await page.getByRole("button", { name: copy.open, exact: true }).waitFor();
  assert((await page.content()).includes("Synthetic completed answer")); assert(!(await page.content()).includes(token));
  assert.equal(await page.locator("a[href*='#" + token + "']").count(), 0);
  assert.equal(await page.evaluate(value => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes(value), token), false);
  const popup = page.waitForEvent("popup"); await page.getByRole("button", { name: copy.open, exact: true }).click();
  const claim = await popup; await claim.waitForURL(origin + "/claim-run");
  assert.equal(await claim.evaluate(() => location.hash), ""); assert.equal(await claim.evaluate(() => window.opener), null);
  assert.equal(claimGets, 1); assert.equal(await page.getByRole("button", { name: copy.open, exact: true }).count(), 0);
  assert(!(await claim.content()).includes(token)); await claim.close();
  tests.push("built hard navigation and SSE: one private handoff, fragment stripped, no DOM/storage/public run/referrer token");

  // Reload loses the credential. A failed request and unavailable delivery do
  // not automatically rerun research or discard a completed answer.
  await page.reload(); assert.equal(await page.getByRole("button", { name: copy.open, exact: true }).count(), 0);
  mode = "abort"; await page.getByRole("textbox", { name: "What do you want to know?", exact: true }).fill("Synthetic failed transport"); await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
  await page.getByText(copy.lost, { exact: true }).waitFor(); assert.equal(asks, 2);
  mode = "unavailable"; await page.getByRole("textbox", { name: "What do you want to know?", exact: true }).fill("Synthetic unavailable delivery"); await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
  await page.getByText(copy.failed, { exact: true }).waitFor(); assert((await page.content()).includes("Synthetic completed answer")); assert.equal(asks, 3);
  tests.push("reload/request abort/unavailable completion: no recovery, no auto retry, completed answer preserved");

  inject = true; await page.reload();
  await page.getByRole("textbox", { name: "What do you want to know?", exact: true }).fill("Nonce still hydrated");
  assert.equal(await page.evaluate(() => Reflect.get(window, "__unapproved")), undefined);
  const refused = await page.evaluate(async () => (await fetch("/research/private", { headers: { RSC: "1" } })).status);
  assert.equal(refused, 409);
  await page.getByRole("button", { name: "Ask Keryx", exact: true }).click(); await page.getByText(copy.failed, { exact: true }).waitFor();
  tests.push("actual nonce permits Next hydration while blocking unapproved inline/Cloudflare injection and SPA/RSC issuance");
  // Playwright's privileged fixture transport injects a reader error after the
  // real built hook has received done + packet, but before clean EOF. This does
  // not assert a defence against privileged same-origin JavaScript.
  await page.evaluate(payload => {
    const original = window.fetch;
    window.fetch = (input, init) => {
      if (input !== "/api/ask") return original(input, init);
      window.fetch = original;
      return Promise.resolve(new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        setTimeout(() => controller.error(new Error("Synthetic lost final acknowledgement")), 100);
      } }), { headers: { "content-type": "text/event-stream" } }));
    };
  }, wire("complete"));
  await page.getByRole("textbox", { name: "What do you want to know?", exact: true }).fill("Synthetic lost acknowledgement"); await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
  await page.getByText(copy.lost, { exact: true }).waitFor();
  assert((await page.content()).includes("Synthetic completed answer"));
  assert.equal(await page.getByRole("button", { name: copy.open, exact: true }).count(), 0); assert.equal(asks, 4);
  tests.push("built hook loses packet after done on pre-EOF reader error: completed answer retained, no handoff or replay");
  assert.deepEqual(errors, []); await context.close();

  const opening = await browser.newContext({ serviceWorkers: "block" }); await route(opening);
  const parent = await opening.newPage(); await parent.goto(origin + "/privacy");
  const opened = parent.waitForEvent("popup"); await parent.evaluate(() => window.open("/research/private", "_blank"));
  const privatePage = await opened; await privatePage.waitForLoadState("domcontentloaded");
  assert.equal(await privatePage.evaluate(() => window.opener), null);
  tests.push("actual private COOP/initial bootstrap sever public opener"); await opening.close();
  const result = { format: "keryx-private-web-built-acceptance-v1", tests, asks, claimGets, errors,
    syntheticSse: true, providerCalls: false, paymentCalls: false, productionDomainAdmission: false, fundedPrivateWebQualified: false };
  if (process.env.KERYX_PRIVATE_WEB_RESULT) await writeFile(process.env.KERYX_PRIVATE_WEB_RESULT, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(result));
} finally {
  await browser?.close(); if (!exited) child.kill(); await closed;
}
