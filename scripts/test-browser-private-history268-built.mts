/** ORIGINAL268 compiled Next control, authored for a separately authorized parent run.
 * Uses the emitted /me/private-jobs page, WalletMenu, workspace, canonical hooks,
 * mounted API handlers, durable local session rows and the existing testnet SQLite
 * fixture boundary. Synthetic historical rows are NOT settlement/native evidence.
 * No build, installer, provider, real wallet, production selector or runner fallback.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { copyNextConfigFixture } from "../test-support/next-config-fixture";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const args = process.argv.slice(2);
assert.equal(args.length, 2, "Use --dist=ABSOLUTE --output=ABSOLUTE; parent reserves this run");
for (const flag of ["dist", "output"]) assert.equal(args.filter(a => a.startsWith(`--${flag}=`)).length, 1);
const dist = args.find(a => a.startsWith("--dist="))!.slice(7);
const output = args.find(a => a.startsWith("--output="))!.slice(9);
assert(isAbsolute(dist) && isAbsolute(output));
function inside(path: string, parent: string) {
  const part = relative(resolve(parent), resolve(path));
  return part !== "" && !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`);
}
assert(inside(output, join(root, "output")), "All mutable paths belong to this worktree/output");
assert(inside(await realpath(output), join(await realpath(root), "output")), "Owned output cannot redirect through a foreign junction");
assert(!inside(output, dist) && !inside(dist, output) && resolve(dist) !== resolve(output), "Read-only donor and owned output must be disjoint");
for (const [name, leaf] of [["TEMP", "temp"], ["TMP", "temp"], ["TSX_CACHE_DIR", "tsx-cache"]] as const)
  assert(process.env[name] && resolve(process.env[name]!) === resolve(output, leaf), `Parent must bind ${name} to owned output/${leaf}`);
const run = join(output, "run"), fixture = join(output, "runtime");
await mkdir(run); await mkdir(fixture); // Exclusive: never overwrite retained runs.
const require = createRequire(import.meta.url);
assert.equal(require("next/package.json").version, "16.3.8");
const buildId = (await readFile(join(dist, "BUILD_ID"), "utf8")).trim();
assert(buildId.length > 0 && buildId.length <= 128, "Missing bounded compiled BUILD_ID; parent must admit current build");
const appPaths = JSON.parse(await readFile(join(dist, "server/app-paths-manifest.json"), "utf8")) as Record<string, string>;
for (const key of ["/me/private-jobs/page", "/api/me/private-jobs/route", "/api/me/private-jobs/detail/route", "/api/me/private-jobs/export/route", "/api/auth/session/route", "/api/auth/signout/route"])
  assert(typeof appPaths[key] === "string", `Missing actual compiled partition ${key}`);
const clientReferences = await readFile(join(dist, "server/app/me/private-jobs/page_client-reference-manifest.js"), "utf8");
assert(clientReferences.includes("private-job-history-workspace"), "Actual compiled page must reference the real workspace");
// Keep the donor immutable, including runtime trace/cache writes. No source symlink,
// synthetic Next page, webpack alias, esbuild clone or auth-hook replacement.
await cp(dist, join(fixture, ".next"), { recursive: true, errorOnExist: true, force: false, dereference: true });
await copyNextConfigFixture(root, fixture);
// Only the installed dependency directory is borrowed read-only, as in the existing
// built-browser harness. Parent retains its dependency reservation/provenance.
const { symlink } = await import("node:fs/promises");
await symlink(join(root, "node_modules"), join(fixture, "node_modules"), process.platform === "win32" ? "junction" : "dir");

const pinnedPaths = ["scripts/test-browser-private-history268-built.mts", "scripts/test-private-job-history-workspace-browser.mts",
  "app/me/private-jobs/page.tsx", "components/keryx/private-job-history-workspace.tsx", "components/keryx/wallet-menu.tsx",
  "lib/hooks/use-siwe-auth.ts", "lib/history/private-job-history-contract.ts", "lib/history/private-job-history.ts",
  "lib/history/private-job-history-route.ts", "lib/history/private-job-history-mounted.ts", "lib/auth-session.ts",
  "lib/account-sessions.ts", "lib/db/sqlite-adapter.ts", "lib/db/private-research-intents.ts", "lib/db/private-research-results.ts",
  "app/api/me/private-jobs/route.ts", "app/api/me/private-jobs/detail/route.ts", "app/api/me/private-jobs/export/route.ts",
  "app/api/auth/session/route.ts", "app/api/auth/signout/route.ts", "instrumentation.ts", "next.config.ts",
  "test-support/next-config-fixture.ts", "package.json", "package-lock.json"];
async function pinSources() {
  return Promise.all(pinnedPaths.map(async path => {
    const bytes = await readFile(join(root, path));
    return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  }));
}
const sourcePins = await pinSources();
// Preserve the existing source control's finite 95s four-scenario observation
// budget. This does not advance clocks or terminate any owned process/resource.
async function bounded<T>(promise: Promise<T>, label: string, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: observation deadline exceeded`)), milliseconds);
  })]); } finally { clearTimeout(timer); }
}
const SESSION = "/api/auth/session", LOGOUT = "/api/auth/signout", LIST = "/api/me/private-jobs", DETAIL = `${LIST}/detail`;
const question = "SYNTHETIC ORIGINAL268 completed owner question";
const answer = "SYNTHETIC ORIGINAL268 retained answer <img src=x onerror=alert(1)>";
const hidden = "SYNTHETIC ORIGINAL268 read-only original transport";
type Notice = { type: "logout"; source: string; sequence: number; pending: boolean; confirmed: boolean };
type RequestRecord = { id: number; path: string; hookSession: boolean; started: number; ready: boolean; returned: boolean;
  aborted: boolean; abortAt: number | null; bodyCancelled: boolean; released: boolean; discarded: boolean };
type Snapshot = { realm: string; requests: RequestRecord[]; events: { value: Notice | string | null; at: number }[];
  messages: { value: Notice | string; at: number }[]; paints: string[]; transportErrors: string[] };
type Control = Snapshot & { hold(path: string, mode?: "transport" | "body", honorAbort?: boolean): void;
  release(id: number): void; post(value: Notice): void; flush(): Promise<void>; storm(source: string): void; close(): void };
type FixtureWindow = Window & typeof globalThis & { __private268Built: Control };

// Observation/finite transport-delay seam only. Responses always originate from the
// actual built API, using the real local session cookie and store. Held private/session
// responses deliberately ignore abort; logout ACKs honor the original real signal.
function observeBuiltPage({ question, answer, owner, jobId }: { question: string; answer: string; owner: string; jobId: string }) {
  const nativeFetch = window.fetch.bind(window), requests: (RequestRecord & { release?: () => void })[] = [];
  const events: Snapshot["events"] = [], messages: Snapshot["messages"] = [], paints: string[] = [], transportErrors: string[] = [];
  const plans: { path: string; mode: "transport" | "body"; honorAbort: boolean }[] = [], timers = new Set<ReturnType<typeof setTimeout>>();
  const refuse = (message: string): never => { transportErrors.push(message); throw Error(message); };
  const channel = new BroadcastChannel("keryx-auth-v1");
  const authEvent = (e: Event) => {
    if (events.length >= 512) refuse("Auth observation cap");
    events.push({ value: (e as CustomEvent).detail ?? null, at: performance.now() });
  };
  window.addEventListener("keryx:auth", authEvent, true);
  channel.onmessage = e => { if (messages.length >= 512) refuse("Channel observation cap"); messages.push({ value: e.data, at: performance.now() }); };
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.origin !== location.origin) refuse("External fetch forbidden");
    if (!["/api/auth/session", "/api/auth/signout", "/api/me/private-jobs", "/api/me/private-jobs/detail"].includes(url.pathname))
      return nativeFetch(input, init); // Router/static/incidental GETs remain real; host/context gates below bound them.
    const privateRead = url.pathname.startsWith("/api/me/private-jobs");
    if (url.search || url.hash || (init.method ?? "GET") !== (url.pathname === "/api/auth/session" ? "GET" : "POST")) refuse("Changed selector/method boundary");
    if (init.cache !== "no-store") refuse("Missing no-store");
    if (privateRead) {
      const headers = new Headers(init.headers);
      if (init.credentials !== "same-origin" || init.redirect !== "error" || init.referrerPolicy !== "no-referrer"
        || headers.get("content-type") !== "application/json" || headers.get("x-keryx-expected-wallet") !== owner) refuse("Changed private request boundary");
      if (typeof init.body !== "string" || new TextEncoder().encode(init.body).byteLength > 8192) refuse("Unbounded private input");
      const expected = url.pathname.endsWith("/detail") ? { id: jobId } : { limit: 25 };
      if (JSON.stringify(JSON.parse(init.body as string)) !== JSON.stringify(expected)) refuse("Changed exact synthetic request");
    }
    if (requests.length >= 512) refuse("Request observation cap");
    // LocaleProvider also looks up sessions, with explicit credentials. Hold only
    // the two canonical hook lookups; do not confuse the real locale consumer with them.
    const hookSession = url.pathname === "/api/auth/session" && init.credentials === undefined;
    const index = plans.findIndex(p => p.path === url.pathname && (p.path !== "/api/auth/session" || hookSession));
    const plan = index < 0 ? null : plans.splice(index, 1)[0];
    const item: RequestRecord & { release?: () => void } = { id: requests.length, path: url.pathname, hookSession, started: performance.now(), ready: false,
      returned: false, aborted: false, abortAt: null, bodyCancelled: false, released: false, discarded: false };
    requests.push(item);
    const signal = init.signal;
    const aborted = () => { item.aborted = true; item.abortAt ??= performance.now(); };
    signal?.addEventListener("abort", aborted, { once: true }); if (signal?.aborted) aborted();
    const response = await nativeFetch(input, plan ? { ...init, signal: undefined } : init);
    if (response.headers.get("cache-control") !== "no-store") refuse("Built API lost private no-store");
    if (privateRead && (response.headers.get("referrer-policy") !== "no-referrer"
      || response.headers.get("x-robots-tag") !== "noindex, nofollow"
      || response.headers.get("vary") !== "Cookie, Authorization, X-Keryx-Expected-Wallet")) refuse("Built API lost private response headers");
    if (!plan) { item.ready = item.returned = true; return response; }
    if (plan.mode === "body") {
      const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.length > 1_500_000) refuse("Private response cap");
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; }, cancel() { item.bodyCancelled = true; } });
      item.release = () => { item.released = true; if (item.bodyCancelled) { item.discarded = true; return; } controller.enqueue(bytes); controller.close(); };
      item.ready = item.returned = true; return new Response(stream, { status: response.status, headers: response.headers });
    }
    return new Promise<Response>((done, fail) => {
      let settled = false;
      const cancel = () => { if (!plan.honorAbort || settled) return; settled = true; fail(signal?.reason); };
      item.release = () => {
        item.released = true; signal?.removeEventListener("abort", cancel);
        if (settled) { item.discarded = true; void response.body?.cancel(); return; }
        settled = true; item.returned = true; done(response);
      };
      signal?.addEventListener("abort", cancel, { once: true }); item.ready = true; if (signal?.aborted) cancel();
    });
  };
  const mutation = new MutationObserver(() => {
    const text = document.querySelector("main")?.textContent ?? "";
    if (text.includes(question) || text.includes(answer)) { if (paints.length >= 256) refuse("Paint observation cap"); paints.push(text.slice(0, 32768)); }
  });
  mutation.observe(document, { subtree: true, childList: true, characterData: true });
  (window as FixtureWindow).__private268Built = {
    realm: crypto.randomUUID(), requests, events, messages, paints, transportErrors,
    hold(path, mode = "transport", honorAbort = false) { if (plans.length >= 8) refuse("Hold cap"); plans.push({ path, mode, honorAbort }); },
    release(id) { const item = requests[id]; if (!item?.ready || !item.release || item.released) refuse("Invalid original response release"); item.release!(); },
    post(value) { const sender = new BroadcastChannel("keryx-auth-v1"); sender.postMessage(value); sender.close(); },
    flush: () => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
    storm(source) { let sequence = 1; for (const ms of [5000, 10000, 18000]) {
      const timer = setTimeout(() => { timers.delete(timer); for (let n = 0; n < 8; n++) channel.postMessage({ type: "logout", source, sequence: ++sequence, pending: true, confirmed: true }); }, ms);
      timers.add(timer);
    } },
    close() { for (const timer of timers) clearTimeout(timer); timers.clear(); mutation.disconnect(); channel.close();
      window.removeEventListener("keryx:auth", authEvent, true); window.fetch = nativeFetch; },
  };
}

const previousCwd = process.cwd(), previousEnvironment = { ...process.env }, nativeFetch = globalThis.fetch;
let mainFailed = false, mainFailure: unknown;
const cleanupFailures: unknown[] = [];
let browser: Browser | undefined, app: ReturnType<NextFactory> | undefined;
let fixtureDb: import("../lib/db/sqlite-adapter").SqliteAdapter | undefined;
let raw: import("node:sqlite").DatabaseSync | undefined;
type NextFactory = (options: { dev: false; dir: string; hostname: string; port: number; httpServer: ReturnType<typeof createServer> }) => {
  prepare(): Promise<void>; close(): Promise<void>; getRequestHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  server: { getServer(): Promise<{ prepare(): Promise<void> }> };
};
const httpRequests: { method: string; path: string }[] = [], failures: string[] = [], pageErrors: string[] = [], externalAttempts: string[] = [];
let unavailablePrefetches = 0;
const transportObservations = { fetchGuardEntries: 0, listenerEntries: 0, connections: 0 };
const results: object[] = [];
let origin = "";
const server = createServer(async (req, res) => {
  transportObservations.listenerEntries++;
  try {
    assert.equal(req.headers.host, new URL(origin).host, "Exact loopback host");
    assert(httpRequests.length < 1024, "Finite built HTTP request budget");
    const url = new URL(req.url!, origin), method = req.method ?? "";
    httpRequests.push({ method, path: url.pathname });
    // Incidental public header/locale consumers have no bearing on private history.
    // Explicit unavailable fixtures prevent public-ledger or preference side effects.
    if (["/api/payments", "/api/me/locale-preference"].includes(url.pathname) && method === "GET") {
      res.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end('{"error":"synthetic incidental consumer unavailable"}'); return;
    }
    if (method === "GET" && req.headers["next-router-prefetch"] === "1"
      && !["/me/private-jobs", "/about"].includes(url.pathname) && !url.pathname.startsWith("/_next/")) {
      unavailablePrefetches++; res.writeHead(503, { "Cache-Control": "no-store" }); res.end(); return;
    }
    if (url.pathname.startsWith("/api/")) {
      assert([SESSION, LOGOUT, LIST, DETAIL, `${LIST}/export`].includes(url.pathname), "No payment/research/provider/mutation endpoints");
      assert.equal(url.search, "", "No private selector URL");
    } else {
      assert.equal(method, "GET");
      assert(["/me/private-jobs", "/about", "/favicon.ico"].includes(url.pathname) || url.pathname.startsWith("/_next/"), "Finite actual page/asset routes");
    }
    assert(app, "Next was prepared before first request");
    console.log(`Compiled listener request ${httpRequests.length}: entering Next`);
    await app.getRequestHandler()(req, res);
    console.log(`Compiled listener request ${httpRequests.length}: Next handler returned`);
  } catch { failures.push("Built loopback request refused"); if (!res.headersSent) res.writeHead(500); res.end(); }
});
server.on("connection", () => { transportObservations.connections++; });
server.headersTimeout = 5000; server.requestTimeout = 10000; server.keepAliveTimeout = 500;

const snapshot = (page: Page): Promise<Snapshot> => page.evaluate(() => {
  const c = (window as FixtureWindow).__private268Built;
  return { realm: c.realm, requests: c.requests.map(({ release: ignored, ...r }: RequestRecord & { release?: unknown }) => { void ignored; return r; }),
    events: c.events, messages: c.messages, paints: c.paints, transportErrors: c.transportErrors };
});
const flush = (page: Page) => page.evaluate(() => (window as FixtureWindow).__private268Built.flush());
const workspace = (page: Page) => page.locator("main");
const hold = (page: Page, path: string, mode: "transport" | "body" = "transport", honorAbort = false) =>
  page.evaluate(p => (window as FixtureWindow).__private268Built.hold(p.path, p.mode, p.honorAbort), { path, mode, honorAbort });
async function release(page: Page, id: number) { await page.evaluate(id => (window as FixtureWindow).__private268Built.release(id), id); await flush(page); }
async function post(page: Page, value: Notice) {
  const after = (await snapshot(page)).messages.length;
  await page.evaluate(value => (window as FixtureWindow).__private268Built.post(value), value);
  await page.waitForFunction(p => (window as FixtureWindow).__private268Built.messages.slice(p.after).some(m => JSON.stringify(m.value) === p.encoded), { after, encoded: JSON.stringify(value) });
  await flush(page);
}
async function received(page: Page, source?: string, sequence = 1) {
  await page.waitForFunction(p => (window as FixtureWindow).__private268Built.messages.some(m => typeof m.value === "object"
    && m.value.type === "logout" && (!p.source || m.value.source === p.source) && m.value.sequence === p.sequence), { source, sequence });
  return (await snapshot(page)).messages.find(m => typeof m.value === "object" && (!source || m.value.source === source) && m.value.sequence === sequence)!.value as Notice;
}
async function held(page: Page, path: string, after: number) {
  await page.waitForFunction(p => (window as FixtureWindow).__private268Built.requests.some(r => r.id >= p.after && r.path === p.path && r.ready && !r.released), { path, after });
  const record = (await snapshot(page)).requests.find(r => r.id >= after && r.path === path && r.ready && !r.released)!;
  assert(!record.aborted, "Original attempt must be live at the observed boundary"); return record;
}
async function cleared(page: Page, paintStart?: number) {
  await workspace(page).getByRole("link", { name: "Sign in to view completed private jobs", exact: true }).waitFor(); await flush(page);
  for (const text of [question, answer]) assert.equal(await workspace(page).getByText(text, { exact: true }).count(), 0);
  if (paintStart !== undefined) assert.deepEqual((await snapshot(page)).paints.slice(paintStart), [], "No transient stale private repaint");
}
async function saved(page: Page) {
  await workspace(page).getByRole("button", { name: "View saved result", exact: true }).click();
  await workspace(page).getByText(answer, { exact: true }).waitFor();
  assert.equal(await workspace(page).locator("img").count(), 0);
  const result = workspace(page).getByRole("region", { name: "Saved private result", exact: true });
  await result.getByText("Own settled source spend: unavailable (NULL). Creator rewards: unavailable (NULL). Paid creators: unavailable (NULL).", { exact: true }).waitFor();
  await result.getByText("Recorded network: eip155:5042002. Surface: UNKNOWN / legacy; ownership method: UNKNOWN / legacy.", { exact: true }).waitFor();
}
async function pendingDetail(page: Page, mode: "transport" | "body" = "transport") {
  await workspace(page).getByRole("button", { name: "Close result", exact: true }).click();
  const after = (await snapshot(page)).requests.length; await hold(page, DETAIL, mode);
  await workspace(page).getByRole("button", { name: "View saved result", exact: true }).click(); return held(page, DETAIL, after);
}
async function staleHookSessions(page: Page) {
  const after = (await snapshot(page)).requests.length;
  await hold(page, SESSION); await hold(page, SESSION);
  // Descendant focus reaches the real hook's window refresh listener, while the
  // accepted workspace target===currentTarget filter leaves its current IO alive.
  await page.evaluate(() => document.body.dispatchEvent(new FocusEvent("focus", { bubbles: true })));
  await page.waitForFunction(after => (window as FixtureWindow).__private268Built.requests.filter(r => r.id >= after && r.hookSession && r.ready).length === 2, after);
  return (await snapshot(page)).requests.filter(r => r.id >= after && r.hookSession);
}
async function logout(page: Page) {
  await page.locator("header").getByRole("button", { name: /asker/ }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
}
async function focus(page: Page) { await page.evaluate(() => window.dispatchEvent(new Event("focus"))); }

try {
  await new Promise<void>((done, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", done); });
  const address = server.address(); assert(address && typeof address !== "string"); origin = `http://127.0.0.1:${address.port}`;
  // Closed runtime environment, never inherit provider/custody/storage deployment
  // variables or load an envfile. This mutation occurs ONLY in a future parent run.
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "production", BASE_URL: origin, JWT_SECRET: randomBytes(32).toString("hex"),
    KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1",
    KERYX_EXTERNAL_DISCOVERY: "0", KERYX_WEB_RESEARCH: "0", NEXT_TELEMETRY_DISABLED: "1",
    TEMP: join(output, "temp"), TMP: join(output, "temp"), TSX_CACHE_DIR: join(output, "tsx-cache") };
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "USERPROFILE", "COMSPEC", "PATHEXT"])
    if (previousEnvironment[name]) environment[name] = previousEnvironment[name];
  for (const name of Object.keys(process.env)) delete process.env[name]; Object.assign(process.env, environment); process.chdir(fixture);
  globalThis.fetch = (input, init) => {
    transportObservations.fetchGuardEntries++;
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.origin, origin, "No server external fetch"); return nativeFetch(input, init);
  };
  const { SqliteAdapter } = await import("../lib/db/sqlite-adapter");
  const { issueWebSession } = await import("../lib/auth-session");
  const { DatabaseSync } = await import("node:sqlite");
  const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
  const { createPrivateAuthorization } = await import("../lib/buyer/private-request-commitment");
  const { BUYER_NETWORK, BUYER_USDC, BUYER_GATEWAY, buyerTypedData } = await import("../lib/buyer/protocol");
  const { preparePrivateResearchIntent } = await import("../lib/a2a/private-research-intent");
  assert.equal(BUYER_NETWORK, "eip155:5042002", "Synthetic fixture may not select mainnet");
  fixtureDb = new SqliteAdapter(join(fixture, "data/keryx.sqlite")); await fixtureDb.init();
  raw = new DatabaseSync(join(fixture, "data/keryx.sqlite"));
  const account = privateKeyToAccount(generatePrivateKey()), owner = account.address.toLowerCase();
  const merchants = { privatePayee: `0x${"ab".repeat(20)}`, publicResearchPayee: `0x${"cd".repeat(20)}` };
  const requirement = { scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC, amount: "50000", payTo: merchants.privatePayee,
    maxTimeoutSeconds: 604860, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } };
  const request = { question, budget: 0.03, researchMode: "quick", packageVersion: "1.0.0", responseMode: "async", access: "payer-private-v1", model: null };
  const fresh = await createPrivateAuthorization(request, requirement, owner, merchants, 1788912000000);
  const signature = await account.signTypedData(buyerTypedData(fresh.authorization)); // Unfunded ephemeral local fixture only; never exported/submitted.
  const intent = await preparePrivateResearchIntent({ request: fresh.request, salt: fresh.salt, payment: { authorization: fresh.authorization, signature } }, requirement, merchants);
  const jobId = intent.id, timestamp = "2026-10-01T00:00:00.000Z";
  // Existing private-history SQLite fixture INSERT pattern. These synthesized
  // backend bytes exercise unchanged readers, NOT facilitator/native admission.
  // No payment/claim/result producer is called and no private original is updated.
  raw.prepare("INSERT INTO private_research_intents(id,payer,data,created_at) VALUES(?,?,?,?)").run(jobId, owner, JSON.stringify(intent), timestamp);
  const confirmation = { source: "circle-facilitator-success", transaction: "synthetic-only-no-settlement", network: BUYER_NETWORK,
    payer: owner, payee: merchants.privatePayee, amountMicros: "50000", authorizationId: fresh.authorization.nonce };
  raw.prepare("INSERT INTO private_research_payment_attempts(id,started_at,confirmation,settled_at) VALUES(?,?,?,?)").run(jobId, timestamp, JSON.stringify(confirmation), timestamp);
  raw.prepare("INSERT INTO private_research_executions(id,worker_id,started_at) VALUES(?,?,?)").run(jobId, randomUUID(), timestamp);
  const serialized = JSON.stringify({ id: jobId, question, budget: 0.03, researchMode: "quick", paymentMode: "real", fundingOwner: "treasury", origin: "a2a",
    asker: owner, answer, engine: "synthetic-only-no-provider", createdAt: timestamp, subClaims: [], decisions: [], citations: [], ciphertext: hidden });
  raw.prepare("INSERT INTO private_research_results(id,serialized_run,saved_at) VALUES(?,?,?)").run(jobId, serialized, timestamp);
  const originals = () => JSON.stringify([raw!.prepare("SELECT * FROM private_research_intents").all(), raw!.prepare("SELECT * FROM private_research_payment_attempts").all(),
    raw!.prepare("SELECT * FROM private_research_executions").all(), raw!.prepare("SELECT * FROM private_research_results").all()]);
  const originalBytes = originals();
  app = (require("next") as NextFactory)({ dev: false, dir: fixture, hostname: "127.0.0.1", port: address.port, httpServer: server });
  await app.prepare();
  // Pinned Next16 production wrapper does not await the underlying preparation.
  // Await the genuine server promise that its first handleRequest also awaits.
  const preparedNext = await app.server.getServer();
  await preparedNext.prepare();
  console.log("Compiled actual Next server: prepared");
  const privateHeaders = (response: Response) => {
    for (const [name, value] of [["cache-control", "no-store"], ["referrer-policy", "no-referrer"], ["x-robots-tag", "noindex, nofollow"]]) assert.equal(response.headers.get(name), value);
  };
  let httpProbe = 0;
  const http = async (path: string, init: RequestInit = {}) => {
    const probe = ++httpProbe;
    console.log(`Compiled HTTP probe ${probe}: start`, { listening: server.listening, exactAddress: JSON.stringify(server.address()) === JSON.stringify(address), requestListeners: server.listenerCount("request"), ...transportObservations });
    try {
      const response = await fetch(origin + path, { ...init, signal: AbortSignal.timeout(8000) });
      console.log(`Compiled HTTP probe ${probe}: response ${response.status}`);
      return response;
    } catch (cause) { console.log("Compiled transport failure observations", { listening: server.listening, requestListeners: server.listenerCount("request"), ...transportObservations }); throw new Error(`Compiled HTTP probe ${probe}: failed`, { cause }); }
  };
  for (const path of ["/me/private-jobs", "/me/private-jobs?_rsc=private268-built"]) {
    const response = await http(path, path.includes("?") ? { headers: { RSC: "1", "Next-Url": "/me/private-jobs" } } : {});
    assert.equal(response.status, 200); privateHeaders(response);
    const wire = await response.text(); assert(wire.length < 2 * 1024 * 1024);
    assert(!wire.includes(question) && !wire.includes(answer) && !wire.includes(owner), "HTTP/RSC shell carries no private fixture data");
    if (path.includes("?")) assert(response.headers.get("content-type")?.includes("text/x-component"), "Actual compiled RSC boundary");
  }
  // Probe the mounted compiled routes themselves, not the unmounted factory.
  for (const path of [LIST, DETAIL, `${LIST}/export`]) {
    const method = await http(path); assert.equal(method.status, 405); privateHeaders(method); assert.equal(method.headers.get("allow"), "POST"); await method.arrayBuffer();
    const unauthenticated = await http(path, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(unauthenticated.status, 401); privateHeaders(unauthenticated); await unauthenticated.arrayBuffer();
    const foreignOrigin = await http(path, { method: "POST", headers: { Origin: "https://synthetic-foreign.invalid", "Content-Type": "application/json" }, body: "{}" });
    assert.equal(foreignOrigin.status, 403); privateHeaders(foreignOrigin); await foreignOrigin.arrayBuffer();
  }
  const boundarySession = await issueWebSession(fixtureDb, environment.JWT_SECRET!, owner, "asker");
  const boundaryHeaders = { Origin: origin, Cookie: `keryx_session=${boundarySession.token}`, "Content-Type": "application/json" };
  for (const [headers, body, status] of [
    [{ ...boundaryHeaders, "X-Keryx-Expected-Wallet": `0x${"bb".repeat(20)}` }, { limit: 25 }, 409],
    [{ ...boundaryHeaders, Authorization: "Bearer invalid-synthetic-key" }, { limit: 25 }, 401],
    [boundaryHeaders, { limit: 25, ownerWallet: owner }, 400],
  ] as const) {
    const refused = await http(LIST, { method: "POST", headers, body: JSON.stringify(body) });
    assert.equal(refused.status, status); privateHeaders(refused); const wire = await refused.text();
    for (const value of [question, answer, hidden, jobId]) assert(!wire.includes(value), "Actual compiled refusal releases no private fixture data");
  }
  browser = await chromium.launch({ headless: true, timeout: 15000 });
  async function pair(name: string, test: (a: Page, b: Page, freshSession: () => Promise<void>) => Promise<void>) {
    const context = await browser!.newContext({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } }); context.setDefaultTimeout(8000);
    await context.addInitScript(observeBuiltPage, { question, answer, owner, jobId });
    await context.route("**/*", route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      externalAttempts.push("External browser request refused"); return route.abort("blockedbyclient");
    });
    const a = await context.newPage(), b = await context.newPage();
    for (const page of [a, b]) page.on("pageerror", () => pageErrors.push(`${name}: browser exception`));
    const freshSession = async () => {
      const issued = await issueWebSession(fixtureDb!, environment.JWT_SECRET!, owner, "asker");
      await context.addCookies([{ name: "keryx_session", value: issued.token, url: origin, httpOnly: true, sameSite: "Lax" }]);
    };
    try {
      await a.goto(`${origin}/me/private-jobs`); await b.goto(`${origin}/me/private-jobs`); await cleared(a); await cleared(b);
      for (const page of [a, b]) assert.equal((await snapshot(page)).requests.filter(r => r.path.startsWith(LIST)).length, 0, "No session means no private IO");
      assert.notEqual((await snapshot(a)).realm, (await snapshot(b)).realm);
      assert.equal(await a.evaluate(() => location.origin), origin); assert.equal(await b.evaluate(() => location.origin), origin);
      await freshSession();
      for (const page of [a, b]) { await focus(page); await workspace(page).getByText(question, { exact: true }).waitFor(); await saved(page); }
      await test(a, b, freshSession);
      for (const page of [a, b]) if (!page.isClosed()) {
        assert.deepEqual((await snapshot(page)).transportErrors, []);
        const persistence = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
        for (const value of [question, answer, jobId, hidden, signature, fresh.salt, fresh.authorization.nonce]) assert(!persistence.includes(value), "No private result/transport browser persistence");
        await page.evaluate(() => (window as FixtureWindow).__private268Built.close()); await page.close();
      }
      assert.equal(originals(), originalBytes, "All four original private tables stayed byte-identical");
      assert.deepEqual(failures, []); assert.deepEqual(pageErrors, []); assert.deepEqual(externalAttempts, []);
      results.push({ case: name, passed: true });
    } finally { try { await context.close(); } catch (error) { cleanupFailures.push(error); } }
  }
  await bounded((async () => {
  await pair("normal-json-ack-and-two-tab-stale-fences", async (a, b) => {
    const da = await pendingDetail(a), db = await pendingDetail(b, "body"), sa = await staleHookSessions(a), sb = await staleHookSessions(b);
    await hold(a, LOGOUT, "transport", true); await logout(a); const start = await received(b); await cleared(a); await cleared(b);
    const ack = await held(a, LOGOUT, 0), aa = await snapshot(a), bb = await snapshot(b);
    assert(aa.requests[da.id].aborted && aa.requests[da.id].abortAt! <= ack.started, "Local private cancellation precedes signout HTTP");
    assert(bb.requests[db.id].aborted && bb.requests[db.id].bodyCancelled, "Peer cancels actual body reader");
    await post(b, { ...start, pending: false, confirmed: true }); // Duplicate sequence cannot end publisher authority.
    const pa = (await snapshot(a)).paints.length, pb = (await snapshot(b)).paints.length;
    await release(a, da.id); await release(b, db.id);
    for (const r of sa) await release(a, r.id); for (const r of sb) await release(b, r.id);
    await cleared(a, pa); await cleared(b, pb); await release(a, ack.id); await received(b, start.source, 2);
    await a.waitForFunction(() => (window as FixtureWindow).__private268Built.events.some(e => e.value === "signed-out"));
    assert(!(await snapshot(a)).requests[ack.id].aborted, "Normal successful JSON ACK did not time out");
    assert.equal((await snapshot(a)).events.filter(e => e.value === "signed-out").length, 1);
    assert.equal((await snapshot(b)).events.filter(e => e.value === "signed-out").length, 0, "Peer confirmation never grants auth authority");
    await cleared(a, pa); await cleared(b, pb);
  });
  await pair("local-workspace-unmount-has-no-peer-authority", async (a, b) => {
    const da = await pendingDetail(a), db = await pendingDetail(b), before = await snapshot(b);
    // Actual Next client navigation unmounts the actual page/workspace. Removing DOM
    // nodes or calling a test root's unmount would not establish this behavior.
    await a.locator("header").getByRole("link", { name: "About", exact: true }).click(); await a.waitForURL(`${origin}/about`);
    await flush(a); await flush(b); assert((await snapshot(a)).requests[da.id].aborted);
    assert(!(await snapshot(b)).requests[db.id].aborted, "Peer still owns its request before completion/finally abort");
    assert.deepEqual((await snapshot(b)).events, before.events, "Local navigation publishes no peer auth boundary");
    await release(b, db.id); await workspace(b).getByText(answer, { exact: true }).waitFor();
    await release(a, da.id); assert.equal(await workspace(a).getByText(answer, { exact: true }).count(), 0);
    assert(!(await snapshot(a)).messages.some(m => typeof m.value === "object" && m.value.type === "logout"));
  });
  await pair("real-15s-abort-is-not-a-normal-ack", async (a, b) => {
    const da = await pendingDetail(a), db = await pendingDetail(b), sa = await staleHookSessions(a), sb = await staleHookSessions(b);
    await hold(a, LOGOUT, "transport", true); await logout(a); const start = await received(b); await cleared(a); await cleared(b);
    await a.waitForFunction(() => (window as FixtureWindow).__private268Built.requests.some(r => r.path === "/api/auth/signout" && r.ready && r.aborted), undefined, { timeout: 18000 });
    await received(b, start.source, 2); const ack = (await snapshot(a)).requests.find(r => r.path === LOGOUT)!;
    const elapsed = ack.abortAt! - ack.started; assert(elapsed >= 14900 && elapsed <= 17000, "Original 15000ms abort, at most 2s scheduling slack");
    const pa = (await snapshot(a)).paints.length, pb = (await snapshot(b)).paints.length;
    assert.equal((await snapshot(a)).events.filter(e => e.value === "signed-out").length, 0);
    await release(a, ack.id); assert((await snapshot(a)).requests[ack.id].discarded, "Late ACK discarded");
    await release(a, da.id); await release(b, db.id); for (const r of sa) await release(a, r.id); for (const r of sb) await release(b, r.id);
    await cleared(a, pa); await cleared(b, pb); assert.equal((await snapshot(a)).events.filter(e => e.value === "signed-out").length, 0);
    results.push({ observation: "logout-abort", elapsedMs: elapsed, lateAckDiscarded: true });
  });
  await pair("vanished-publisher-real-20s-lease-and-fresh-epoch", async (a, b, freshSession) => {
    const db = await pendingDetail(b), sb = await staleHookSessions(b);
    await hold(a, LOGOUT, "transport", true); await logout(a); const start = await received(b); await cleared(b);
    await held(a, LOGOUT, 0); // Actual route completed revocation before publisher disappearance.
    const before = await snapshot(b), first = before.events.find(e => typeof e.value === "object" && e.value?.source === start.source && e.value.pending)!;
    const pb = before.paints.length, lookups = before.requests.filter(r => r.hookSession).length;
    await a.close(); // Genuine document disappearance, no synthetic terminal/hook substitute.
    await b.evaluate(source => (window as FixtureWindow).__private268Built.storm(source), start.source);
    await b.waitForFunction(source => (window as FixtureWindow).__private268Built.events.some(e => typeof e.value === "object"
      && e.value?.source === source && !e.value.pending), start.source, { timeout: 23000 }); await flush(b);
    const expired = await snapshot(b), end = expired.events.find(e => typeof e.value === "object" && e.value?.source === start.source && !e.value.pending)!;
    const elapsed = end.at - first.at; assert(elapsed >= 19900 && elapsed <= 22000, "Original first-start 20000ms lease survives 24 higher pending claims");
    assert.equal((end.value as Notice).sequence, 25); assert.equal((end.value as Notice).confirmed, false);
    assert.equal(expired.requests.filter(r => r.hookSession).length, lookups, "Expiry/storm obtains no canonical session authority");
    await post(b, { type: "logout", source: "synthetic-unrelated-no-authority", sequence: 1, pending: false, confirmed: true });
    await release(b, db.id); for (const r of sb) await release(b, r.id); await cleared(b, pb);
    await contextNullCheck(b); // Real revoked cookie returns 401 before a fresh local session.
    await freshSession(); const freshStart = (await snapshot(b)).requests.length;
    await hold(b, SESSION); await hold(b, SESSION); await hold(b, LIST); await focus(b);
    await b.waitForFunction(after => (window as FixtureWindow).__private268Built.requests.filter(r => r.id >= after && r.hookSession && r.ready).length === 2, freshStart);
    const freshReads = (await snapshot(b)).requests.filter(r => r.id >= freshStart && r.hookSession);
    const exhausted = (sequence: number, pending = true): Notice => ({ ...start, sequence, pending, confirmed: true });
    const eventCount = (await snapshot(b)).events.length; await post(b, exhausted(26)); assert.equal((await snapshot(b)).events.length, eventCount);
    for (const r of freshReads) await release(b, r.id); const newList = await held(b, LIST, freshStart);
    await post(b, exhausted(27)); assert(!(await snapshot(b)).requests[newList.id].aborted, "Exhausted interval cannot cancel fresh HTTP epoch");
    await release(b, newList.id); await workspace(b).getByText(question, { exact: true }).waitFor(); await saved(b);
    const retained = await snapshot(b); await post(b, exhausted(24, false)); await post(b, exhausted(28)); await flush(b);
    await workspace(b).getByText(answer, { exact: true }).waitFor();
    assert.equal((await snapshot(b)).requests.filter(r => r.hookSession || r.path.startsWith(LIST)).length,
      retained.requests.filter(r => r.hookSession || r.path.startsWith(LIST)).length, "Stale hints start no canonical lookup/private read");
    assert.equal((await snapshot(b)).events.length, retained.events.length);
    const newDetail = await pendingDetail(b); await post(b, exhausted(29, false)); await cleared(b);
    assert((await snapshot(b)).requests[newDetail.id].aborted); const terminalPaint = (await snapshot(b)).paints.length;
    await release(b, newDetail.id); await cleared(b, terminalPaint);
    await post(b, exhausted(30)); await post(b, exhausted(31, false)); await cleared(b, terminalPaint);
    await focus(b); await workspace(b).getByText(question, { exact: true }).waitFor();
    assert.equal((await snapshot(b)).events.filter(e => e.value === "signed-out").length, 0);
    results.push({ observation: "receiver-lease", elapsedMs: elapsed, pendingStormClaims: 24, freshHttpEpoch: true });
  });
  async function contextNullCheck(page: Page) {
    const after = (await snapshot(page)).requests.length; await focus(page);
    await page.waitForFunction(after => (window as FixtureWindow).__private268Built.requests.filter(r => r.id >= after && r.hookSession && r.ready).length === 2, after);
    await cleared(page);
  }
  })(), "Whole finite four-scenario compiled control", 95000);
  assert.deepEqual(await pinSources(), sourcePins, "Source unchanged during compiled control");
  await writeFile(join(run, "synthetic-evidence.json"), JSON.stringify({
    scope: "Actual emitted Next page/hooks/mounted API + synthetic disposable testnet SQLite/session fixtures. No native/settlement/MCP/production acceptance.",
    buildId, node: process.version, next: "16.3.8", browser: browser.version(), sourcePins, results, requests: httpRequests,
    privateOriginalsUnchanged: originals() === originalBytes, externalAttempts: externalAttempts.length, unavailablePrefetches,
    sourceToBuildAdmission: "Parent must supply the existing exact-source/input build evidence; observing BUILD_ID alone does not establish it.",
  }, null, 2) + "\n", { flag: "wx" });
} catch (error) {
  mainFailed = true; mainFailure = error;
} finally {
  // No process exit/kill/unref, fabricated EOF, or time-based teardown. Parent must
  // capture real exit + close + both stream EOFs with its existing capture utility.
  let browserClosed = browser === undefined, instrumentationClosed = app === undefined, appClosed = app === undefined, tracesFlushed = app === undefined;
  try { await browser?.close(); browserClosed = true; } catch (error) { cleanupFailures.push(error); }
  try { if (server.listening) await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done())); } catch (error) { cleanupFailures.push(error); }
  if (app) {
    try {
      const instrumentation = require(join(fixture, ".next/server/instrumentation.js")) as { close(): Promise<boolean> };
      assert.equal(await instrumentation.close(), true, "Actual compiled boot module must close its owned indexer");
      instrumentationClosed = true;
    } catch (error) { cleanupFailures.push(error); }
    try { await app.close(); appClosed = true; } catch (error) { cleanupFailures.push(error); }
    try { await require("next/dist/trace").flushAllTraces(); tracesFlushed = true; } catch (error) { cleanupFailures.push(error); }
  }
  try { raw?.close(); } catch (error) { cleanupFailures.push(error); }
  try { fixtureDb?.close(); } catch (error) { cleanupFailures.push(error); }
  try { globalThis.fetch = nativeFetch; } catch (error) { cleanupFailures.push(error); }
  try { process.chdir(previousCwd); } catch (error) { cleanupFailures.push(error); }
  try {
    for (const name of Object.keys(process.env)) delete process.env[name]; Object.assign(process.env, previousEnvironment);
  } catch (error) { cleanupFailures.push(error); }
  try {
    await writeFile(join(run, "natural-close.json"), JSON.stringify({ listenerClosed: !server.listening, browserCloseCompleted: browserClosed,
      transportObservations, instrumentationClosed, appClosed, tracesFlushed, mainFailureObserved: mainFailed, cleanupFailureCount: cleanupFailures.length,
      processExitObserved: null, stdoutEofObserved: null, stderrEofObserved: null,
      note: "Process lifetime/EOF fields belong to the parent's actual capture. Original failure and every cleanup cause/stack are retained in the thrown error/AggregateError; no error payload is serialized here." }, null, 2) + "\n", { flag: "wx" });
  } catch (error) { cleanupFailures.push(error); }
  if (cleanupFailures.length) throw new AggregateError(mainFailed ? [mainFailure, ...cleanupFailures] : cleanupFailures,
    "Compiled fixture natural cleanup failed; retain parent failure capture", mainFailed ? { cause: mainFailure } : undefined);
  if (mainFailed) throw mainFailure;
}
console.log("PASS: compiled Next private268 four synthetic scenarios and natural owned cleanup; no settlement, native, MCP or production proof.");
