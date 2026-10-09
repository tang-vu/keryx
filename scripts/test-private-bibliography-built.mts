/** Actual built routes/headers with isolated ordinary SQLite and synthetic durable sessions. No provider or shared-store traffic. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { SqliteAdapter } from "../lib/db/sqlite-adapter";
import { issueWebSession } from "../lib/auth-session";
import { PAPER_CATALOG } from "../lib/papers/catalog";
import { paperReferencesBibtex } from "../lib/papers/reference-export";

const source = resolve(import.meta.dirname, ".."), dist = resolve(source, process.env.NEXT_DIST_DIR ?? ".next");
await readFile(join(dist, "BUILD_ID"), "utf8");
const fixture = join(source, ".artifacts", `private-bib-built-${randomUUID()}`);
await mkdir(join(fixture, "lib"), { recursive: true });
await mkdir(join(fixture, "data"));
for (const file of ["package.json", "next.config.ts", "lib/security-headers.ts", "lib/arc-network-profile.ts", "lib/circle-wallet-config.ts"])
  await writeFile(join(fixture, file), await readFile(join(source, file)));
await symlink(join(source, "node_modules"), join(fixture, "node_modules"), process.platform === "win32" ? "junction" : "dir");
await symlink(dist, join(fixture, ".next"), process.platform === "win32" ? "junction" : "dir");
const sqlite = new SqliteAdapter(join(fixture, "data", "keryx.sqlite"));
await sqlite.init();
const secret = randomBytes(32).toString("hex"), alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const aliceSession = await issueWebSession(sqlite, secret, alice, "asker"), bobSession = await issueWebSession(sqlite, secret, bob, "asker");
const listener = createServer();
await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
const address = listener.address(); assert.ok(address && typeof address !== "string"); const port = address.port;
await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
const environment = { ...process.env, NODE_ENV: "production", JWT_SECRET: secret, KERYX_FORCE_OFFLINE: "1", KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet",
  BASE_URL: `http://127.0.0.1:${port}`, KERYX_EXTERNAL_DISCOVERY: "0",
  SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_ANON_KEY: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" };
for (const name of Object.keys(environment)) if (/^KERYX_(?:STORAGE|SQLITE|SUPABASE)/.test(name) || name === "NEXT_DIST_DIR") delete environment[name as keyof typeof environment];
const child = spawn(process.execPath, [join(source, "node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", String(port)],
  { cwd: fixture, env: environment, windowsHide: true, stdio: "ignore" });
let didExit = false, startupError: Error | undefined;
const stopped = new Promise<void>(resolve => child.once("exit", () => { didExit = true; resolve(); }));
child.once("error", error => { startupError = error; });
const waitForExit = (milliseconds: number) => new Promise<boolean>(resolve => {
  const timeout = setTimeout(() => resolve(false), milliseconds);
  void stopped.then(() => { clearTimeout(timeout); resolve(true); });
});
const origin = `http://127.0.0.1:${port}`;
const fetchPrivate = (path: string, init: RequestInit = {}) => fetch(origin + path, { redirect: "error", ...init, signal: AbortSignal.timeout(10000) });
const ownerRequest = (method: string, body?: unknown, owner = alice, session = aliceSession.token, revision?: number) => ({ method,
  headers: { Cookie: `keryx_session=${session}`, Origin: origin, "X-Keryx-Expected-Wallet": owner, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(revision === undefined ? {} : { "If-Match": `"${revision}"` }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
try {
  let ready = false;
  for (let attempts = 0; attempts < 80; attempts++) {
    if (startupError) throw new Error("Fixture server could not start");
    if (didExit) throw new Error("Fixture server exited before readiness");
    try { const response = await fetchPrivate("/api/me/bibliographies", ownerRequest("GET")); if (response.status === 200) { ready = true; break; } } catch { /* server startup only */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, "Isolated built server did not become ready");
  const input = { title: "PRIVATE BUILT REVIEW", papers: [PAPER_CATALOG[0]] };
  const anonymous = { method: "POST", headers: { Origin: origin, "X-Keryx-Expected-Wallet": alice, "Content-Type": "application/json" }, body: "not-json" };
  assert.equal((await fetchPrivate("/api/me/bibliographies", anonymous)).status, 401);
  const rejectedHeaders: Record<string, string>[] = [{ Origin: "https://foreign.invalid", Host: "foreign.invalid", "X-Forwarded-Host": "foreign.invalid", "X-Forwarded-Proto": "https" }, { Origin: origin, "Sec-Fetch-Site": "cross-site" }];
  for (const headers of rejectedHeaders) {
    const attempt = ownerRequest("POST", input);
    assert.equal((await fetchPrivate("/api/me/bibliographies", { ...attempt, headers: { ...attempt.headers, ...headers } })).status, 403);
  }
  const create = await fetchPrivate("/api/me/bibliographies", ownerRequest("POST", input)); assert.equal(create.status, 201);
  const saved = await create.json() as { bibliography: { id: string; revision: number }; urlPath: string };
  assert.match(saved.urlPath, /^\/api\/bibliographies\/[0-9a-f]{64}\.bib$/);
  let download = await fetchPrivate(saved.urlPath); assert.equal(download.status, 200);
  assert.equal(await download.text(), paperReferencesBibtex(input.papers).content);
  for (const response of [create, download]) {
    assert.equal(response.headers.get("referrer-policy"), "no-referrer"); assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/);
  }
  const titlePage = await fetchPrivate("/me/bibliographies"); assert.equal(titlePage.headers.get("referrer-policy"), "no-referrer");
  assert.equal((await fetchPrivate("/api/me/bibliographies", ownerRequest("GET", undefined, alice, bobSession.token))).status, 409);
  assert.equal((await fetchPrivate(`/api/me/bibliographies/${saved.bibliography.id}`, ownerRequest("PUT", input, bob, bobSession.token, 1))).status, 404);
  const replace = await fetchPrivate(`/api/me/bibliographies/${saved.bibliography.id}`, ownerRequest("PUT", { ...input, papers: [] }, alice, aliceSession.token, 1));
  assert.equal(replace.status, 200); assert.equal((await replace.json()).bibliography.revision, 2);
  download = await fetchPrivate(saved.urlPath); assert.equal(download.status, 200); assert.equal(await download.text(), "");
  assert.equal((await fetchPrivate(`/api/me/bibliographies/${saved.bibliography.id}`, ownerRequest("DELETE", undefined, alice, aliceSession.token, 1))).status, 409);
  assert.equal((await fetchPrivate(`/api/me/bibliographies/${saved.bibliography.id}`, ownerRequest("DELETE", undefined, alice, aliceSession.token, 2))).status, 200);
  assert.equal((await fetchPrivate(saved.urlPath)).status, 404);
  await sqlite.revokeWebSession((await sqlite.listWebSessions(alice, Date.now()))[0].hash, alice);
  assert.equal((await fetchPrivate("/api/me/bibliographies", ownerRequest("GET"))).status, 401);
} finally {
  try {
    if (!didExit && child.pid !== undefined) {
      child.kill();
      if (!await waitForExit(5000)) {
        child.kill("SIGKILL");
        assert.ok(await waitForExit(5000), "Fixture server cleanup failed: child exit was not observed");
      }
    }
  } finally { sqlite.close(); }
}
console.log("Built private bibliography API: owner/session refusal, exact snapshot, stable update, revocation, framework privacy headers and child exit passed. Synthetic sessions only.");
