/** Parent-run, already-built Next acceptance. Every credential/recipient/API row
 * below is SYNTHETIC. This is emitted UI/canonical-hook evidence, never cookie,
 * native DB, provider, membership, signing, payment or settlement authority. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { createServer, Server, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { Socket } from "node:net";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { copyNextConfigFixture, nextConfigFixtureFiles } from "../test-support/next-config-fixture";
import { chatAccountMessages as words } from "../locales/en/chat-accounts";

type Pin = { path: string; sha256: string };
type Admission = { selection: { id: string; universeCount: number; selectedCount: number; expectedResults: string[]; notRun: string[]; whole34Acceptance: false }; owner: "ROOT"; currentMainCompositionEvidence: string; buildEvidence: string;
  dist: string; output: string; port: number; buildId: string; sourcePins: Pin[]; compiledPins: Pin[] };
type NextFactory = (options: { dev: false; dir: string; hostname: string; port: number;
  httpServer: ReturnType<typeof createServer> }) => { prepare(): Promise<void>; close(): Promise<void>;
  getRequestHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  server: { getServer(): Promise<{ prepare(): Promise<void>; close(): Promise<void> }> } };
let failureOutput: string | undefined;
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
// Order-independent exact JSON comparison without raw credentials in assertions.
const bodyFingerprint = (body: unknown) => sha(JSON.stringify(body, (_key, value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value));
function inside(path: string, parent: string) {
  const part = relative(resolve(parent), resolve(path));
  return part !== "" && !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`);
}

/** Observe transport and delay only a synthetic response BODY. No shipped hook,
 * component, module, BroadcastChannel, session or auth implementation replaced. */
function observePage(markers: string[]) {
  const native = window.fetch.bind(window);
  let hold: { path: string; action: string } | undefined, release: (() => void) | undefined;
  const state = { held: 0, released: 0, bodyDone: 0, afterClear: false, paints: [] as string[],
    violations: [] as string[], logoutHints: [] as { pending: boolean; confirmed: boolean }[],
    io: [] as { path: string; method: string; fragmentEmpty: boolean }[] };
  const authObserved = [(event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail?.type === "logout") state.logoutHints.push({ pending: detail.pending, confirmed: detail.confirmed });
  }][0];
  window.addEventListener("keryx:auth", authObserved);
  const observer = new MutationObserver(() => {
    if (!state.afterClear) return;
    const text = document.querySelector('section[aria-label="Private chat account consent"]')?.textContent ?? "";
    if (markers.some(marker => text.includes(marker)) || document.querySelector('section[aria-label="Private chat account consent"] input')) {
      if (state.paints.length >= 32) throw Error("Synthetic stale paint cap");
      state.paints.push(text.slice(0, 8192));
    }
  });
  observer.observe(document, { subtree: true, childList: true, characterData: true });
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (state.io.length >= 128) throw Error("Synthetic browser IO cap");
    state.io.push({ path: url.pathname, method, fragmentEmpty: location.hash === "" });
    if (url.pathname.startsWith("/api/me/chat-accounts")) {
      if (location.hash || url.search || url.hash) state.violations.push("Credential location before chat IO");
      if (init?.credentials !== "same-origin" || init?.mode !== "same-origin" || init?.redirect !== "error"
        || init?.cache !== "no-store" || init?.referrerPolicy !== "no-referrer" || !init?.signal)
        state.violations.push("Chat request transport changed");
    }
    const response = await native(input, init);
    const action = typeof init?.body === "string" ? JSON.parse(init.body).action ?? "complete" : "GET";
    if (!hold || hold.path !== url.pathname || hold.action !== action) return response;
    hold = undefined;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 262144) throw Error("Synthetic response body cap");
    const delayed = new Response(new ReadableStream<Uint8Array>({ start(controller) {
      release = [() => { controller.enqueue(bytes); controller.close(); state.released++; release = undefined; }][0];
      state.held++;
    } }), { status: response.status, headers: response.headers });
    // Count real native JSON completion after releasing the synthetic stream.
    const json = delayed.json.bind(delayed);
    delayed.json = async () => { try { return await json(); } finally { state.bodyDone++; } };
    return delayed;
  };
  (window as unknown as { chat263: unknown }).chat263 = { state,
    holdBody(path: string, action: string) { if (hold || release) throw Error("One held body only"); hold = { path, action }; },
    cleared() { state.afterClear = true; },
    release() { if (!release) throw Error("No held body"); release(); },
    close() { release?.(); observer.disconnect(); window.removeEventListener("keryx:auth", authObserved); window.fetch = native; },
  };
}
type Observation = { state: { held: number; released: number; bodyDone: number; paints: string[];
  violations: string[]; logoutHints: { pending: boolean; confirmed: boolean }[];
  io: { path: string; method: string; fragmentEmpty: boolean }[] };
  holdBody(path: string, action: string): void; cleared(): void; release(): void; close(): void };
type FixtureWindow = Window & typeof globalThis & { chat263: Observation };
const region = (page: Page) => page.getByRole("region", { name: words["consent.sectionLabel"], exact: true });
const button = (page: Page, key: "action.load" | "action.confirm" | "action.unlink") =>
  region(page).getByRole("button", { name: words[key], exact: true });
