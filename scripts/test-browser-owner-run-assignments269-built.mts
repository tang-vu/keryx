/** Parent-run control of the ACTUAL emitted /me/run-assignments page, inbox,
 * WalletMenu and canonical useSiweAuth. Only auth/inbox HTTP is synthetic.
 * Native BroadcastChannel, browser form validation and React/Next stay real.
 * This never qualifies native POSIX owner apply, durable consent, a receipt,
 * financial rows, publication, production auth, or any other supported surface.
 * No build/install/daemon/ENV-file loading, hook alias or test page is provided.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { Socket } from "node:net";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { copyNextConfigFixture, nextConfigFixtureFiles } from "../test-support/next-config-fixture";
import { ownerRunAssignmentMessages as copy } from "../locales/en/owner-run-assignments";
import { manifestSchema, recipientActionSchema, recipientSchema, receiptSchema,
  type Manifest, type Recipient, type RecipientAction } from "../lib/owner-run-assignments/contracts";
import { inboxSchema, type AssignmentInbox, type InboxItem } from "../lib/owner-run-assignments/projection";
import { assignmentDigest } from "../lib/owner-run-assignments/protocol";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const args = process.argv.slice(2), flags = ["dist", "output", "port"] as const;
assert.equal(args.length, flags.length, "Parent supplies --dist=ABS --output=ABS --port=OWNED");
const values = Object.fromEntries(flags.map(flag => {
  const matches = args.filter(value => value.startsWith(`--${flag}=`)); assert.equal(matches.length, 1);
  return [flag, matches[0].slice(flag.length + 3)];
})) as Record<typeof flags[number], string>;
const { dist, output } = values, port = Number(values.port), origin = `http://127.0.0.1:${port}`;
assert(isAbsolute(dist) && isAbsolute(output)); assert(Number.isInteger(port) && port >= 1024 && port <= 65535);
function inside(path: string, parent: string) {
  const part = relative(resolve(parent), resolve(path));
  return part !== "" && !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`);
}
assert(inside(output, join(root, "output")), "Owned runtime must be inside this worktree/output");
const actualRoot = await realpath(root), actualOutput = await realpath(output), actualDist = await realpath(dist);
assert(inside(actualOutput, join(actualRoot, "output")), "No foreign output junction");
for (const [a, b] of [[dist, output], [actualDist, actualOutput]])
  assert(resolve(a) !== resolve(b) && !inside(a, b) && !inside(b, a), "Read-only donor and output must be disjoint");
for (const [name, leaf] of [["TEMP", "temp"], ["TMP", "temp"], ["TSX_CACHE_DIR", "tsx-cache"]] as const)
  assert.equal(resolve(process.env[name] ?? ""), resolve(output, leaf), `Parent binds ${name} to owned output/${leaf}`);
const require = createRequire(import.meta.url);
assert.equal(require("next/package.json").version, "16.3.8");
assert.equal(Object.keys(copy).length, 31, "Preserve the actual 31 English keys; no catalogue activation");
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const pinnedPaths = [...new Set([...nextConfigFixtureFiles, "scripts/test-browser-owner-run-assignments269-built.mts",
  "app/me/run-assignments/page.tsx", "components/keryx/site-header.tsx", "components/keryx/dispatch-wire.tsx",
  "components/keryx/owner-run-assignment-inbox.tsx", "components/keryx/wallet-menu.tsx",
  "lib/hooks/use-siwe-auth.ts", "lib/browser-auth-notice.ts", "lib/owner-run-assignments/contracts.ts",
  "lib/owner-run-assignments/protocol.ts", "lib/owner-run-assignments/projection.ts", "lib/owner-run-assignments/http.ts",
  "app/api/me/run-assignments/route.ts", "locales/en/owner-run-assignments.ts", "lib/i18n/format.ts",
  "test-support/next-config-fixture.ts", "instrumentation.ts", "package-lock.json"])];
async function pinSources() { return Promise.all(pinnedPaths.map(async path => {
  const bytes = await readFile(join(root, path)); return { path, bytes: bytes.length, sha256: sha(bytes) };
})); }
const sourcePins = await pinSources();
const compiledPaths = ["BUILD_ID", "server/app-paths-manifest.json", "server/app/me/run-assignments/page.js",
  "server/app/me/run-assignments/page_client-reference-manifest.js", "required-server-files.json"];
async function pinBuild() { return Promise.all(compiledPaths.map(async path => ({ path, sha256: sha(await readFile(join(dist, path))) }))); }
const compiledPins = await pinBuild(), buildId = (await readFile(join(dist, "BUILD_ID"), "utf8")).trim();
assert(buildId && buildId.length <= 128);
const appPaths = JSON.parse(await readFile(join(dist, "server/app-paths-manifest.json"), "utf8"));
assert.equal(appPaths["/me/run-assignments/page"], "app/me/run-assignments/page.js");
assert((await readFile(join(dist, "server/app/me/run-assignments/page_client-reference-manifest.js"), "utf8"))
  .includes("owner-run-assignment-inbox"), "Donor must contain the real client inbox");
// BUILD_ID and these hashes are observations, not a source-to-build attestation.
// Parent supplies its existing exact-new-source/input build evidence before running.

async function bounded<T>(promise: Promise<T>, label: string, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: ${milliseconds}ms deadline exceeded`)), milliseconds);
  })]); } finally { clearTimeout(timer); }
}
const PAGE = "/me/run-assignments", API = "/api/me/run-assignments", SESSION = "/api/auth/session", LOGOUT = "/api/auth/signout";
const wallet = `0x${"a".repeat(40)}`, otherWallet = `0x${"b".repeat(40)}`;
const recipient: Recipient = { accountId: `acct_${"c".repeat(64)}`, accountCreatedAt: 1000, wallet, memberGeneration: "d".repeat(64) };
const replacement: Recipient = { accountId: `acct_${"e".repeat(64)}`, accountCreatedAt: 2000, wallet, memberGeneration: "f".repeat(64) };
const otherRecipient: Recipient = { ...replacement, wallet: otherWallet };
const assignmentId = "11111111-1111-4111-8111-111111111111";
const manifest: Manifest = manifestSchema.parse({ version: 1,
  binding: { origin, network: "eip155:5042002", storageDigest: "1".repeat(64) }, recipient,
  basis: { code: "documented-recipient-request", reference: "synthetic-compiled-ui-only" },
  scope: "association-history-and-confirmation", admissionExpiresAt: 1_900_000_000_000,
  members: [{ assignmentId, runId: "synthetic-owner269-compiled-run", originalSha256: "2".repeat(64), completedAt: "2026-10-01T00:00:00.000Z" }] });
const assigned: InboxItem = { assignmentId, revision: 7, status: "assigned-by-owner", assignedAt: 1_790_812_800_000,
  confirmedAt: null, admissionExpiresAt: manifest.admissionExpiresAt, effective: true, runId: manifest.members[0].runId,
  network: manifest.binding.network, attribution: "assigned-by-owner" };
function inbox(current = recipient, history: InboxItem[] = []): AssignmentInbox {
  return inboxSchema.parse({ version: 1, kind: "owner-assignment-inbox", recipient: current, history,
    profile: { assignedByOwner: history.filter(row => row.effective && row.attribution === "assigned-by-owner").length,
      claimedFromOwnerAssignment: history.filter(row => row.effective && row.attribution === "claimed-from-owner-assignment").length } });
}
type Body = { expected: Recipient; input: RecipientAction };
function parseBody(raw: string): Body {
  assert(Buffer.byteLength(raw) <= 16_384); const value = JSON.parse(raw);
  assert.deepEqual(Object.keys(value).sort(), ["expected", "input"]);
  return { expected: recipientSchema.parse(value.expected), input: recipientActionSchema.parse(value.input) };
}
// Only a labelled synthetic RECIPIENT response fixture, never an owner apply/undo
// result or a claimed durable receipt. It exercises the existing wire schema.
function recipientReply(body: Body, history: InboxItem[] = []): AssignmentInbox {
  assert(["consent", "confirm", "reject", "withdraw"].includes(body.input.action));
  const receipt = receiptSchema.parse({ version: 1, requestId: body.input.requestId,
    inputDigest: assignmentDigest("operation", { input: body.input, actor: body.expected }), action: body.input.action,
    committedAt: 1_790_812_801_000, results: [], meaning: "historical-committed-result-not-current-authority" });
  return inboxSchema.parse({ ...inbox(body.expected, history), receipt });
}

type Notice = { type: "logout"; source: string; sequence: number; pending: boolean; confirmed: boolean };
type ObservedRequest = { id: number; path: string; method: string; raw: string | null; wallet: string | null;
  held: boolean; ready: boolean; aborted: boolean; released: boolean; cancelled: boolean };
type Observation = { realm: string; requests: ObservedRequest[]; errors: string[]; events: unknown[]; messages: unknown[]; paints: string[];
  hold(path: string, method: string): void; release(id: number): void; guard(markers: string[]): void; close(): void };
type FixtureWindow = Window & typeof globalThis & { owner269: Observation };
// Literal JS intentionally avoids tsx/esbuild's captured __name helper. Do not
// serialize a function closing over imports, helpers or a test auth implementation.
const observerScript = String.raw`(() => {
  if (location.origin !== ${JSON.stringify(origin)}) return;
  const native = window.fetch.bind(window), plans = [], releases = new Map();
  const state = { realm: crypto.randomUUID(), requests: [], errors: [], events: [], messages: [], paints: [] };
  let markers = [], guarded = false;
  const refuse = message => { state.errors.push(message); throw Error(message); };
  const channel = new BroadcastChannel("keryx-auth-v1");
  const auth = event => { if (state.events.length >= 128) refuse("Auth event cap"); state.events.push(event.detail ?? null); };
  window.addEventListener("keryx:auth", auth, true);
  channel.onmessage = event => { if (state.messages.length >= 128) refuse("Peer event cap"); state.messages.push(event.data); };
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.origin !== location.origin) return native(input, init); // Context fence aborts, never continues, external traffic.
    if (!["/api/me/run-assignments", "/api/auth/session", "/api/auth/signout"].includes(url.pathname)) return native(input, init);
    if (state.requests.length >= 128) refuse("Request cap");
    const method = init.method ?? "GET", headers = new Headers(init.headers);
    if (url.search || url.hash || init.cache !== "no-store") refuse("Changed private selector/cache boundary");
    if (url.pathname === "/api/me/run-assignments") {
      if (!["GET", "POST"].includes(method) || init.credentials !== "same-origin" || init.redirect !== "error"
        || init.referrerPolicy !== "no-referrer" || headers.has("authorization") || !init.signal) refuse("Changed inbox request boundary");
      if (method === "GET" && init.body !== undefined) refuse("GET body");
      if (method === "POST" && (typeof init.body !== "string" || new TextEncoder().encode(init.body).length > 16384
        || headers.get("content-type") !== "application/json")) refuse("Changed POST envelope");
    }
    const plan = plans.findIndex(value => value.path === url.pathname && value.method === method);
    const held = plan >= 0; if (held) plans.splice(plan, 1);
    const record = { id: state.requests.length, path: url.pathname, method, raw: typeof init.body === "string" ? init.body : null,
      wallet: headers.get("x-keryx-expected-wallet"), held, ready: false, aborted: !!init.signal?.aborted, released: false, cancelled: false };
    state.requests.push(record);
    init.signal?.addEventListener("abort", () => { record.aborted = true; }, { once: true });
    // For the planned adversarial body only, ignore the original abort so that
    // the real component must reject a fully parsed late response by epoch.
    const response = await native(input, held ? { ...init, signal: undefined } : init);
    if (!held) { record.ready = true; return response; }
    const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.length > 262144) refuse("Body cap");
    return new Response(new ReadableStream({ start(controller) {
      releases.set(record.id, () => { record.released = true; releases.delete(record.id);
        if (!record.cancelled) { controller.enqueue(bytes); controller.close(); } }); record.ready = true;
    }, cancel() { record.cancelled = true; } }), { status: response.status, headers: response.headers });
  };
  const mutation = new MutationObserver(() => {
    if (!guarded) return;
    const main = document.querySelector("main");
    const text = (main?.textContent ?? "") + Array.from(main?.querySelectorAll("textarea,input") ?? [], field => field.value).join(" ");
    if (markers.some(marker => text.includes(marker))) {
      if (state.paints.length >= 32) refuse("Paint cap"); state.paints.push(text.slice(0, 32768));
    }
  });
  mutation.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  window.owner269 = Object.assign(state, {
    hold(path, method) { if (plans.length >= 4) refuse("Hold cap"); plans.push({ path, method }); },
    release(id) { if (!releases.has(id)) refuse("No original held body"); releases.get(id)(); },
    guard(values) { markers = values; guarded = true; },
    close() { for (const release of Array.from(releases.values())) release(); mutation.disconnect(); channel.close();
      window.removeEventListener("keryx:auth", auth, true); window.fetch = native; }
  });
})();`;
const region = (page: Page) => page.getByRole("region", { name: copy.title, exact: true });
const button = (page: Page, name: string) => region(page).getByRole("button", { name, exact: true });
const field = (page: Page) => region(page).getByLabel(copy.consentManifest, { exact: true });
const check = (page: Page, name: string) => region(page).getByRole("checkbox", { name, exact: true });
const flush = (page: Page) => page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
const snapshot = (page: Page) => page.evaluate(() => {
  const value = (window as FixtureWindow).owner269;
  return { realm: value.realm, requests: value.requests, errors: value.errors, events: value.events, messages: value.messages, paints: value.paints };
});
const privateMarkers = [recipient.accountId, recipient.memberGeneration, assignmentId, manifest.members[0].runId,
  "synthetic-late-owner269-body", copy.assigned, copy.claimed, copy.historical, copy.pendingConsent];
async function cleared(page: Page) {
  assert.equal(await page.locator("main textarea, main input[type=checkbox], main form").count(), 0, "Erase drafts, both checks and recovery before revalidation");
  assert.equal(await page.locator(`main [aria-label="${copy.profile}"]`).count(), 0);
  const text = await page.locator("main").textContent(); for (const marker of privateMarkers) assert(!text?.includes(marker), `Private markup survived: ${marker}`);
}
async function ready(page: Page) { await field(page).waitFor(); await button(page, copy.refresh).and(page.locator(":enabled")).waitFor(); }
async function paste(page: Page, proposal = manifest) { await field(page).fill(JSON.stringify(proposal)); }
async function checks(page: Page) { await check(page, copy.acknowledgement).check(); await check(page, copy.financialAcknowledgement).check(); }
async function pendingBody(page: Page, path: string, method: string, start: number) {
  await page.waitForFunction(({ path, method, start }) => (window as FixtureWindow).owner269.requests
    .some(value => value.id >= start && value.path === path && value.method === method && value.held && value.ready), { path, method, start });
  return (await snapshot(page)).requests.find(value => value.id >= start && value.path === path && value.method === method && value.held && value.ready)!;
}
async function hold(page: Page, path: string, method: string) { await page.evaluate(({ path, method }) => (window as FixtureWindow).owner269.hold(path, method), { path, method }); }
async function release(page: Page, id: number) { await page.evaluate(id => (window as FixtureWindow).owner269.release(id), id); await flush(page); }
async function focus(page: Page) { await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await flush(page); }

type NextFactory = (options: { dev: false; dir: string; hostname: string; port: number; httpServer: ReturnType<typeof createServer> }) => {
  prepare(): Promise<void>; close(): Promise<void>; getRequestHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  server: { getServer(): Promise<{ prepare(): Promise<void> }> };
};
const run = join(output, "run"), fixture = join(output, "runtime");
const previousCwd = process.cwd(), previousEnvironment = { ...process.env }, nativeFetch = globalThis.fetch, nativeConnect = Socket.prototype.connect;
let app: ReturnType<NextFactory> | undefined, browser: Browser | undefined, mainFailure: unknown, mainFailed = false, stopping = false;
let browserClosed = false, httpDrained = false, instrumentationClosed = false, appClosed = false, tracesFlushed = false;
let activeCase: Promise<void> | undefined;
const failures: string[] = [], pageErrors: string[] = [], externalAttempts: string[] = [], httpRequests: string[] = [], cleanupFailures: unknown[] = [];
const continuedOrigins: string[] = [];
const results: { case: string; status: "PASS" | "FAILED"; elapsedMs: number; error?: string }[] = [];
const callEvidence: { case: string; calls: Call[]; observations: unknown[] }[] = [];
let currentCase = "setup";
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.headers.host, new URL(origin).host); assert(httpRequests.length < 2048);
    const url = new URL(req.url!, origin); httpRequests.push(`${req.method} ${url.pathname}`);
    assert.equal(req.method, "GET"); assert(!url.pathname.startsWith("/api/"), "Synthetic API interception missing; refuse before compiled handlers");
    if (req.headers["next-router-prefetch"] === "1" && url.pathname !== PAGE && !url.pathname.startsWith("/_next/")) {
      res.writeHead(503, { "Cache-Control": "no-store" }); res.end(); return;
    }
    assert(url.pathname === PAGE || url.pathname === "/favicon.ico" || url.pathname.startsWith("/_next/"), "Finite emitted route/assets only");
    assert(app); await bounded(app.getRequestHandler()(req, res), "Compiled HTTP request", 10000);
  } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); if (!res.headersSent) res.writeHead(500); res.end(); }
});
server.headersTimeout = 5000; server.requestTimeout = 10000; server.keepAliveTimeout = 500;
type Call = { method: string; raw: string | null; wallet: string; body?: Body };
type Scenario = { context: BrowserContext; calls: Call[]; session: string | null; current: Recipient; history: InboxItem[];
  dropPosts: number; rejectPosts: number; sessionHeld: boolean; releaseSession(): void; sessionReads: number; signouts: number };
async function scenario(anonymous = false, checking = false): Promise<Scenario> {
  assert(browser);
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1366, height: 900 }, reducedMotion: "reduce" });
  context.setDefaultTimeout(6000); context.setDefaultNavigationTimeout(10000);
  const s: Scenario = { context, calls: [], session: anonymous ? null : wallet, current: recipient, history: [], dropPosts: 0, rejectPosts: 0,
    sessionHeld: checking, releaseSession() { s.sessionHeld = false; releaseSession(); }, sessionReads: 0, signouts: 0 };
  let releaseSession!: () => void; const sessionGate = new Promise<void>(done => { releaseSession = done; });
  if (!checking) releaseSession();
  context.on("page", page => page.on("pageerror", error => pageErrors.push(`${currentCase}: ${error.message}`)));
  await context.addInitScript({ content: observerScript });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { assert(externalAttempts.length < 256); externalAttempts.push(`${request.method()} ${url.origin}`); await route.abort("blockedbyclient"); return; }
    try {
      await bounded((async () => {
        const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json",
          headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" }, body: JSON.stringify(value) });
        if (url.pathname === SESSION) {
          assert.equal(request.method(), "GET"); assert.equal(url.search, ""); assert(++s.sessionReads <= 64);
          if (s.sessionHeld) await sessionGate;
          await json({ session: s.session ? { address: s.session, role: "asker" } : null }); return;
        }
        if (url.pathname === LOGOUT) {
          assert.equal(request.method(), "POST"); assert.equal(url.search, ""); assert.equal(request.postData(), null);
          assert.equal(++s.signouts, 1); s.session = null; await json({ ok: true }); return;
        }
        if (["/api/me/locale-preference", "/api/payments", "/maintenance/status"].includes(url.pathname)) {
          assert.equal(request.method(), "GET"); await json({ error: "Synthetic incidental consumer unavailable" }, 503); return;
        }
        if (url.pathname === API) {
          assert(s.session, "Anonymous must never request private IO"); assert(s.calls.length < 32); assert.equal(url.search, "");
          const method = request.method(), headers = request.headers(), raw = request.postData();
          assert.equal(headers["x-keryx-expected-wallet"], s.session.toLowerCase()); assert(!headers.authorization);
          if (method === "GET") { assert.equal(raw, null); s.calls.push({ method, raw, wallet: s.session }); await json(inbox(s.current, s.history)); return; }
          assert.equal(method, "POST"); assert.equal(headers.origin, origin); assert(raw !== null);
          const body = parseBody(raw); s.calls.push({ method, raw, wallet: s.session, body });
          assert.deepEqual(body.expected, s.current, "Exact current account creation/member generation, never wallet-only authority");
          if (body.input.action === "consent") assert.deepEqual(body.input.manifest.recipient, s.current, "Consent must target the same exact recipient generation");
          assert(["consent", "confirm", "reject", "withdraw"].includes(body.input.action), "No owner actions/receipt lookup capability");
          if (s.dropPosts > 0) { s.dropPosts--; await route.abort("failed"); return; }
          if (s.rejectPosts > 0) { s.rejectPosts--; await json({ error: "assignment_outcome_unresolved" }, 503); return; }
          await json(recipientReply(body)); return;
        }
        assert(!url.pathname.startsWith("/api/"), "No production/provider/wallet/session-creation/payment/research API");
        assert.equal(request.method(), "GET");
        // This is the only continue. The external branch above always aborts.
        assert(continuedOrigins.length < 2048); continuedOrigins.push(url.origin);
        await route.continue();
      })(), "Synthetic route request", 8000);
    } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); await route.abort("failed").catch(() => undefined); }
  });
  return s;
}
async function open(s: Scenario) { const page = await s.context.newPage(); const response = await page.goto(`${origin}${PAGE}`); assert.equal(response?.status(), 200); return page; }
async function closeScenario(s: Scenario) {
  s.releaseSession(); const errors: unknown[] = [];
  for (const page of s.context.pages()) if (!page.isClosed()) {
    try { await bounded(page.evaluate(() => (window as FixtureWindow).owner269.close()), "Observer close", 2000); } catch (error) { errors.push(error); }
  }
  try { await bounded(s.context.close(), "Owned context close", 5000); } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, "Owned scenario cleanup failed");
}
async function caseRun(name: string, test: (s: Scenario) => Promise<void>, anonymous = false, checking = false) {
  if (stopping) return;
  currentCase = name; const started = performance.now(), s = await scenario(anonymous, checking);
  let error: unknown, failed = false;
  try { await bounded(test(s), name, 20000); }
  catch (cause) { failed = true; error = cause; }
  finally {
    const observations: unknown[] = [];
    for (const page of s.context.pages()) if (!page.isClosed()) {
      try { const observed = await bounded(snapshot(page), "Snapshot", 2000); observations.push(observed); assert.deepEqual(observed.errors, []); }
      catch (cause) { failed = true; error = error ? new AggregateError([error, cause]) : cause; }
    }
    callEvidence.push({ case: name, calls: s.calls, observations });
    try { await closeScenario(s); } catch (cause) { failed = true; error = error ? new AggregateError([error, cause]) : cause; }
    results.push({ case: name, status: failed ? "FAILED" : "PASS", elapsedMs: Math.round(performance.now() - started),
      ...(failed ? { error: error instanceof Error ? error.stack ?? error.message : String(error) } : {}) });
  }
}

async function runCases() {
  await caseRun("checking-and-anonymous-no-private-IO", async s => {
    const page = await open(s); await page.locator("main").getByText(copy.checking, { exact: true }).waitFor();
    assert.equal(s.calls.length, 0); await cleared(page); s.releaseSession();
    const signIn = page.locator("main").getByRole("link", { name: copy.signIn, exact: true });
    await signIn.waitFor(); assert.equal(await signIn.getAttribute("href"), "/connect");
    await focus(page); await flush(page); assert.equal(s.calls.length, 0); await cleared(page);
  }, true, true);
  await caseRun("exact-manifest-two-native-checkboxes-and-recipient-envelope", async s => {
    const page = await open(s); await ready(page); assert(s.calls.every(call => call.method === "GET"));
    assert.equal(await button(page, copy.consent).isDisabled(), true);
    await field(page).fill("{invalid"); assert.equal(await button(page, copy.consent).isDisabled(), true);
    await field(page).fill(JSON.stringify({ ...manifest, extra: true })); assert.equal(await button(page, copy.consent).isDisabled(), true);
    await paste(page); await region(page).getByText(copy.proposalSummary, { exact: true }).waitFor();
    for (const name of [copy.acknowledgement, copy.financialAcknowledgement]) {
      assert.equal(await check(page, name).getAttribute("type"), "checkbox"); assert.equal(await check(page, name).getAttribute("required"), "");
      assert.equal(await check(page, name).isChecked(), false);
    }
    const before = s.calls.length;
    await button(page, copy.consent).click(); await flush(page); assert.equal(s.calls.length, before);
    await check(page, copy.acknowledgement).check(); await button(page, copy.consent).click(); await flush(page); assert.equal(s.calls.length, before);
    await check(page, copy.acknowledgement).uncheck(); await check(page, copy.financialAcknowledgement).check();
    await button(page, copy.consent).click(); await flush(page); assert.equal(s.calls.length, before);
    await check(page, copy.acknowledgement).check(); await button(page, copy.consent).click();
    await region(page).getByText(copy.pendingConsent, { exact: true }).waitFor();
    const post = s.calls.filter(call => call.method === "POST"); assert.equal(post.length, 1);
    assert.deepEqual(post[0].body, { expected: recipient, input: { action: "consent", requestId: post[0].body!.input.requestId,
      manifest, acknowledgeAssignedLabel: true, noFinancialAuthority: true } });
    await region(page).getByText(copy.historical, { exact: false }).waitFor(); assert.equal(s.calls.length, before + 1, "No owner apply or follow-up retry");
  });
  for (const key of ["accountId", "accountCreatedAt", "memberGeneration", "wallet"] as const) {
    await caseRun(`proposal-refuses-different-${key}`, async s => {
      const page = await open(s); await ready(page);
      const wrong = { ...manifest, recipient: { ...recipient, [key]: otherRecipient[key] } };
      await paste(page, wrong); await checks(page); const before = s.calls.length, beforeRequests = (await snapshot(page)).requests.length;
      if (!await button(page, copy.consent).isDisabled()) await button(page, copy.consent).click();
      await flush(page);
      assert.equal((await snapshot(page)).requests.filter(value => value.id >= beforeRequests && value.path === API && value.method === "POST").length,
        0, "No different-recipient POST even before route dispatch completes");
      assert.equal(s.calls.length, before, "A different recipient generation must never be submitted as consent");
    });
  }
  await caseRun("fresh-GET-replaces-entire-recipient-generation", async s => {
    const page = await open(s); await ready(page); s.current = replacement;
    await button(page, copy.refresh).click(); await ready(page);
    await paste(page, { ...manifest, recipient: replacement }); await checks(page); await button(page, copy.consent).click();
    await region(page).getByText(copy.pendingConsent, { exact: true }).waitFor();
    assert.deepEqual(s.calls.find(call => call.method === "POST")!.body!.expected, replacement);
  });
  await caseRun("unknown-POST-retains-EXACT-bytes-and-explicit-same-ID-replay", async s => {
    const page = await open(s); await ready(page); s.dropPosts = 1;
    await paste(page); await checks(page); await button(page, copy.consent).click();
    await region(page).getByText(copy.unknown, { exact: true }).waitFor();
    const recovery = region(page).getByLabel(copy.recovery, { exact: true }), original = s.calls.find(call => call.method === "POST")!.raw!;
    assert.equal(await recovery.getAttribute("readonly"), ""); assert.equal(await recovery.inputValue(), original);
    await flush(page); assert.equal(s.calls.filter(call => call.method === "POST").length, 1, "No automatic retry after response loss");
    s.rejectPosts = 1; await button(page, copy.resolve).click(); await button(page, copy.resolve).and(page.locator(":enabled")).waitFor();
    assert.equal(await recovery.inputValue(), original); assert.equal(s.calls.filter(call => call.method === "POST")[1].raw, original);
    await button(page, copy.resolve).click(); await region(page).getByText(copy.pendingConsent, { exact: true }).waitFor();
    const posts = s.calls.filter(call => call.method === "POST"); assert.equal(posts.length, 3);
    assert(posts.every(call => call.raw === original), "Unchanged request ID, manifest, expected generation and JSON bytes");
    assert.equal(await recovery.count(), 0); assert.equal(s.signouts, 0);
  });
  for (const action of ["confirm", "reject", "withdraw"] as const) await caseRun(`explicit-${action}-uses-displayed-revision`, async s => {
    s.history = action === "withdraw" ? [{ ...assigned, status: "claimed", attribution: "claimed-from-owner-assignment", confirmedAt: assigned.assignedAt + 1000 }]
      : action === "reject" ? [{ assignmentId, revision: 9, status: "assigned-by-owner", effective: false,
        assignedAt: assigned.assignedAt, confirmedAt: null, admissionExpiresAt: assigned.admissionExpiresAt }] : [assigned];
    const page = await open(s); await ready(page);
    await region(page).getByRole("heading", { name: action === "withdraw" ? copy.claimed : action === "reject" ? copy.suppressed : copy.assigned, exact: true }).waitFor();
    await button(page, copy[action]).click(); await region(page).getByText(copy.historical, { exact: false }).waitFor();
    const input = s.calls.find(call => call.method === "POST")!.body!.input;
    assert.deepEqual(input, { action, requestId: input.requestId, expected: { assignmentId, revision: s.history[0].revision } });
  });
  await caseRun("focus-erases-unknown-recovery-before-explicit-revalidation", async s => {
    const page = await open(s); await ready(page); s.dropPosts = 1;
    await paste(page); await checks(page); await button(page, copy.consent).click();
    await region(page).getByText(copy.unknown, { exact: true }).waitFor(); const before = s.calls.length;
    await focus(page); await cleared(page); assert.equal(s.calls.length, before, "Focus does not automatically fetch private inbox");
  });
  for (const method of ["GET", "POST"] as const) await caseRun(`focus-invalidates-held-${method}-late-body`, async s => {
    const page = await open(s); await ready(page); const start = (await snapshot(page)).requests.length;
    s.history = [{ ...assigned, runId: "synthetic-late-owner269-body" }]; await hold(page, API, method);
    if (method === "GET") await button(page, copy.refresh).click();
    else { await paste(page); await checks(page); await button(page, copy.consent).click(); }
    const held = await pendingBody(page, API, method, start), before = s.calls.length;
    await focus(page);
    try { await cleared(page); } finally {
      assert((await snapshot(page)).requests[held.id].aborted, "Focus aborted original inbox request");
      await page.evaluate(markers => (window as FixtureWindow).owner269.guard(markers), privateMarkers);
      await release(page, held.id); await button(page, copy.refresh).and(page.locator(":enabled")).waitFor(); await cleared(page);
      assert.deepEqual((await snapshot(page)).paints, []); assert.equal(s.calls.length, before, "Late body cannot refresh or restore authority");
    }
  });
  await caseRun("wallet-replacement-refuses-old-held-body-and-draft", async s => {
    const page = await open(s); await ready(page); await paste(page); await checks(page);
    const start = (await snapshot(page)).requests.length; s.history = [{ ...assigned, runId: "synthetic-late-owner269-body" }];
    await hold(page, API, "GET"); await button(page, copy.refresh).click(); const held = await pendingBody(page, API, "GET", start);
    s.session = otherWallet; s.current = otherRecipient; s.history = []; await focus(page); await ready(page);
    assert((await snapshot(page)).requests[held.id].aborted);
    await page.evaluate(markers => (window as FixtureWindow).owner269.guard(markers), privateMarkers);
    await release(page, held.id); assert.equal(await field(page).inputValue(), "");
    for (const name of [copy.acknowledgement, copy.financialAcknowledgement]) assert.equal(await check(page, name).isChecked(), false);
    assert(!await page.locator("main").textContent().then(value => value?.includes("synthetic-late-owner269-body")));
    assert.deepEqual((await snapshot(page)).paints, []); assert.equal(s.calls.at(-1)!.wallet, otherWallet);
  });
  await caseRun("native-peer-realm-change-refuses-held-body", async s => {
    const a = await open(s); await ready(a); const b = await open(s); await ready(b);
    if (!await field(a).count()) { await button(a, copy.refresh).click(); await ready(a); }
    assert.notEqual((await snapshot(a)).realm, (await snapshot(b)).realm);
    assert.equal(new URL(a.url()).origin, new URL(b.url()).origin);
    await paste(a); await checks(a); const start = (await snapshot(a)).requests.length;
    s.history = [{ ...assigned, runId: "synthetic-late-owner269-body" }];
    await hold(a, API, "GET"); await button(a, copy.refresh).click(); const old = await pendingBody(a, API, "GET", start);
    const before = s.calls.length;
    await b.evaluate(() => { const channel = new BroadcastChannel("keryx-auth-v1"); channel.postMessage("changed"); channel.close(); });
    await a.locator("main").getByRole("link", { name: copy.signIn, exact: true }).waitFor(); await cleared(a);
    assert((await snapshot(a)).messages.includes("changed")); assert((await snapshot(a)).requests[old.id].aborted);
    await a.evaluate(markers => (window as FixtureWindow).owner269.guard(markers), privateMarkers);
    await release(a, old.id); await cleared(a); assert.deepEqual((await snapshot(a)).paints, []);
    assert.equal(s.calls.length, before, "Peer hints and late old-realm body grant no private lookup authority");
  });
  await caseRun("native-two-tab-current-logout-refuses-held-old-realm-body", async s => {
    const a = await open(s); await a.setViewportSize({ width: 390, height: 844 }); await ready(a);
    const b = await open(s); await ready(b);
    await b.locator("header nav:visible").getByRole("button", { name: /asker/ }).waitFor();
    // Opening a peer can focus it. Explicit refresh restores only that document's inbox.
    if (!await field(a).count()) { await button(a, copy.refresh).click(); await ready(a); }
    const aa = await snapshot(a), bb = await snapshot(b); assert.notEqual(aa.realm, bb.realm);
    assert.equal(new URL(a.url()).origin, new URL(b.url()).origin);
    await paste(a); await checks(a); await paste(b); await checks(b);
    const start = (await snapshot(b)).requests.length; await hold(b, API, "POST");
    await button(b, copy.consent).click(); const old = await pendingBody(b, API, "POST", start);
    await hold(a, LOGOUT, "POST");
    // Exercise the canonical mobile expansion; the desktop WalletMenu is hidden here.
    const toggle = a.locator('header button[aria-controls="mobile-site-menu"]');
    assert.equal(await toggle.getAttribute("aria-expanded"), "false"); await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    const mobileMenu = a.locator("header #mobile-site-menu"); await mobileMenu.waitFor({ state: "visible" });
    await mobileMenu.getByRole("button", { name: /asker/ }).click();
    assert.equal(await a.getByRole("menuitem", { name: copy.menu, exact: true }).getAttribute("href"), PAGE);
    assert(!(await snapshot(b)).requests[old.id].aborted, "Peer old request is current immediately before the real logout action");
    await a.getByRole("menuitem", { name: "Sign out", exact: true }).click();
    const ack = await pendingBody(a, LOGOUT, "POST", 0);
    for (const page of [a, b]) { await page.locator("main").getByRole("link", { name: copy.signIn, exact: true }).waitFor(); await cleared(page); }
    assert.equal(s.signouts, 1); assert((await snapshot(b)).requests[old.id].aborted);
    const peer = await snapshot(b);
    assert(peer.messages.some(value => (value as Notice)?.type === "logout" && (value as Notice).pending), "Real publisher crossed the native peer channel");
    const before = s.calls.length;
    for (const page of [a, b]) await page.evaluate(markers => (window as FixtureWindow).owner269.guard(markers), privateMarkers);
    await release(b, old.id); await release(a, ack.id);
    await a.waitForFunction(() => (window as FixtureWindow).owner269.events.includes("signed-out"));
    for (const page of [a, b]) { await cleared(page); assert.deepEqual((await snapshot(page)).paints, []); }
    assert(!(await snapshot(b)).events.includes("signed-out"), "Peer notice cannot fabricate local HTTP logout confirmation");
    assert.equal(s.calls.length, before, "Logout/late bodies initiate no private IO");
    await focus(b); await cleared(b); assert.equal(s.calls.length, before, "Fresh synthetic anonymous session stays anonymous");
  });
}

try {
  await mkdir(run); await mkdir(fixture); // Exclusive, preserve all previous captures.
  await bounded((async () => {
    // Reuse the private268/topic284 built fixture: copy admitted .next, exact config
    // graph and read-only installed dependencies. No rebuild or source symlink.
    await cp(dist, join(fixture, ".next"), { recursive: true, dereference: true, force: false, errorOnExist: true });
    await copyNextConfigFixture(root, fixture);
    await symlink(join(root, "node_modules"), join(fixture, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    await mkdir(join(fixture, "data"));
    const environment: NodeJS.ProcessEnv = { NODE_ENV: "production", NODE_OPTIONS: "", BASE_URL: origin,
      NEXT_TELEMETRY_DISABLED: "1", KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1",
      KERYX_EXTERNAL_DISCOVERY: "0", KERYX_WEB_RESEARCH: "0", KERYX_REGISTRY_ADDRESS: "", NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS: "", KERYX_RPC_WS_URL: "",
      TEMP: join(output, "temp"), TMP: join(output, "temp"), TSX_CACHE_DIR: join(output, "tsx-cache") };
    for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE"])
      if (previousEnvironment[name]) environment[name] = previousEnvironment[name];
    for (const name of Object.keys(process.env)) delete process.env[name]; Object.assign(process.env, environment); process.chdir(fixture);
    globalThis.fetch = (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      assert.equal(url.origin, origin, "No outbound server fetch"); return nativeFetch(input, init);
    };
    Socket.prototype.connect = function (this: Socket, ...args: any[]) {
      const input = Array.isArray(args[0]) ? args[0] : args;
      const options = typeof input[0] === "object" ? input[0] : { port: input[0], host: input[1] };
      assert.equal(options.host ?? options.hostname, "127.0.0.1", "No provider/DB/RPC/pipe connection");
      assert.equal(Number(options.port), port, "Only parent's reserved listener"); return Reflect.apply(nativeConnect, this, args);
    } as typeof nativeConnect;
    await bounded(new Promise<void>((done, fail) => { server.once("error", fail); server.listen(port, "127.0.0.1", done); }), "Listener", 5000);
    // Same observed production preload promise as the existing compiled fixture.
    const prototype = require("next/dist/server/next-server").default.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "unstable_preloadEntries");
    assert(descriptor && typeof descriptor.value === "function" && descriptor.configurable);
    const preloads = new WeakMap<object, Promise<void>>();
    Object.defineProperty(prototype, "unstable_preloadEntries", { ...descriptor, value: function (this: object, ...args: unknown[]) {
      assert(!preloads.has(this)); const promise = Reflect.apply(descriptor.value, this, args) as Promise<void>; preloads.set(this, promise); return promise;
    } });
    try {
      app = (require("next") as NextFactory)({ dev: false, dir: fixture, hostname: "127.0.0.1", port, httpServer: server });
      await bounded((async () => { await app!.prepare(); const actual = await app!.server.getServer(); await actual.prepare();
        const pending = preloads.get(actual); assert(pending, "Actual entry preload observed"); await pending; })(), "Compiled prepare/preload", 30000);
    } finally { Object.defineProperty(prototype, "unstable_preloadEntries", descriptor); }
    browser = await chromium.launch({ headless: true, timeout: 15000 });
    activeCase = runCases(); await activeCase;
    assert.deepEqual(await pinSources(), sourcePins, "Source unchanged during run"); assert.deepEqual(await pinBuild(), compiledPins, "Donor unchanged");
    assert.deepEqual(pageErrors, [], "Every pageerror is a failure; no __name/error allowlist"); assert.deepEqual(failures, []);
    assert.equal(continuedOrigins.filter(value => value !== origin).length, 0, "External routes always abort; attempted analytics remain recorded");
    assert.equal(results.length, 17, "Every authored case must finish");
    assert(results.every(result => result.status === "PASS"), "All required inbox cases must pass; inspect per-case failures");
  })(), "Entire compiled inbox control", 240000);
} catch (error) { stopping = true; mainFailed = true; mainFailure = error; }
finally {
  stopping = true;
  const clean = async (label: string, action: () => Promise<unknown>, done: () => void) => {
    try { await bounded(action(), label, 5000); done(); } catch (error) { cleanupFailures.push(error); }
  };
  await bounded((async () => {
    await clean("Browser close", async () => browser?.close(), () => { browserClosed = true; });
    await clean("Settle owned scenarios", async () => { await activeCase; }, () => undefined);
    await clean("Listener close", async () => {
      if (server.listening) { const closing = new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done()));
        server.closeIdleConnections(); server.closeAllConnections(); await closing; }
    }, () => { httpDrained = !server.listening; });
    if (app) {
      await clean("Instrumentation close", async () => { const instrumentation = require(join(fixture, ".next/server/instrumentation.js")) as { close(): Promise<boolean> };
        assert.equal(await instrumentation.close(), true); }, () => { instrumentationClosed = true; });
      await clean("Next close", () => app!.close(), () => { appClosed = true; });
      await clean("Trace flush", async () => require("next/dist/trace").flushAllTraces(), () => { tracesFlushed = true; });
    } else { instrumentationClosed = appClosed = tracesFlushed = true; }
  })(), "Outer owned cleanup", 35000).catch(error => { cleanupFailures.push(error); });
  Socket.prototype.connect = nativeConnect; globalThis.fetch = nativeFetch;
  try { process.chdir(previousCwd); for (const name of Object.keys(process.env)) delete process.env[name]; Object.assign(process.env, previousEnvironment); }
  catch (error) { cleanupFailures.push(error); }
  try {
    await writeFile(join(run, "synthetic-outcome.json"), JSON.stringify({ status: mainFailed || cleanupFailures.length ? "FAILED" : "PASS",
      scope: "Actual compiled route/UI/canonical hooks + SYNTHETIC same-origin auth/inbox HTTP only. No durable recipient or POSIX owner/financial/publication acceptance.",
      sourceToBuildAdmission: "Parent must retain actual exact-new-source/input build evidence. BUILD_ID alone is insufficient.",
      buildId, sourcePins, compiledPins, results, callEvidence, httpRequests, failures, pageErrors, externalAttempts,
      externalContinued: continuedOrigins.filter(value => value !== origin).length, continuedOrigins,
      naturalClose: { browserClosed, httpDrained, instrumentationClosed, appClosed, tracesFlushed,
        processExitObserved: null, stdoutEofObserved: null, stderrEofObserved: null },
      error: mainFailure instanceof Error ? { message: mainFailure.message, stack: mainFailure.stack } : mainFailed ? String(mainFailure) : null,
      cleanupFailures: cleanupFailures.map(error => error instanceof Error ? { message: error.message, stack: error.stack } : String(error)),
      note: "Parent captures genuine exit/close and both EOFs. Synthetic recipient receipt fixtures are never owner apply evidence or accepted durable receipts." }, null, 2) + "\n", { flag: "wx" });
  } catch (error) { cleanupFailures.push(error); }
  if (cleanupFailures.length) throw new AggregateError(mainFailed ? [mainFailure, ...cleanupFailures] : cleanupFailures, "Compiled inbox cleanup failed");
  if (mainFailed) throw mainFailure;
}
console.log("PASS: compiled owner269 synthetic inbox UI controls only; native owner/receipt/financial/publication and PR CI remain separate.");
