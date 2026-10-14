/** Current compiled Next private boundary only. No build/install, live login,
 * account schema enrollment, provider, wallet signature, research or payment. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink } from "node:fs/promises";
import { createServer, request, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { createServer as createListener } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SignJWT } from "jose";
import { copyNextConfigFixture } from "../test-support/next-config-fixture";

const source = resolve(import.meta.dirname, ".."), dist = join(source, ".next");
const buildId = (await readFile(join(dist, "BUILD_ID"), "utf8")).trim();
assert(buildId, "The CI lane's completed current default production build is required");
const manifest = JSON.parse(await readFile(join(dist, "routes-manifest.json"), "utf8")) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const security = manifest.headers.find(rule => rule.source === "/(.*)")?.headers;
assert(security?.some(header => header.key.toLowerCase() === "content-security-policy"), "Compiled global security policy required");
const fixture = await mkdtemp(join(tmpdir(), "keryx-account-private-built-"));
await mkdir(join(fixture, "data")); await mkdir(join(fixture, "tmp"));
await copyNextConfigFixture(source, fixture);
await symlink(join(source, "node_modules"), join(fixture, "node_modules"), process.platform === "win32" ? "junction" : "dir");
await symlink(dist, join(fixture, ".next"), process.platform === "win32" ? "junction" : "dir");
const listener = createListener();
await new Promise<void>((accept, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", accept); });
const address = listener.address(); assert(address && typeof address !== "string"); const port = address.port;
await new Promise<void>((accept, reject) => listener.close(error => error ? reject(error) : accept()));
const origin = `http://127.0.0.1:${port}`, secret = "synthetic-account-private-built-not-a-live-secret";
const environment: NodeJS.ProcessEnv = { NODE_ENV: "production" };
for (const key of ["PATH", "SystemRoot", "WINDIR", "ComSpec", "PATHEXT"])
  if (process.env[key]) environment[key] = process.env[key];
Object.assign(environment, {
  NODE_ENV: "production", NODE_OPTIONS: "", NEXT_TELEMETRY_DISABLED: "1", BASE_URL: origin, JWT_SECRET: secret,
  TEMP: join(fixture, "tmp"), TMP: join(fixture, "tmp"), TMPDIR: join(fixture, "tmp"),
  KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1",
  KERYX_EXTERNAL_DISCOVERY: "0", KERYX_WEB_RESEARCH: "0", KERYX_RPC_WS_URL: "",
  KERYX_REGISTRY_ADDRESS: "", NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS: "",
  SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_ANON_KEY: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
});
// Use the existing owned programmatic Next recipe. Only this process's fresh
// cwd/data and TEMP are writable runtime storage; no source .env is copied.
const previousCwd = process.cwd(), previousEnvironment = { ...process.env }, require = createRequire(import.meta.url);
for (const name of Object.keys(process.env)) if (!(name in environment)) delete process.env[name];
Object.assign(process.env, environment); process.chdir(fixture);
let app: { prepare(): Promise<void>; close(): Promise<void>;
  getRequestHandler(): (request: IncomingMessage, response: ServerResponse) => Promise<void> } | undefined;
const handlerFailures: unknown[] = [];
const server = createServer((incoming, outgoing) => {
  void app!.getRequestHandler()(incoming, outgoing).catch(error => { handlerFailures.push(error); });
});
type Reply = { status: number; headers: IncomingHttpHeaders; body: string };
let requestCount = 0;
function call(path: "/account" | "/account?_rsc=" | "/api/account/membership", method = "GET", headers: Record<string, string> = {}, body?: string) {
  assert(++requestCount <= 9, "Finite two-path HTTP acceptance request bound");
  return new Promise<Reply>((accept, reject) => {
    let reply: Reply | undefined, failure: unknown;
    const outgoing = request({ hostname: "127.0.0.1", port, path, method, agent: false,
      headers: { Connection: "close", ...headers }, signal: AbortSignal.timeout(10_000) }, response => {
      const parts: Buffer[] = []; let bytes = 0;
      response.on("data", (part: Buffer) => {
        bytes += part.length;
        if (bytes <= 1_048_576) parts.push(part);
        else failure ??= new Error("Owned response exceeds 1 MiB"); // Drain to EOF without retaining excess bytes.
      });
      response.once("error", error => { failure ??= error; });
      response.once("end", () => {
        if (!response.complete) failure ??= new Error("Owned HTTP response did not complete");
        else reply = { status: response.statusCode!, headers: response.headers, body: Buffer.concat(parts).toString("utf8") };
      });
    });
    outgoing.once("error", error => { failure ??= error; });
    outgoing.once("close", () => failure ? reject(failure) : reply ? accept(reply) : reject(new Error("Owned request closed before response EOF")));
    outgoing.end(body);
  });
}
function privateReply(reply: Reply, vary: readonly string[]) {
  const cache = reply.headers["cache-control"];
  assert(typeof cache === "string"); assert(cache.split(",").some(value => value.trim().toLowerCase() === "no-store"));
  assert(!/(?:^|,)\s*public(?:,|$)|(?:s-maxage|max-age)\s*=\s*[1-9]/i.test(cache), "No public or positive cache lifetime");
  assert.equal(reply.headers["referrer-policy"], "no-referrer");
  assert.equal(reply.headers["x-robots-tag"], "noindex, nofollow");
  for (const header of security!) if (header.key.toLowerCase() !== "referrer-policy")
    assert.equal(reply.headers[header.key.toLowerCase()], header.value, `Compiled ${header.key} remains intact`);
  const actualVary = String(reply.headers.vary ?? "").toLowerCase().split(",").map(value => value.trim());
  for (const header of vary) assert(actualVary.includes(header.toLowerCase()), `Required Vary ${header}`);
  assert.equal(reply.headers.location, undefined); assert.equal(reply.headers["set-cookie"], undefined);
}
const wallet = `0x${"a".repeat(40)}`;
function noOwner(body: string) {
  assert(!body.includes(wallet)); assert(!/acct_[a-f0-9]{64}/.test(body));
  for (const value of ["Current sign-in wallet:", "Review account creation", "Confirm private account creation", "Confirm wallet link", "Account membership saved.", "NEXT_REDIRECT", "NEXT_HTTP_ERROR_FALLBACK"])
    assert(!body.includes(value), `Anonymous shell/refusal excludes ${value}`);
}
// Read only the boot-owned ordinary fixture. No test-account namespace or durable
// login is installed, and no source adapter/producer is used by the acceptance.
function storageSnapshot() {
  const database = new DatabaseSync(join(fixture, "data", "keryx.sqlite"), { readOnly: true });
  try {
    const schema = database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name LIMIT 513").all();
    assert(schema.length <= 512, "Fresh owned schema bound");
    assert(!schema.some(row => String(row.name).toLowerCase().startsWith("account267_")), "Unsupported account domain must remain uninstalled");
    const counts: Record<string, number> = {};
    for (const row of schema) if (row.type === "table") {
      const name = String(row.name); assert(/^[a-zA-Z0-9_]+$/.test(name), "Owned ordinary table identifier");
      const count = database.prepare(`SELECT count(*) AS rows FROM "${name}"`).get()?.rows;
      assert(typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= 256);
      counts[name] = count;
      if (/private|profile|identity|bibliograph|signature|payment|authorization|grant|challenge|query_run|api_key|web_session|^users$/i.test(name))
        assert.equal(count, 0, `No recorded private/session/signature/payment effect in ${name}`);
    }
    for (const name of ["web_sessions", "auth_challenges", "users", "api_keys", "session_grants", "browser_authorization_intents", "payment_events", "query_runs"])
      assert.equal(counts[name], 0, `Actual ordinary ${name} remains empty`);
    return { schema, counts };
  } finally { database.close(); }
}
let failure: unknown; const cleanupFailures: unknown[] = [];
let initialStorage: ReturnType<typeof storageSnapshot> | undefined;
try {
  const next = require("next") as (options: { dev: boolean; dir: string; hostname: string; port: number }) => NonNullable<typeof app>;
  app = next({ dev: false, dir: fixture, hostname: "127.0.0.1", port });
  await app.prepare();
  await new Promise<void>((accept, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", accept); });
  const pageVary = ["RSC", "Next-Router-State-Tree", "Next-Router-Prefetch", "Next-Router-Segment-Prefetch"];
  const html = await call("/account", "GET", { Accept: "text/html" });
  assert.equal(html.status, 200); privateReply(html, pageVary); noOwner(html.body);
  assert.match(String(html.headers["content-type"]), /^text\/html\b/);
  assert.match(html.body, /<h1\b[^>]*>Private account and wallets<\/h1>/);
  assert.match(html.body, /<meta name="robots" content="noindex, nofollow"\s*\/?\s*>/);
  assert.match(html.body, /<meta name="referrer" content="no-referrer"\s*\/?\s*>/);
  // The first actual response awaits Next's asynchronous boot instrumentation.
  // Its private domains must already be empty; no readiness poll or boot retry.
  initialStorage = storageSnapshot();
  // Next 16's ordinary RSC request needs the empty _rsc hash when no router
  // headers are supplied. This is its real cache-busting URL, not a redirect retry.
  const rsc = await call("/account?_rsc=", "GET", { RSC: "1", Accept: "text/x-component" });
  assert.equal(rsc.status, 200); privateReply(rsc, pageVary); noOwner(rsc.body);
  assert.match(String(rsc.headers["content-type"]), /^text\/x-component\b/);
  assert(rsc.body.includes("AccountMembershipWorkspace"), "RSC retains the generic client workspace reference");
  assert.match(rsc.body, /"name":"robots","content":"noindex, nofollow"/);
  assert.match(rsc.body, /"name":"referrer","content":"no-referrer"/);
  assert.deepEqual(storageSnapshot(), initialStorage, "Anonymous ordinary/RSC delivery has no recorded private effects");

  const apiVary = ["Cookie", "Authorization"], consent = JSON.stringify({ action: "prepare-create",
    consent: { version: 1, privateAccount: true, shareOwnedHistory: true } });
  const cases = [
    { method: "GET", headers: {}, error: "account_unauthenticated", status: 401 },
    { method: "GET", headers: { Cookie: "keryx_session=invalid" }, error: "account_unauthenticated", status: 401 },
    { method: "GET", headers: { Authorization: "Bearer synthetic-inert" }, error: "interactive_account_session_required", status: 401 },
    { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, error: "account_unauthenticated", status: 401 },
    { method: "POST", headers: { Origin: "https://foreign.synthetic.invalid", "Content-Type": "application/json" }, error: "same_origin_required", status: 403 },
  ];
  for (const scenario of cases) {
    const reply = await call("/api/account/membership", scenario.method, scenario.headers as Record<string, string>, scenario.method === "POST" ? consent : undefined);
    assert.equal(reply.status, scenario.status); privateReply(reply, apiVary); noOwner(reply.body);
    assert.deepEqual(JSON.parse(reply.body), { error: scenario.error });
    assert.deepEqual(storageSnapshot(), initialStorage, "Unauthorized actor cannot record account/private/signature/payment state");
  }
  // An in-memory, explicitly synthetic JWT satisfies local preflight only. Its
  // jti has no durable login and it conveys no account authority. The actual
  // ordinary facade has no admitted account store: GET/POST must stay 503.
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ address: wallet, role: "asker" }).setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("keryx-web").setAudience("keryx-account").setJti("b".repeat(64)).setIssuedAt(now).setExpirationTime(now + 300)
    .sign(new TextEncoder().encode(secret));
  for (const method of ["GET", "POST"]) {
    const reply = await call("/api/account/membership", method, { Cookie: `keryx_session=${token}`, Origin: origin,
      "Content-Type": "application/json", "X-Keryx-Expected-Wallet": wallet }, method === "POST" ? consent : undefined);
    assert.equal(reply.status, 503); privateReply(reply, apiVary); noOwner(reply.body); assert(!reply.body.includes(token));
    assert.deepEqual(JSON.parse(reply.body), { error: "account_unavailable", message: "Private account membership is unavailable on this deployment." });
    assert.deepEqual(storageSnapshot(), initialStorage, "Unsupported storage is a private refusal, never a backed-account claim or fallback");
  }
  assert.equal(requestCount, 9);
} catch (error) { failure = error; }
finally {
  try { if (server.listening) await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept())); }
  catch (error) { cleanupFailures.push(error); }
  if (app) {
    try {
      const instrumentation = require(join(dist, "server", "instrumentation.js")) as { close(): Promise<boolean> };
      assert.equal(typeof instrumentation.close, "function", "Existing built owned indexer cleanup required");
      assert.equal(await instrumentation.close(), true, "Actual boot indexer must be awaited closed");
    } catch (error) { cleanupFailures.push(error); }
    try { await app.close(); } catch (error) { cleanupFailures.push(error); }
    try { await require("next/dist/trace").flushAllTraces(); } catch (error) { cleanupFailures.push(error); }
  }
  try {
    assert.equal(server.listening, false); assert.equal(listener.listening, false);
    if (initialStorage) assert.deepEqual(storageSnapshot(), initialStorage, "Closed fixture retains no recorded private effects");
  } catch (error) { cleanupFailures.push(error); }
  process.chdir(previousCwd);
  for (const name of Object.keys(process.env)) if (!(name in previousEnvironment)) delete process.env[name];
  Object.assign(process.env, previousEnvironment);
}
if (failure || handlerFailures.length || cleanupFailures.length) throw new AggregateError([...(failure ? [failure] : []), ...handlerFailures, ...cleanupFailures],
  `Built private account acceptance failed; owned fixture retained at ${fixture}`, { cause: failure });
console.log(JSON.stringify({ gate: "account-membership-private-built", buildId, requests: requestCount, paths: ["/account", "/api/account/membership"],
  ordinaryAndRsc: true, privateHeadersAndSecurity: true, unauthenticated401: true, invalidOrigin403: true, unsupported503: true,
  recordedPrivateEffects: false, durableLoginCreated: false, walletSignatures: false, paymentActions: false, naturallyClosed: true, fixture }));
