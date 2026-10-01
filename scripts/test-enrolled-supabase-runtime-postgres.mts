/** Owned synthetic PostgreSQL17 source-reference evaluator. No environment-file
 * loading, application target discovery, production enrollment or provider IO. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  POSTGRES17_SCHEMA_CONTRACT_QUERY, compileFunctionDeclarationManifest,
  exportPostgres17SchemaContract,
} from "./helpers/enrolled-postgres-schema-contract.mts";

const name = `keryx-enrolled-reference-${randomUUID()}`;
const owned = new Set<string>();
let engine = false;
const docker = (args: string[], input?: string, timeout = 30_000) => execFileSync("docker", args, {
  input, encoding: "utf8", timeout, maxBuffer: 12 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"],
});
const sql = (statement: string) => docker(["exec", "-i", name, "psql", "-U", "postgres",
  "--dbname", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"], statement);
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const migrations = readdirSync("supabase/migrations").filter((path) => /^\d{4}_[a-z0-9_]+\.sql$/.test(path)
  && Number(path.slice(0, 4)) <= 76).sort().map((path) => ({ name: path,
  // Production source bytes are the canonical LF Git blob, not checkout CRLF.
  sql: readFileSync(`supabase/migrations/${path}`, "utf8").replaceAll("\r\n", "\n"),
}));
assert.equal(migrations.at(-1)?.name, "0076_enrolled_storage_owner_cutover.sql");
const sourceManifest = compileFunctionDeclarationManifest(migrations);
let completed = false;
let failure: unknown;
try {
  try { docker(["info", "--format", "{{.ServerVersion}}"], undefined, 5_000); engine = true; }
  catch { throw new Error("Native PostgreSQL container engine unavailable"); }
  owned.add(name); // Register before creation, including timeout-after-create.
  docker(["run", "-d", "--name", name, "--network", "none", "--memory", "512m", "--cpus", "1",
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine"]);
  const startupDeadline = performance.now() + 30_000;
  let ready = false;
  while (performance.now() < startupDeadline) {
    try { docker(["exec", name, "pg_isready", "-U", "postgres"], undefined, 2_000); ready = true; break; }
    catch { await delay(100); }
  }
  if (!ready) throw new Error("Synthetic reference startup deadline");
  sql("set statement_timeout='30s';create role anon;create role authenticated;create role service_role bypassrls;"
    + "create role authenticator login noinherit;grant anon,authenticated,service_role to authenticator;"
    + "alter role authenticator set statement_timeout='10s';alter role service_role set statement_timeout='10s';"
    + "create publication supabase_realtime;\n" + migrations.map((item) => item.sql).join("\n"));
  assert.equal(sql("set statement_timeout='10s';select count(*) from keryx_storage.identity;").trim(), "0");
  const before = exportPostgres17SchemaContract(JSON.parse(sql(POSTGRES17_SCHEMA_CONTRACT_QUERY).trim()));
  // This is only the separately created empty SOURCE reference. The owner
  // installation primitive cannot be invoked by the application service role.
  sql("set statement_timeout='30s';select keryx_storage.install_fixed_fences();");
  const after = exportPostgres17SchemaContract(JSON.parse(sql(POSTGRES17_SCHEMA_CONTRACT_QUERY).trim()));
  const directory = "artifacts/enrolled-supabase-contract";
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}/before.json`, before.canonicalJson + "\n");
  writeFileSync(`${directory}/after.json`, after.canonicalJson + "\n");
  writeFileSync(`${directory}/source-functions.json`, JSON.stringify(sourceManifest, null, 2) + "\n");
  writeFileSync(`${directory}/digests.json`, JSON.stringify({ format: "keryx-postgres17-runtime-contract-v1",
    beforeDigest: before.sha256, afterDigest: after.sha256 }, null, 2) + "\n");
  // Schema-only hashes are public fixture diagnostics; never keys or table data.
  process.stdout.write(`SOURCE REFERENCE before=${before.sha256} after=${after.sha256}\n`);
  completed = true;
} catch (error) { failure = error; }
finally {
  const cleanupFailures: string[] = [];
  if (engine) for (const target of owned) {
    try {
      const existing = docker(["ps", "-a", "--filter", `name=^/${target}$`, "--format", "{{.Names}}"], undefined, 5_000).trim();
      if (existing) { assert.equal(existing, target); docker(["rm", "-f", target], undefined, 10_000); }
      assert.equal(docker(["ps", "-a", "--filter", `name=^/${target}$`, "--format", "{{.Names}}"], undefined, 5_000).trim(), "");
    } catch { cleanupFailures.push(target); }
  }
  if (cleanupFailures.length) throw new Error("Owned synthetic reference cleanup failed");
}
if (failure) throw failure;
assert(completed);
process.stdout.write("PASS source-reference generation and owned cleanup; runtime acceptance remains pending frozen constants.\n");
