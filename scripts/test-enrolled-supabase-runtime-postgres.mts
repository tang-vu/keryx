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
import { acceptOwnedEnrolledSupabaseRuntime } from "./test-fixtures/enrolled-supabase-runtime-acceptance.mts";
import { SUPABASE_RUNTIME_CONTRACT } from "../lib/db/supabase-runtime-contract";

const name = `keryx-enrolled-reference-${randomUUID()}`;
const owned = new Set<string>();
let engine = false;
const docker = (args: string[], input?: string, timeout = 30_000) => execFileSync("docker", args, {
  input, encoding: "utf8", timeout, maxBuffer: 12 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"],
});
const sql = (statement: string) => docker(["exec", "-i", name, "psql", "-h", "127.0.0.1", "-U", "postgres",
  "--dbname", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"], statement);
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const migrations = readdirSync("supabase/migrations").filter((path) => /^\d{4}_[a-z0-9_]+\.sql$/.test(path)
  && Number(path.slice(0, 4)) <= 77).sort().map((path) => ({ name: path,
  // Production source bytes are the canonical LF Git blob, not checkout CRLF.
  sql: readFileSync(`supabase/migrations/${path}`, "utf8").replaceAll("\r\n", "\n"),
}));
assert.equal(migrations.at(-1)?.name, "0077_session_revoke_generation.sql");
const sourceManifest = compileFunctionDeclarationManifest(migrations);
let completed = false;
let failure: unknown;
try {
  try { docker(["info", "--format", "{{.ServerVersion}}"], undefined, 5_000); engine = true; }
  catch (error) {
    const result = error as { code?: unknown; status?: unknown; signal?: unknown };
    const category = result.code === "ETIMEDOUT" || result.signal === "SIGTERM" ? "timeout"
      : result.code === "ENOENT" ? "spawn-unavailable" : "nonzero-exit";
    throw new Error(`Native PostgreSQL container engine unavailable (${category})`);
  }
  owned.add(name); // Register before creation, including timeout-after-create.
  docker(["run", "-d", "--name", name, "--network", "none", "--memory", "512m", "--cpus", "1",
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine"]);
  const startupDeadline = performance.now() + 30_000;
  let ready = false;
  while (performance.now() < startupDeadline) {
    try { docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], undefined, 2_000); ready = true; break; }
    catch { await delay(100); }
  }
  if (!ready) {
    let state = "unavailable";
    try {
      const raw = docker(["inspect", "--format", "{{.State.Status}} {{.State.OOMKilled}} {{.State.ExitCode}}", name], undefined, 2_000).trim();
      if (/^(created|running|paused|restarting|removing|exited|dead) (true|false) -?\d{1,3}$/.test(raw)) state = raw;
    } catch { /* Fixed diagnostic only; preserve startup failure. */ }
    throw new Error(`Synthetic reference startup deadline (${state})`);
  }
  sql("set statement_timeout='30s';create role anon;create role authenticated;create role service_role bypassrls;"
    + "create role authenticator login noinherit;grant anon,authenticated,service_role to authenticator;"
    + "alter role authenticator set statement_timeout='10s';alter role service_role set statement_timeout='10s';"
    + "create publication supabase_realtime;\n" + migrations.map((item) => item.sql).join("\n"));
  assert.equal(sql("set statement_timeout='10s';select count(*) from keryx_storage.identity;").trim(), "0");
  // Actual SQL preflight must reject raw trigger fields before deparsing them.
  for (const mode of ["args", "qual"] as const) {
    const oversized = "x".repeat(mode === "args" ? 65_537 : 131_073);
    const trigger = mode === "args"
      ? `create trigger synthetic_contract_bound before update on public.sources for each row execute function keryx_storage.write_fence('${oversized}')`
      : `create trigger synthetic_contract_bound before update on public.sources for each row when(new.id='${oversized}') execute function keryx_storage.write_fence()`;
    sql(`do $proof$ declare original jsonb; begin
      original := keryx_storage.catalog_contract();
      begin
        execute '${trigger.replaceAll("'", "''")}';
        perform keryx_storage.catalog_contract();
        raise exception 'synthetic raw bound unexpectedly accepted';
      exception when others then
        if sqlerrm <> 'schema contract raw field bound' then raise; end if;
      end;
      if keryx_storage.catalog_contract() <> original then raise exception 'synthetic raw bound rollback changed schema'; end if;
    end $proof$;`);
  }
  process.stdout.write("PASS actual raw trigger args/qual preflight refusal and schema rollback\n");
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
  if (process.argv.includes("--acceptance")) {
    assert.equal(before.sha256, SUPABASE_RUNTIME_CONTRACT.beforeDigest);
    assert.equal(after.sha256, SUPABASE_RUNTIME_CONTRACT.afterDigest);
    await acceptOwnedEnrolledSupabaseRuntime(name, migrations.map((item) => item.sql).join("\n"),
      (target) => { assert(target === `${name}-http` || target === `${name}-curl`); owned.add(target); });
  }
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
process.stdout.write(process.argv.includes("--acceptance")
  ? "PASS enrolled native acceptance and owned cleanup.\n"
  : "PASS source-reference generation and owned cleanup; runtime acceptance remains pending frozen constants.\n");
