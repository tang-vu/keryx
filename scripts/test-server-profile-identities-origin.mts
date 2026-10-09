/** Exercise the candidate's default production build through a private HTTP socket.
 * No owner cookie, OAuth grant, provider request or identity mutation. Next's boot
 * instrumentation initializes only an owned temporary ordinary testnet database. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url))), require = createRequire(import.meta.url);
const applicationOrigin = "https://identity-origin.synthetic.invalid", wallet = `0x${"a".repeat(40)}`;
for (const name of [".env", ".env.local", ".env.production", ".env.production.local"])
  assert(!existsSync(join(root, name)), "Built origin acceptance refuses application environment files");
assert((await readFile(join(root, ".next", "BUILD_ID"), "utf8")).trim(), "A successful candidate default production build is required");

// Ordinary SQLite intentionally uses cwd/data; Next receives an explicit app dir
// and the pinned start command does not change cwd. No build/dependency is copied.
const temporaryRoot = resolve(tmpdir()), temporary = await mkdtemp(join(temporaryRoot, "keryx-identity-origin-"));
assert.equal(dirname(resolve(temporary)), temporaryRoot); assert(basename(temporary).startsWith("keryx-identity-origin-"));
const databasePath = join(temporary, "data", "keryx.sqlite");
const environment: NodeJS.ProcessEnv = {};
for (const key of ["SystemRoot", "WINDIR", "ComSpec", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA"])
  if (process.env[key]) environment[key] = process.env[key];
Object.assign(environment, {
  NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet",
  KERYX_FORCE_OFFLINE: "1", KERYX_EXTERNAL_DISCOVERY: "0", KERYX_RPC_WS_URL: "",
  NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "",
  BASE_URL: applicationOrigin, KERYX_IDENTITY_OAUTH_ORIGIN: applicationOrigin,
  KERYX_GITHUB_OAUTH_CLIENT_ID: "synthetic-client", KERYX_GITHUB_OAUTH_CLIENT_SECRET: "synthetic-not-secret",
  KERYX_ORCID_OAUTH_CLIENT_ID: "synthetic-client", KERYX_ORCID_OAUTH_CLIENT_SECRET: "synthetic-not-secret",
});
const reservation = createServer();
await new Promise<void>((accept, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", accept); });
const address = reservation.address(); assert(address && typeof address !== "string"); const port = address.port;
await new Promise<void>((accept, reject) => reservation.close(error => error ? reject(error) : accept()));

const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", root, "-H", "127.0.0.1", "-p", String(port)], {
  cwd: temporary, env: environment, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let output = "", ready = false, spawnError: Error | undefined;
for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { output = (output + String(chunk)).slice(-8192); ready ||= /Ready in/i.test(output); });
child.once("error", error => { spawnError = error; });
const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(accept => child.once("close", (code, signal) => accept({ code, signal })));

function call(path: string, method: string, headers: Record<string, string>) {
  return new Promise<{ status: number | undefined; headers: import("node:http").IncomingHttpHeaders; body: string }>((accept, reject) => {
    const outgoing = request({ hostname: "127.0.0.1", port, path, method, headers, agent: false }, response => {
      let body = "", bytes = 0;
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 4096) { response.destroy(); reject(new Error("Origin fixture response exceeded byte bound")); return; }
        body += chunk;
      });
      response.on("error", reject);
      response.on("end", () => accept({ status: response.statusCode, headers: response.headers, body }));
    });
    outgoing.setTimeout(10000, () => outgoing.destroy(new Error("Origin fixture request deadline exceeded")));
    outgoing.on("error", reject); outgoing.end();
  });
}

try {
  for (let attempt = 0; attempt < 120 && !ready && !spawnError && child.exitCode === null && child.signalCode === null; attempt++) await delay(250);
  assert(ready && !spawnError && child.exitCode === null && child.signalCode === null, `Owned built server failed to become ready: ${output}`);
  const readHeaders: Record<string, string>[] = [{ Origin: applicationOrigin }, { Host: "foreign.synthetic.invalid", "X-Forwarded-Proto": "http" }];
  for (const headers of readHeaders) {
    const read = await call("/api/me/profile/identities", "GET", headers);
    assert.equal(read.status, 401); assert.deepEqual(JSON.parse(read.body), { error: "Sign in to access your account." });
    assert.equal(read.headers["cache-control"], "no-store"); assert.equal(read.headers["referrer-policy"], "no-referrer");
  }
  const cases: { headers: Record<string, string>; status: number; error: string }[] = [
    { headers: { Origin: applicationOrigin }, status: 401, error: "Sign in to access your account." },
    { headers: { Origin: applicationOrigin, Host: "identity-origin.synthetic.invalid", "X-Forwarded-Host": "identity-origin.synthetic.invalid", "X-Forwarded-Proto": "https" }, status: 401, error: "Sign in to access your account." },
    { headers: { Origin: applicationOrigin, Host: "foreign.synthetic.invalid", "X-Forwarded-Host": "foreign.synthetic.invalid", "X-Forwarded-Proto": "http", Forwarded: "host=foreign.synthetic.invalid;proto=http" }, status: 401, error: "Sign in to access your account." },
    { headers: { Origin: "https://foreign.synthetic.invalid", Host: "foreign.synthetic.invalid", "X-Forwarded-Host": "foreign.synthetic.invalid", "X-Forwarded-Proto": "https" }, status: 403, error: "same_origin_required" },
    { headers: { Origin: "https://foreign.synthetic.invalid", Host: "identity-origin.synthetic.invalid", "X-Forwarded-Host": "identity-origin.synthetic.invalid", "X-Forwarded-Proto": "https" }, status: 403, error: "same_origin_required" },
    { headers: { Host: "identity-origin.synthetic.invalid", "X-Forwarded-Proto": "https" }, status: 403, error: "same_origin_required" },
    { headers: { Origin: "null", Host: "identity-origin.synthetic.invalid", "X-Forwarded-Proto": "https" }, status: 403, error: "same_origin_required" },
  ];
  for (const provider of ["github", "orcid"]) {
    for (const method of ["POST", "DELETE"]) for (const scenario of cases) {
      const response = await call(`/api/me/profile/identities/${provider}${method === "POST" ? "/start" : ""}`, method, {
        ...scenario.headers, "X-Keryx-Expected-Wallet": wallet,
      });
      assert.equal(response.status, scenario.status); assert.deepEqual(JSON.parse(response.body), { error: scenario.error });
      assert.equal(response.headers["cache-control"], "no-store"); assert.equal(response.headers["referrer-policy"], "no-referrer");
      assert.equal(response.headers.location, undefined); assert.equal(response.headers["set-cookie"], undefined);
    }
    // Missing encrypted state cookie refuses before session/store/provider I/O.
    // Even malicious proxy metadata cannot select the callback destination.
    const callback = await call(`/api/me/profile/identities/${provider}/callback?code=synthetic-inert&state=invalid`, "GET", {
      Host: "foreign.synthetic.invalid", "X-Forwarded-Host": "foreign.synthetic.invalid", "X-Forwarded-Proto": "http",
    });
    assert.equal(callback.status, 303); assert.equal(callback.headers.location, `${applicationOrigin}/me/profile?identity=failed`);
    assert.equal(callback.headers["cache-control"], "no-store"); assert.equal(callback.headers["referrer-policy"], "no-referrer");
    assert(callback.headers["set-cookie"]?.every(value => value.includes("Max-Age=0"))); assert.equal(callback.body, "");
  }
} finally {
  if (child.exitCode === null && child.signalCode === null && !spawnError) child.kill("SIGTERM");
  const exit = await Promise.race([closed, delay(15000, undefined, { ref: false }).then(() => { throw new Error("Owned built server failed to close; temporary evidence retained"); })]);
  // Next boot initializes its ordinary schema and prunes its empty grants. There
  // is no owner identity/session/flow action, and no shared/sealed datastore.
  assert(existsSync(databasePath), "Boot database must be confined to the owned temporary cwd");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    for (const table of ["private_profiles", "profile_verified_identities", "profile_identity_challenges", "web_sessions"])
      assert.equal(database.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0, `${table} remains empty`);
  } finally { database.close(); }
  assert.equal(child.stdout.readableEnded, true); assert.equal(child.stderr.readableEnded, true);
  await rm(temporary, { recursive: true, force: true });
  console.log(JSON.stringify({ fixture: "built-profile-identities-configured-origin", applicationOrigin, physicalOrigin: `http://127.0.0.1:${port}`,
    bootWrites: "owned temporary ordinary SQLite schema/empty grant housekeeping only", ownerProviderActions: false,
    childClosedEof: true, exit, temporaryRemoved: true }));
}
console.log("PASS: candidate default built Next admits configured HTTPS Origin to SIWE 401, refuses foreign Origin before authentication, and returns invalid callbacks only to configured origin.");