const checkbox = (page: Page) => region(page).getByRole("checkbox", { name: words["consent.statement"], exact: true });
const notice = (page: Page, key: keyof typeof words) => region(page).getByRole("status").getByText(words[key], { exact: true });
const flush = (page: Page) => page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
// Whole-page IO includes LocaleProvider; the pinned canonical hook's no-IO
// contract is checked independently, not inferred from a global fetch count.
async function readOnlyBoundaryIo(page: Page, since: number, allowChatList: boolean) {
  const io = await page.evaluate(since => (window as FixtureWindow).chat263.state.io.slice(since), since);
  assert(io.every(call => call.method === "GET" && (
    call.path === "/api/auth/session" || call.path === "/api/me/locale-preference" ||
    allowChatList && call.path === "/api/me/chat-accounts")),
  "Only fresh read-only locale/session lookups and an explicitly permitted chat list; no mutations or other IO");
}

async function main() {
  const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
  const flags = ["dist", "output", "port", "admission", "selection"] as const, args = process.argv.slice(2);
  assert.equal(args.length, flags.length, "--dist=ABS --output=ABS --port=OWNED --admission=ABS --selection=FIXED");
  const values = Object.fromEntries(flags.map(flag => {
    const matches = args.filter(arg => arg.startsWith(`--${flag}=`)); assert.equal(matches.length, 1);
    return [flag, matches[0].slice(flag.length + 3)];
  })) as Record<typeof flags[number], string>;
  const { dist, output, admission: admissionPath, selection: selectionId } = values, port = Number(values.port);
  // Fixed allocation only: all34 original bodies remain below, byte-identical.
  // No default/all, arbitrary names, indices, ranges, filters or retries.
  const allExpectedResults: string[] = [
    "consent-list-unlink-360",
    "consent-list-unlink-1366",
    "same-wallet-channel-fresh-consent",
    "same-wallet-structured-change-fresh-consent",
    "same-wallet-logout-pending-fresh-consent",
    "same-wallet-logout-terminal-fresh-consent",
    "same-wallet-focus-fresh-consent",
    "same-wallet-logout-fresh-consent",
    "same-wallet-replacement-fresh-consent",
    "late-load-channel",
    "late-load-focus",
    "late-load-logout",
    "late-preview-channel",
    "late-preview-focus",
    "late-preview-logout",
    "late-complete-channel",
    "late-complete-focus",
    "late-complete-logout",
    "late-completion-refresh-channel",
    "late-completion-refresh-focus",
    "late-completion-refresh-logout",
    "late-unlink-channel",
    "late-unlink-focus",
    "late-unlink-logout",
    "late-unlink-refresh-channel",
    "late-unlink-refresh-focus",
    "late-unlink-refresh-logout",
    "anonymous-token-free-enrollment-fresh-preview-checkbox",
    "private-reload-refusal-401",
    "private-reload-refusal-409",
    "private-reload-refusal-503",
    "preview-static-refusal-410",
    "preview-static-refusal-503",
    "unknown-fragment-refused"
];
  const selectionRanges = {
    remaining16: [18, 34],
    "refresh-initial9": [0, 9],
    "refresh-late9": [9, 18],
  } as const;
  assert(Object.prototype.hasOwnProperty.call(selectionRanges, selectionId), "One fixed finite selection only");
  const [selectionStart, selectionEnd] = selectionRanges[selectionId as keyof typeof selectionRanges];
  const expectedResults = allExpectedResults.slice(selectionStart, selectionEnd);
  const selection = { id: selectionId, universeCount: 34, selectedCount: expectedResults.length, expectedResults,
    notRun: allExpectedResults.filter(id => !expectedResults.includes(id)), whole34Acceptance: false };
  assert.equal(allExpectedResults.length, 34); assert.equal(new Set(allExpectedResults).size, 34);
  const selected = (id: string) => { assert(allExpectedResults.includes(id), "Unknown original scenario"); return expectedResults.includes(id); };
  assert(isAbsolute(dist) && isAbsolute(output) && isAbsolute(admissionPath));
  assert(Number.isInteger(port) && port >= 1024 && port <= 65535);
  const actualRoot = await realpath(root), actualDist = await realpath(dist), actualOutput = await realpath(output);
  assert(inside(output, join(root, "output")) && inside(actualOutput, join(actualRoot, "output")), "Own output, no foreign junction");
  assert(inside(dist, root) && inside(actualDist, actualRoot), "Only this worktree's admitted build");
  assert(actualDist !== actualOutput && !inside(actualDist, actualOutput) && !inside(actualOutput, actualDist));
  assert(inside(admissionPath, output) && inside(await realpath(admissionPath), actualOutput));
  for (const [name, leaf] of [["TEMP", "temp"], ["TMP", "temp"], ["TSX_CACHE_DIR", "tsx-cache"]] as const) {
    assert.equal(resolve(process.env[name] ?? ""), resolve(output, leaf), `Parent binds ${name}`);
    const directory = await lstat(join(output, leaf));
    assert(directory.isDirectory() && !directory.isSymbolicLink(), `Physical ${name} directory, no reparse link`);
    assert.equal(await realpath(join(output, leaf)), join(actualOutput, leaf), `Canonical ${name} leaf inside actual output`);
  }
  failureOutput = output;
  const require = createRequire(import.meta.url); assert.equal(require("next/package.json").version, "16.4.1");
  const pinnedPaths = [...new Set([...nextConfigFixtureFiles, "package-lock.json", "instrumentation.ts",
    "test-support/next-config-fixture.ts", "app/me/chat-accounts/page.tsx", "app/account/page.tsx",
    "components/keryx/chat-account-links.tsx", "components/keryx/site-header.tsx", "components/keryx/wallet-menu.tsx",
    "components/keryx/account-membership-workspace.tsx", "locales/en/account-membership.ts", "lib/accounts/contracts.ts",
    "locales/en/chat-accounts.ts", "lib/hooks/use-siwe-auth.ts", "lib/browser-auth-notice.ts", "lib/circle-wallet-browser.ts",
    "lib/chat-accounts/consent-ui.test.ts", "scripts/test-browser-chat-accounts263-built.mts"])].sort();
  async function sourcePins() { return Promise.all(pinnedPaths.map(async path => ({ path, sha256: sha(await readFile(join(root, path))) }))); }
  // Whole admitted emitted tree: includes imported chunks, not only entry stubs.
  async function compiledPins() {
    const pins: Pin[] = [];
    async function walk(dir: string, prefix = "") {
      for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        assert(!entry.isSymbolicLink(), "No compiled-tree symlinks");
        const path = prefix + entry.name, absolute = join(dir, entry.name);
        assert(inside(await realpath(absolute), actualDist));
        if (entry.isDirectory()) await walk(absolute, `${path}/`);
        else { assert(entry.isFile()); assert(pins.length < 50000); pins.push({ path, sha256: sha(await readFile(absolute)) }); }
      }
    }
    await walk(dist); return pins.sort((a, b) => a.path.localeCompare(b.path));
  }
  const beforeSources = await sourcePins(), beforeCompiled = await compiledPins();
  const admission = JSON.parse(await readFile(admissionPath, "utf8")) as Admission;
  assert.deepEqual(admission.selection, selection, "Parent binds selected scope and ordered expected results"); assert.equal(admission.owner, "ROOT"); assert(admission.buildEvidence?.trim()); assert(admission.currentMainCompositionEvidence?.trim());
  assert.equal(resolve(admission.dist), resolve(dist)); assert.equal(resolve(admission.output), resolve(output)); assert.equal(admission.port, port);
  assert.deepEqual(admission.sourcePins, beforeSources); assert.deepEqual(admission.compiledPins, beforeCompiled);
  const buildId = (await readFile(join(dist, "BUILD_ID"), "utf8")).trim(); assert(buildId && buildId.length <= 128); assert.equal(admission.buildId, buildId);
  const appPaths = JSON.parse(await readFile(join(dist, "server/app-paths-manifest.json"), "utf8"));
  for (const path of ["chat-accounts", "account"]) {
    const route = path === "account" ? "/account/page" : "/me/chat-accounts/page";
    assert.equal(appPaths[route], path === "account" ? "app/account/page.js" : "app/me/chat-accounts/page.js");
  }
  assert((await readFile(join(dist, "server/app/me/chat-accounts/page_client-reference-manifest.js"), "utf8")).includes("chat-account-links"));
  const hook = await readFile(join(root, "lib/hooks/use-siwe-auth.ts"), "utf8");
  assert.equal(sha(hook.replace(/\r\n/g, "\n")), "799543e93f6bf70a93fab249d232aaf0ac889b1cd360aea5488870af732ea519",
    "Ordinary composition must consume the reviewed ae0eae3 canonical hook contract");
  const authNotice = await readFile(join(root, "lib/browser-auth-notice.ts"), "utf8");
  assert.equal(sha(authNotice.replace(/\r\n/g, "\n")), "ec8c269bc30e0528c241334057e6584466fd13dca6d7186cabc20fac044911f3",
    "Reviewed ae0eae3 own-change/foreign invalidation contract; changed source requires review");
  const run = join(output, "run"), fixture = join(output, "runtime"), origin = `http://127.0.0.1:${port}`;
  // Public synthetic values; proof is format-shaped, not an HMAC authority claim.
  const token = "a".repeat(64), wallet = `0x${"a".repeat(40)}`, account = { accountId: `acct_${"b".repeat(64)}`, revision: 1 };
  const recipient = { platform: "slack", scope: "TSYNTHETIC", userId: "USYNTHETIC", channel: "DSYNTHETIC" };
  const list = "/api/me/chat-accounts", complete = `${list}/complete`;
  const pastRuns = { status: "unavailable", reason: "No verified retained chat-user provenance exists for historical runs." };
  const markers = [account.accountId, recipient.scope, recipient.userId, words["notice.linked"], words["notice.unlinked"]];
  const failures: string[] = [], externalAttempts: string[] = [], pageErrors: string[] = [], results: string[] = [], httpRequests: string[] = [];
  let app: ReturnType<NextFactory> | undefined, browser: Browser | undefined, mainFailure: unknown, preloadPromise: Promise<void> | undefined;
  let actualNext: Awaited<ReturnType<ReturnType<NextFactory>["server"]["getServer"]>> | undefined;
  let mainFailed = false, browserClosed = false, httpDrained = false, appClosed = false, instrumentationClosed = false, tracesFlushed = false;
  const cleanupFailures: unknown[] = [], contexts = new Set<BrowserContext>(), previousEnvironment = { ...process.env }, previousCwd = process.cwd();
  const nativeFetch = globalThis.fetch, nativeConnect = Socket.prototype.connect;
  const nativeListen = Server.prototype.listen, listeners = new Set<Server>();
  let privateHttpDrained = false;
  const assets = new Set(beforeCompiled.filter(pin => pin.path.startsWith("static/")).map(pin => `/_next/${pin.path}`));
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.host, new URL(origin).host); assert(httpRequests.length < 2048);
      const url = new URL(req.url!, origin); assert(!url.href.includes(token)); assert(!(req.headers.referer ?? "").includes(token));
      httpRequests.push(`${req.method} ${url.pathname}`); assert.equal(req.method, "GET");
      assert(!url.pathname.startsWith("/api/"), "Every API must be browser-intercepted");
      if (req.headers["next-router-prefetch"] === "1" && !["/me/chat-accounts", "/account"].includes(url.pathname) && !assets.has(url.pathname)) {
        res.writeHead(503, { "Cache-Control": "no-store" }); res.end(); return;
      }
      assert(["/me/chat-accounts", "/account", "/favicon.ico"].includes(url.pathname) || assets.has(url.pathname), "Finite page/assets only");
      assert(app); await app.getRequestHandler()(req, res);
    } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  server.headersTimeout = 5000; server.requestTimeout = 10000; server.keepAliveTimeout = 500;

  async function scenario(width: number, initialStatus = 200, previewStatus = 200) {
    assert(browser); const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
    contexts.add(context); context.setDefaultTimeout(10000); context.setDefaultNavigationTimeout(10000);
    let status = initialStatus, signedIn = initialStatus !== 401, linked = false, previews = 0, expiresAt = 0, proof = "", gateReads = false;
    let releaseReads!: () => void; const readGate = new Promise<void>(done => { releaseReads = done; });
    const calls: { path: string; method: string; action: string }[] = [];
    const issuedAt = Date.now(); expiresAt = issuedAt + 300000; proof = `${expiresAt}.${"c".repeat(64)}`;
    context.on("page", page => {
      page.on("pageerror", error => pageErrors.push(error.message));
      page.on("console", message => { if (message.text().includes(token)) failures.push("Synthetic token in console"); });
    });
    await context.addInitScript(observePage, markers);
    await context.routeWebSocket("**/*", socket => { failures.push("Unexpected browser WebSocket"); socket.close(); });
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { externalAttempts.push(`${request.method()} ${url.origin}`); await route.abort("blockedbyclient"); return; }
      try {
        assert(!url.href.includes(token)); assert(!(request.headers().referer ?? "").includes(token)); assert.equal(url.searchParams.has("token"), false);
        const json = (body: unknown, code = 200) => route.fulfill({ status: code, contentType: "application/json",
          headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }, body: JSON.stringify(body) });
        if (url.pathname === "/api/auth/session") { assert.equal(request.method(), "GET"); await json({ session: signedIn ? { address: wallet, role: "asker" } : null }); return; }
        if (url.pathname === "/api/account/membership") {
          assert.equal(request.method(), "GET", "Enrollment writes/signatures are outside synthetic UI acceptance");
          assert.equal(url.search, "");
          await json({ error: "account_unauthenticated" }, 401); return;
        }
        if (["/api/me/locale-preference", "/api/payments", "/maintenance/status"].includes(url.pathname)) {
          assert.equal(request.method(), "GET"); await json({ error: "Synthetic incidental consumer unavailable" }, 503); return;
        }
        if (url.pathname === list || url.pathname === complete) {
          assert.equal(url.search, ""); assert(calls.length < 128);
          const method = request.method(), body = method === "POST" ? request.postDataJSON() : undefined;
          const action = body?.action ?? (method === "GET" ? "GET" : "complete"); calls.push({ path: url.pathname, method, action });
          if (method === "GET") {
            assert.equal(url.pathname, list); if (gateReads) await readGate;
            if (status !== 200) { await json({ error: status === 401 ? "unauthorized" : status === 409 ? "explicit_account_membership_required" : "chat_unavailable" }, status); return; }
            await json({ account, links: linked ? [{ ...recipient, linkedAt: issuedAt }] : [], pastRuns }); return;
          }
          assert.equal(method, "POST"); assert.equal(request.headers()["content-type"], "application/json");
          assert.equal(status, 200); assert(signedIn);
          if (action === "preview") {
            assert.equal(url.pathname, list);
            assert.equal(bodyFingerprint(body), bodyFingerprint({ action: "preview", token }), "Exact synthetic preview body"); previews++;
            if (previewStatus !== 200) { await json({ error: previewStatus === 410 ? "chat_token_invalid" : "chat_unavailable" }, previewStatus); return; }
            assert(Date.now() < expiresAt); assert.equal(expiresAt - issuedAt, 300000);
            await json({ recipient, account, expiresAt, consentProof: proof, pastRuns: { status: "unavailable" } }); return;
          }
          if (action === "complete") {
            assert.equal(url.pathname, complete); assert(Date.now() < expiresAt);
            const expected = { token, ...account, consentProof: proof,
              consent: { version: 1, linkFutureRuns: true, financialAuthorityUnchanged: true }, pastRunIds: [] };
            assert.equal(bodyFingerprint(body), bodyFingerprint(expected), "Exact synthetic completion body");
            linked = true; await json({ linked: true, platform: recipient.platform, pastRuns: { status: "unavailable" } }); return;
          }
          assert.equal(url.pathname, list); assert.equal(action, "unlink");
          assert.deepEqual(body, { action: "unlink", recipient, ...account }); linked = false; await json({ unlinked: true }); return;
        }
        assert(!url.pathname.startsWith("/api/"), "Unknown/financial/provider API refused");
        assert.equal(request.method(), "GET"); await route.continue();
      } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); await route.abort("failed"); }
    });
    return { context, calls, previews: () => previews, gate() { gateReads = true; }, releaseReads,
      authority(code: number) { status = code; signedIn = code !== 401; } };
  }
  async function closeContext(context: BrowserContext) {
    const errors: unknown[] = [];
    for (const page of context.pages()) if (!page.isClosed()) {
      try { await page.evaluate(() => (window as FixtureWindow).chat263?.close()); } catch (error) { errors.push(error); }
      try { await page.close(); } catch (error) { errors.push(error); }
    }
    try { await context.close(); contexts.delete(context); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "Chat263 pages/context cleanup");
  }
  async function finishScenario(s: { context: BrowserContext; releaseReads(): void }, bodyErrors: unknown[]) {
    s.releaseReads();
    try { if (contexts.has(s.context)) await closeContext(s.context); }
    catch (error) {
      if (bodyErrors.length) throw new AggregateError([...bodyErrors, error], "Chat263 scenario and cleanup failure", { cause: bodyErrors[0] });
      throw error;
    }
  }
  async function open(context: BrowserContext, fragment = `token=${token}`) {
    const page = await context.newPage(); const response = await page.goto(`${origin}/me/chat-accounts${fragment ? `#${fragment}` : ""}`);
    assert.equal(response?.status(), 200); await button(page, "action.load").waitFor();
    await page.waitForFunction(() => location.hash === "");
    assert.equal(new URL(page.url()).search, "");
    const html = await response.text(); assert(!html.includes(token), "No credential in server props/HTML");
    return page;
  }
  async function preview(page: Page) {
    await notice(page, "notice.preview").waitFor(); assert.equal(await checkbox(page).isChecked(), false);
    assert.equal(await button(page, "action.confirm").isDisabled(), true);
    await region(page).getByText(`${words["preview.accountLabel"]}${account.accountId}`, { exact: true }).waitFor();
  }
  async function privateCleared(page: Page) {
    assert.equal(await checkbox(page).count(), 0); assert.equal(await button(page, "action.confirm").count(), 0);
    const text = await region(page).innerText(); for (const marker of markers) assert(!text.includes(marker));
    assert(!text.includes(token));
  }
  async function safePage(page: Page) {
    const state = await page.evaluate(() => (window as FixtureWindow).chat263.state);
    assert.deepEqual(state.violations, []);
    assert(state.io.every(io => io.fragmentEmpty), "Fragment must be scrubbed before ANY browser fetch, including canonical session consumers");
    assert.equal(await page.evaluate(value => [localStorage, sessionStorage].every(storage =>
      Array.from({ length: storage.length }, (_, index) => storage.key(index)).every(key => key === null || !`${key}${storage.getItem(key)}`.includes(value))), token), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  async function invalidate(page: Page, peer: Page, boundary: "channel" | "structured-change" | "logout-pending" | "logout-terminal" | "focus" | "logout" | "replacement") {
    // Arm before dispatch: MutationObserver records any later private paint.
    await page.evaluate(() => (window as FixtureWindow).chat263.cleared());
    if (boundary === "channel") await peer.evaluate(() => { const channel = new BroadcastChannel("keryx-auth-v1"); channel.postMessage("changed"); channel.close(); });
    else if (boundary === "structured-change" || boundary === "logout-pending" || boundary === "logout-terminal") await peer.evaluate(boundary => {
      const channel = new BroadcastChannel("keryx-auth-v1");
      channel.postMessage(boundary === "structured-change" ? { type: "changed", source: "chat263-synthetic-foreign" }
        : { type: "logout", source: "chat263-synthetic-foreign", sequence: 1, pending: boundary === "logout-pending", confirmed: true });
      channel.close();
    }, boundary);
    else await page.evaluate(boundary => {
      if (boundary === "focus") window.dispatchEvent(new Event("focus"));
      else window.dispatchEvent(new CustomEvent("keryx:auth", { detail: boundary === "logout" ? "signed-out" : "changed" }));
    }, boundary);
    await notice(page, "notice.authChanged").waitFor(); await privateCleared(page);
  }
  try {
    await mkdir(run); await mkdir(fixture);
    await cp(dist, join(fixture, ".next"), { recursive: true, dereference: true, force: false, errorOnExist: true });
    await copyNextConfigFixture(root, fixture);
    await symlink(join(root, "node_modules"), join(fixture, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    await mkdir(join(fixture, "data")); // Empty disposable runtime DB only, boot behavior unchanged.
    const environment: NodeJS.ProcessEnv = { NODE_ENV: "production", NODE_OPTIONS: "", BASE_URL: origin,
      NEXT_TELEMETRY_DISABLED: "1", KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1",
      KERYX_EXTERNAL_DISCOVERY: "0", KERYX_WEB_RESEARCH: "0", KERYX_REGISTRY_ADDRESS: "", NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS: "",
      KERYX_RPC_WS_URL: "", TEMP: join(output, "temp"), TMP: join(output, "temp"), TSX_CACHE_DIR: join(output, "tsx-cache") };
    for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE"])
      if (previousEnvironment[name]) environment[name] = previousEnvironment[name];
    for (const name of Object.keys(process.env)) delete process.env[name]; Object.assign(process.env, environment); process.chdir(fixture);
    globalThis.fetch = (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      assert.equal(url.origin, origin, "Server outbound fetch refused"); assert(!url.pathname.startsWith("/api/")); return nativeFetch(input, init);
    };
    Socket.prototype.connect = function (this: Socket, ...args: any[]) {
      const input = Array.isArray(args[0]) ? args[0] : args;
      const options = typeof input[0] === "object" ? input[0] : { port: input[0], host: input[1] };
      assert.equal(options.host ?? options.hostname, "127.0.0.1", "Server outbound TCP/pipe refused"); assert.equal(Number(options.port), port);
      return Reflect.apply(nativeConnect, this, args);
    } as typeof nativeConnect;
    // Observe original HTTP listener creation, including any Next private listener.
    // Nothing is redirected, substituted, force-closed or detached.
    Server.prototype.listen = function (this: Server, ...args: any[]) {
      listeners.add(this); return Reflect.apply(nativeListen, this, args);
    } as typeof nativeListen;
    await new Promise<void>((done, fail) => { server.once("error", fail); server.listen(port, "127.0.0.1", done); });
    const prototype = require("next/dist/server/next-server").default.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "unstable_preloadEntries");
    assert(descriptor && typeof descriptor.value === "function" && descriptor.configurable);
    const preloads = new WeakMap<object, Promise<void>>();
    Object.defineProperty(prototype, "unstable_preloadEntries", { ...descriptor, value: function (this: object, ...args: unknown[]) {
      assert(!preloads.has(this)); const promise = Reflect.apply(descriptor.value, this, args) as Promise<void>;
      preloads.set(this, promise); preloadPromise = promise; return promise;
    } });
    try {
      app = (require("next") as NextFactory)({ dev: false, dir: fixture, hostname: "127.0.0.1", port, httpServer: server });
      await app.prepare(); const actual = await app.server.getServer(); actualNext = actual; await actual.prepare();
      assert(preloads.get(actual), "Actual original compiled preload observed"); await preloads.get(actual);
    } finally { Object.defineProperty(prototype, "unstable_preloadEntries", descriptor); }
    browser = await chromium.launch({ headless: true });
    for (const width of [360, 1366]) {
      if (!selected(`consent-list-unlink-${width}`)) continue;
      const s = await scenario(width), bodyErrors: unknown[] = [];
      try {
        const page = await open(s.context); await preview(page);
        assert.equal(s.calls.filter(call => call.action === "complete").length, 0);
        await button(page, "action.load").click(); await preview(page); assert.equal(s.previews(), 2);
        await checkbox(page).check(); await button(page, "action.confirm").click(); await notice(page, "notice.linked").waitFor();
        assert.equal(await checkbox(page).count(), 0); await button(page, "action.unlink").waitFor();
        await region(page).getByText(words["history.unavailable"], { exact: true }).waitFor();
        await button(page, "action.unlink").click(); await notice(page, "notice.unlinked").waitFor();
        assert.equal(await button(page, "action.unlink").count(), 0); assert.equal(s.calls.filter(call => call.action === "complete").length, 1);
        await safePage(page); await page.screenshot({ path: join(run, `synthetic-consent-${width}.png`), fullPage: true }); results.push(`consent-list-unlink-${width}`);
      } catch (error) { bodyErrors.push(error); throw error; } finally { await finishScenario(s, bodyErrors); }
    }
    // Native two-page notice + direct focus/logout/replacement, including same wallet.
    for (const boundary of ["channel", "structured-change", "logout-pending", "logout-terminal", "focus", "logout", "replacement"] as const) {
      if (!selected(`same-wallet-${boundary}-fresh-consent`)) continue;
      const s = await scenario(1366), bodyErrors: unknown[] = [];
      try {
        const page = await open(s.context), peer = await open(s.context, ""); await preview(page); await notice(peer, "notice.listed").waitFor();
        await checkbox(page).check(); const before = s.previews(); s.gate();
        const ioBefore = await page.evaluate(() => (window as FixtureWindow).chat263.state.io.length);
        await invalidate(page, peer, boundary);
        if (["channel", "structured-change", "logout-pending", "logout-terminal"].includes(boundary)) {
          await flush(page);
          await readOnlyBoundaryIo(page, ioBefore, boundary === "channel" || boundary === "structured-change");
        }
        if (boundary === "logout-pending" || boundary === "logout-terminal") {
          assert.deepEqual(await page.evaluate(() => (window as FixtureWindow).chat263.state.logoutHints),
            [{ pending: boundary === "logout-pending", confirmed: false }], "Peer confirmation is normalized to unconfirmed");
          if (boundary === "logout-pending") {
            const pendingIoBefore = await page.evaluate(() => (window as FixtureWindow).chat263.state.io.length);
            const pendingCallsBefore = s.calls.length;
            await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await flush(page);
            await readOnlyBoundaryIo(page, pendingIoBefore, false);
            assert.equal(s.calls.length, pendingCallsBefore, "Pending peer logout fences chat IO, including on focus; LocaleProvider may perform read-only lookups");
            await peer.evaluate(() => {
              const channel = new BroadcastChannel("keryx-auth-v1");
              channel.postMessage({ type: "logout", source: "chat263-synthetic-foreign", sequence: 2, pending: false, confirmed: true }); channel.close();
            });
            await page.waitForFunction(() => (window as FixtureWindow).chat263.state.logoutHints.some(hint => !hint.pending));
            assert((await page.evaluate(() => (window as FixtureWindow).chat263.state.logoutHints)).every(hint => !hint.confirmed));
          }
        }
        s.releaseReads();
        if (boundary === "logout-pending" || boundary === "logout-terminal") {
          const recoveryIoBefore = await page.evaluate(() => (window as FixtureWindow).chat263.state.io.length);
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          // A new lookup after this focus; its consumer is not inferred from the endpoint.
          await page.waitForFunction(before => (window as FixtureWindow).chat263.state.io.slice(before)
            .some(io => io.path === "/api/auth/session" && io.method === "GET"), recoveryIoBefore);
        }
        if (boundary === "logout") await button(page, "action.load").click();
        await notice(page, "notice.listed").waitFor(); await privateCleared(page); assert.equal(s.previews(), before);
        assert.equal(s.calls.filter(call => call.action === "complete").length, 0);
        // Established token destroyed: new private intake, fresh preview and unchecked consent.
        await closeContext(s.context);
        const fresh = await scenario(1366), freshErrors: unknown[] = [];
        try { const freshPage = await open(fresh.context); await preview(freshPage); assert.equal(fresh.previews(), 1); await safePage(freshPage); }
        catch (error) { freshErrors.push(error); throw error; } finally { await finishScenario(fresh, freshErrors); }
        results.push(`same-wallet-${boundary}-fresh-consent`);
      } catch (error) { bodyErrors.push(error); throw error; } finally { await finishScenario(s, bodyErrors); }
    }
    for (const phase of ["load", "preview", "complete", "completion-refresh", "unlink", "unlink-refresh"] as const) {
      for (const boundary of ["channel", "focus", "logout"] as const) {
        if (!selected(`late-${phase}-${boundary}`)) continue;
        const s = await scenario(1366), bodyErrors: unknown[] = [];
        try {
          const page = await open(s.context), peer = await open(s.context, ""); await preview(page); await notice(peer, "notice.listed").waitFor();
          if (phase.startsWith("unlink")) {
            await checkbox(page).check(); await button(page, "action.confirm").click(); await notice(page, "notice.linked").waitFor();
          }
          const path = phase === "complete" ? complete : list;
          const action = phase === "preview" ? "preview" : phase === "complete" ? "complete" : phase === "unlink" ? "unlink" : "GET";
          await page.evaluate(({ path, action }) => (window as FixtureWindow).chat263.holdBody(path, action), { path, action });
          if (phase === "load" || phase === "preview") await button(page, "action.load").click();
          else if (phase.startsWith("completion") || phase === "complete") { await checkbox(page).check(); await button(page, "action.confirm").click(); }
          else await button(page, "action.unlink").click();
          await page.waitForFunction(() => (window as FixtureWindow).chat263.state.held === 1);
          s.gate(); if (boundary === "logout") s.authority(401); else s.authority(503);
          await invalidate(page, peer, boundary); const count = s.calls.length;
          await page.evaluate(() => (window as FixtureWindow).chat263.release());
          await page.waitForFunction(() => (window as FixtureWindow).chat263.state.bodyDone === 1); await flush(page);
          await privateCleared(page); assert.equal(s.calls.length, count, "Late body cannot start private follow-up IO");
          assert.deepEqual(await page.evaluate(() => (window as FixtureWindow).chat263.state.paints), []);
          s.releaseReads();
          if (boundary !== "logout") await notice(page, "error.unconfirmed").waitFor();
          await privateCleared(page); await safePage(page); results.push(`late-${phase}-${boundary}`);
        } catch (error) { bodyErrors.push(error); throw error; } finally { await finishScenario(s, bodyErrors); }
      }
    }
    if (selected("anonymous-token-free-enrollment-fresh-preview-checkbox")) {
    const anonymous = await scenario(360, 401), anonymousErrors: unknown[] = [];
    try {
      const page = await open(anonymous.context); await notice(page, "error.signIn").waitFor(); await privateCleared(page);
      const anchor = region(page).getByRole("link", { name: words["account.openWorkspace"], exact: true });
      assert.equal(await anchor.getAttribute("href"), "/account"); assert.equal(await anchor.getAttribute("target"), "_blank");
      assert.equal(await anchor.getAttribute("referrerpolicy"), "no-referrer");
      const rel = (await anchor.getAttribute("rel"))!.split(" "); assert(rel.includes("noopener") && rel.includes("noreferrer"));
      const popupPromise = page.waitForEvent("popup"); await anchor.click(); const popup = await popupPromise;
      await popup.waitForLoadState("domcontentloaded"); assert.equal(popup.url(), `${origin}/account`);
      assert.equal(await popup.evaluate(() => window.opener === null && document.referrer === ""), true);
      // Synthetic current-session availability, no wallet signing or membership writes.
      anonymous.authority(409); await page.evaluate(() => window.dispatchEvent(new CustomEvent("keryx:auth", { detail: "changed" })));
      await notice(page, "error.accountChanged").waitFor(); await privateCleared(page);
      anonymous.authority(200); await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await preview(page);
      assert.equal(anonymous.previews(), 1); assert.equal(anonymous.calls.filter(call => call.action === "complete").length, 0);
      await checkbox(page).check(); await button(page, "action.confirm").click(); await notice(page, "notice.linked").waitFor();
      await safePage(page); results.push("anonymous-token-free-enrollment-fresh-preview-checkbox");
    } catch (error) { anonymousErrors.push(error); throw error; } finally { await finishScenario(anonymous, anonymousErrors); }
    }
    for (const status of [401, 409, 503]) {
      if (!selected(`private-reload-refusal-${status}`)) continue;
      const s = await scenario(360), bodyErrors: unknown[] = [];
      try {
        const page = await open(s.context); await preview(page); await checkbox(page).check(); s.authority(status);
        await button(page, "action.load").click(); await notice(page, status === 401 ? "error.signIn" : status === 409 ? "error.accountChanged" : "error.unconfirmed").waitFor();
        await privateCleared(page); s.authority(200); await button(page, "action.load").click(); await notice(page, "notice.listed").waitFor();
        assert.equal(s.previews(), 1); await privateCleared(page); results.push(`private-reload-refusal-${status}`);
      } catch (error) { bodyErrors.push(error); throw error; } finally { await finishScenario(s, bodyErrors); }
    }
    for (const status of [410, 503]) {
      if (!selected(`preview-static-refusal-${status}`)) continue;
      const s = await scenario(360, 200, status), bodyErrors: unknown[] = [];
      try { const page = await open(s.context); await notice(page, status === 410 ? "error.expired" : "error.unconfirmed").waitFor(); await privateCleared(page); results.push(`preview-static-refusal-${status}`); }
      catch (error) { bodyErrors.push(error); throw error; } finally { await finishScenario(s, bodyErrors); }
    }
    if (selected("unknown-fragment-refused")) {
    const unknown = await scenario(360), unknownErrors: unknown[] = [];
    try { const page = await open(unknown.context, "token=unknown"); await notice(page, "notice.listed").waitFor(); assert.equal(unknown.previews(), 0); await privateCleared(page); results.push("unknown-fragment-refused"); }
    catch (error) { unknownErrors.push(error); throw error; } finally { await finishScenario(unknown, unknownErrors); }
    }
    assert.deepEqual(results, expectedResults, "Every selected original control in order; no skip-as-PASS");
    assert.deepEqual(await sourcePins(), beforeSources); assert.deepEqual(await compiledPins(), beforeCompiled);
    assert.deepEqual(failures, []); assert.deepEqual(pageErrors, []);
  } catch (error) { process.exitCode = 1; mainFailed = true; mainFailure = error; }
  finally {
    for (const context of contexts) try { await closeContext(context); } catch (error) { cleanupFailures.push(error); }
    try { await browser?.close(); browserClosed = true; } catch (error) { cleanupFailures.push(error); }
    // Await the ORIGINAL preload on failure paths too, before server teardown.
    try { await preloadPromise; } catch (error) { cleanupFailures.push(error); }
    try { if (server.listening) await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done())); httpDrained = !server.listening; }
    catch (error) { cleanupFailures.push(error); }
    if (app) {
      try { const instrumentation = require(join(fixture, ".next/server/instrumentation.js")) as { close(): Promise<boolean> };
        assert.equal(await instrumentation.close(), true); instrumentationClosed = true; } catch (error) { cleanupFailures.push(error); }
      // NextCustomServer.close uses allSettled internally; observe the actual
      // server close failure directly as well, so it cannot be swallowed.
      try { await actualNext?.close(); } catch (error) { cleanupFailures.push(error); }
      try { await app.close(); appClosed = true; } catch (error) { cleanupFailures.push(error); }
      try { await require("next/dist/trace").flushAllTraces(); tracesFlushed = true; } catch (error) { cleanupFailures.push(error); }
    }
    for (const listener of listeners) if (listener !== server && listener.listening) {
      try { await new Promise<void>((done, fail) => listener.close(error => error ? fail(error) : done())); }
      catch (error) { cleanupFailures.push(error); }
    }
    privateHttpDrained = [...listeners].every(listener => !listener.listening);
    if (!privateHttpDrained) cleanupFailures.push(new Error("Owned private HTTP listener still listening"));
    Server.prototype.listen = nativeListen; Socket.prototype.connect = nativeConnect; globalThis.fetch = nativeFetch;
    try { process.chdir(previousCwd); for (const name of Object.keys(process.env)) delete process.env[name]; Object.assign(process.env, previousEnvironment); }
    catch (error) { cleanupFailures.push(error); }
    if (mainFailed || cleanupFailures.length) process.exitCode = 1;
    try { await writeFile(join(run, "outcome.json"), JSON.stringify({ status: mainFailed || cleanupFailures.length ? "FAILED" : "COMPILED_SYNTHETIC_SELECTED_CONTROLS_PASSED", selection, whole34Acceptance: false,
      scope: "Selected original compiled controls only; unselected controls NOT RUN. All session/account/chat responses and credentials SYNTHETIC; no server cookie/native DB/provider authority; no whole34 acceptance",
      admissionPath, buildEvidence: admission.buildEvidence, currentMainCompositionEvidence: admission.currentMainCompositionEvidence,
      buildId, sourcePins: beforeSources, compiledPins: beforeCompiled, results, httpRequests, failures, pageErrors, externalAttempts,
      naturalClose: { browserClosed, httpDrained, privateHttpDrained, appClosed, instrumentationClosed, tracesFlushed,
        processExitObserved: null, processCloseObserved: null, stdoutEofObserved: null, stderrEofObserved: null },
      error: mainFailed ? String(mainFailure) : null, cleanupFailures: cleanupFailures.map(String),
      note: "Parent must capture actual exit/close and separate stdout/stderr EOF; JSON cannot establish them." }, null, 2) + "\n", { flag: "wx" }); }
    catch (error) { cleanupFailures.push(error); }
    if (cleanupFailures.length) throw new AggregateError(mainFailed ? [mainFailure, ...cleanupFailures] : cleanupFailures, "Compiled chat263 cleanup/evidence failure");
    if (mainFailed) throw mainFailure;
  }
  console.log("Selected compiled chat263 synthetic controls completed with owned natural cleanup; no whole34 acceptance. Native/provider/history/CI/production gates separate.");
}
await main().catch(async error => {
  process.exitCode = 1; // FIRST, before awaited failure IO: Next handlers may swallow rethrows.
  if (failureOutput) {
    try { await writeFile(join(failureOutput, "failed.json"), JSON.stringify({ status: "FAILED", error: String(error),
      note: "Retain original outcome and parent actual exit/close/EOF." }, null, 2) + "\n", { flag: "wx" }); }
    catch (recordError) { throw new AggregateError([error, recordError], "Chat263 original failure plus failure-record write failure"); }
  }
  throw error;
});
