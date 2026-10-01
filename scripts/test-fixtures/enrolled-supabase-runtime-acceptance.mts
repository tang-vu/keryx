/** Native acceptance on a second fresh database in the evaluator's owned PG17
 * container. Source constants must already be frozen in reviewed migrations. */
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalJson } from "../../lib/canonical-json";
import { STORAGE_TESTNET_PROFILE_DIGEST, type StorageIdentity } from "../../lib/db/storage-identity";
import { SUPABASE_RUNTIME_CONTRACT } from "../../lib/db/supabase-runtime-contract";
import { startOwnedSupabaseHttpsBridge } from "./enrolled-supabase-native-https.mts";
import { startEnrolledSupabaseNativeRegistry } from "./enrolled-supabase-native-domains.mts";

export async function acceptOwnedEnrolledSupabaseRuntime(
  postgresContainer: string, migrationSql: string,
  ownContainer: (name: string) => void,
) {
  assert(/^keryx-enrolled-reference-[a-f0-9-]+$/.test(postgresContainer));
  assert.match(SUPABASE_RUNTIME_CONTRACT.beforeDigest, /^[a-f0-9]{64}$/);
  assert.match(SUPABASE_RUNTIME_CONTRACT.afterDigest, /^[a-f0-9]{64}$/);
  const database = "enrolled_runtime_target";
  const http = `${postgresContainer}-http`, curl = `${postgresContainer}-curl`;
  const directory = mkdtempSync(join(tmpdir(), "keryx-enrolled-runtime-"));
  const secret = randomBytes(32).toString("hex");
  const masterKey = randomBytes(32).toString("hex");
  const docker = (args: string[], input?: string, timeout = 30_000) => execFileSync("docker", args,
    { input, encoding: "utf8", timeout, maxBuffer: 12 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
  const sql = (statement: string) => docker(["exec", "-i", postgresContainer, "psql", "-U", "postgres",
    "--dbname", database, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
  `set statement_timeout='10s';set lock_timeout='5s';${statement}`).trim();
  const literal = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  const service = (statement: string) => sql(`set role service_role;${statement}`);
  const jwt = (role: string) => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
    return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
  };
  let bridge: Awaited<ReturnType<typeof startOwnedSupabaseHttpsBridge>> | undefined;
  let registry: Awaited<ReturnType<typeof startEnrolledSupabaseNativeRegistry>> | undefined;
  const children = new Map<ReturnType<typeof execFile>, Promise<{ code: number | null; category: string }>>();
  try {
    docker(["exec", postgresContainer, "createdb", "-U", "postgres", database]);
    sql("create publication supabase_realtime;" + migrationSql);
    // No generated target metadata is adopted. Reviewed SOURCE rows must ship.
    assert(Number(sql("select count(*) from keryx_storage.source_contract")) > 0,
      "Frozen source contract rows must be present in the reviewed migration");
    assert.equal(sql("select keryx_storage.require_source_contract('before')"), SUPABASE_RUNTIME_CONTRACT.beforeDigest);
    const identity: StorageIdentity = {
      format: "keryx-storage-identity-v1", deploymentId: randomUUID(), storageId: randomUUID(),
      network: "eip155:5042002", authorityMode: "testnet-real", profileDigest: STORAGE_TESTNET_PROFILE_DIGEST,
      enrollmentId: randomUUID(), enrolledAt: new Date().toISOString(), provenanceDigest: randomBytes(32).toString("hex"),
    };
    // Explicit owner-only activation on this EMPTY synthetic domain, before
    // enrollment installs write fences. No runtime activation API is introduced.
    assert.equal(sql("select active from public.browser_journal_control where id=1"), "f");
    assert.equal(sql("select active from public.browser_signing_v2_control where id=1"), "f");
    sql("update public.browser_journal_control set active=true where id=1;update public.browser_signing_v2_control set active=true,min_original_version=3 where id=1");
    assert.equal(sql("select min_original_version from public.browser_signing_v2_barrier where id=1"), "3");
    for (const [mutation, expected] of [
      ["insert into keryx_storage.source_contract values('before','database',16383,'{}'::jsonb,'" + SUPABASE_RUNTIME_CONTRACT.beforeDigest + "')", "source contract digest mismatch"],
      ["create function public.synthetic_unreviewed_definer() returns integer language sql security definer as 'select 1'", "unsupported source schema contract"],
    ]) {
      sql(`do $negative$ begin
        begin
          execute '${mutation.replaceAll("'", "''")}';
          perform keryx_storage.require_source_contract('before');
          raise exception 'synthetic source mutation unexpectedly accepted';
        exception when others then
          if sqlerrm <> '${expected}' then raise; end if;
        end;
      end $negative$;`);
      assert.equal(sql("select keryx_storage.require_source_contract('before')"), SUPABASE_RUNTIME_CONTRACT.beforeDigest);
    }
    const snapshot = () => sql("select keryx_storage.snapshot_digest()");
    const before = snapshot();
    assert.throws(() => service(`select keryx_storage.enroll(${literal(identity)},'${before}')`));
    assert.equal(snapshot(), before);
    sql(`select keryx_storage.enroll(${literal(identity)},'${before}')`);
    assert.deepEqual(JSON.parse(service("select read_storage_identity()")), identity);
    assert.equal(sql("select keryx_storage.require_source_contract('after')"), SUPABASE_RUNTIME_CONTRACT.afterDigest);
    const enrolled = snapshot();
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.throws(() => sql(`set role ${role};insert into public.sources(id) values('forbidden')`));
      assert.throws(() => sql(`set role ${role};insert into keryx_storage.writer values(1,'${"0".repeat(64)}','upsert_source')`));
      assert.throws(() => sql(`set role ${role};delete from keryx_storage.identity`));
      if (role !== "service_role") assert.throws(() => sql(`set role ${role};select read_storage_identity()`));
    }
    assert.equal(snapshot(), enrolled, "ACL refusals leave the whole native snapshot unchanged");
    const foreign = { ...identity, storageId: randomUUID() };
    assert.throws(() => service(`select storage_get_source(${literal(foreign)},'absent')`));
    for (const timeout of ["0", "31s"]) {
      assert.throws(() => sql(`set role service_role;set statement_timeout='${timeout}';select storage_get_source(${literal(identity)},'absent')`));
    }
    assert.equal(snapshot(), enrolled);
    service(`begin read only;select storage_get_source(${literal(identity)},'absent');select storage_verify_runtime_authority(${literal(identity)});commit;`);
    assert.equal(snapshot(), enrolled, "native read-only authority calls allocate no capabilities or state");
    ownContainer(http);
    docker(["run", "-d", "--name", http, "--network", `container:${postgresContainer}`, "--memory", "256m",
      "-e", `PGRST_DB_URI=postgres://authenticator@127.0.0.1:5432/${database}`,
      "-e", "PGRST_DB_ANON_ROLE=anon", "-e", "PGRST_DB_SCHEMAS=public", "-e", "PGRST_DB_CONFIG=false",
      "-e", "PGRST_DB_POOL=4", "-e", `PGRST_JWT_SECRET=${secret}`, "postgrest/postgrest:v12.2.3"]);
    ownContainer(curl);
    docker(["run", "-d", "--name", curl, "--network", `container:${postgresContainer}`, "--memory", "64m",
      "--entrypoint", "sh", "curlimages/curl:8.12.1", "-c", "sleep 900"]);
    const readyDeadline = performance.now() + 15_000;
    let ready = false;
    while (performance.now() < readyDeadline) {
      try {
        const status = docker(["exec", curl, "curl", "--silent", "--max-time", "2", "--output", "/dev/null",
          "--write-out", "%{http_code}", "http://127.0.0.1:3000/"], undefined, 3_000);
        if (status === "200") { ready = true; break; }
      } catch { /* Readiness only; no financial assertion is retried. */ }
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    assert(ready, "Owned PostgREST readiness deadline");
    bridge = await startOwnedSupabaseHttpsBridge(curl);
    const manifest = join(directory, "manifest.json");
    writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity,
      backend: { kind: "supabase", url: bridge.origin } }));
    const runChild = async (mode: string, role = "service_role") => {
      const child = execFile(process.execPath, ["--import", "tsx", resolve("scripts/test-fixtures/enrolled-supabase-runtime-child.mts"), mode], {
        timeout: 120_000, maxBuffer: 1024 * 1024,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
          NODE_EXTRA_CA_CERTS: bridge!.certificate, KERYX_STORAGE_MANIFEST: manifest,
          NEXT_PUBLIC_SUPABASE_URL: bridge!.origin, SUPABASE_SERVICE_ROLE_KEY: jwt(role),
          CONTENT_MASTER_KEY: masterKey, KERYX_FORCE_OFFLINE: "0",
          ...(registry ? { KERYX_RPC_URL: registry.rpcUrl, KERYX_REGISTRY_READ_ADDRESS: registry.registryContract,
            KERYX_NATIVE_CREATOR: registry.creator, KERYX_NATIVE_PAYOUT: registry.payout } : {}) },
      });
      // Install completion/error listeners before any polling or owner SQL.
      const completion = new Promise<{ code: number | null; category: string }>((resolveCompletion) => {
        let processError = false;
        child.once("error", () => {
          processError = true;
          if (!child.pid) resolveCompletion({ code: null, category: "spawn-error" });
        });
        child.once("close", (code, signal) => resolveCompletion({ code,
          category: signal ? "terminated" : processError ? "process-error" : code === 0 ? "success" : "assertion-failed" }));
      });
      children.set(child, completion);
      let completionTimer: ReturnType<typeof setTimeout> | undefined;
      const boundedCompletion = Promise.race([completion,
        new Promise<{ code: number | null; category: string }>((resolveDeadline) => {
          completionTimer = setTimeout(() => {
            child.kill("SIGKILL");
            resolveDeadline({ code: null, category: "fixture-deadline" });
          }, 125_000);
        })]);
      void completion.then(() => { if (completionTimer) clearTimeout(completionTimer); });
      let childTerminal = false;
      void completion.then(() => { childTerminal = true; });
      let output = "";
      let stage = "startup";
      const stages = new Set(["startup", "provenance", "readonly", "drift", "source-write", "cache", "auth", "query", "metrics", "domains", "quota", "close"]);
      child.stdout!.on("data", (part) => {
        output += part;
        if (output.length > 8192) child.kill();
        for (const match of output.matchAll(/^STAGE ([a-z-]+)$/gm)) if (stages.has(match[1]) && match[1] !== "close") stage = match[1];
      });
      if (mode === "drift") {
        const deadline = performance.now() + 30_000;
        while (!output.includes("READY synthetic schema drift") && !childTerminal && performance.now() < deadline) {
          await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 20));
        }
        assert(output.includes("READY synthetic schema drift"), `Native factory fixture mode=${mode} stage=${stage} category=handshake-refused`);
        sql("alter function public.storage_get_source(jsonb,text) set cost 101");
        child.stdin!.end("resume\n");
      }
      const result = await boundedCompletion;
      if (childTerminal) children.delete(child);
      assert.equal(result.code, 0, `Native factory fixture mode=${mode} stage=${stage} category=${result.category}`);
      assert(output.includes("PASS"));
    };
    await runChild("refused-startup", "anon");
    await runChild("refused-startup", "authenticated");
    assert.equal(snapshot(), enrolled);
    await runChild("read-write");
    const afterWrites = snapshot();
    const writesBefore = bridge.counts.get("storage_set_cached") ?? 0;
    const lastUseBefore = bridge.counts.get("storage_verify_api_key_2") ?? 0;
    await runChild("readonly");
    assert.equal(bridge.counts.get("storage_set_cached") ?? 0, writesBefore);
    assert.equal(bridge.counts.get("storage_verify_api_key_2") ?? 0, lastUseBefore);
    assert.equal(snapshot(), afterWrites);
    assert.equal(sql("select count(*) from keryx_storage.writer"), "0");
    const retainedCacheRow = JSON.parse(sql("select to_jsonb(c) from public.cache_items c where source_id='fixture-source'"));
    const stale = execFile("docker", ["exec", "-i", postgresContainer, "psql", "-h", "127.0.0.1", "-U", "postgres",
      "--dbname", database, "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate", "-q", "-t", "-A"],
    { timeout: 180_000, maxBuffer: 4096 });
    const staleDone = new Promise<{ code: number | null; category: string }>((resolveDone) => {
      stale.once("error", () => { if (!stale.pid) resolveDone({ code: null, category: "spawn-error" }); });
      stale.once("close", code => resolveDone({ code, category: code === 0 ? "success" : "assertion-failed" }));
    });
    children.set(stale, staleDone);
    let staleOutput = "", staleError = "";
    stale.stdout!.on("data", part => { staleOutput += part; if (staleOutput.length > 4096) stale.kill(); });
    stale.stderr!.on("data", part => { staleError += part; if (staleError.length > 4096) stale.kill(); });
    stale.stdin!.write("set statement_timeout='10s';begin isolation level repeatable read;select 1 from keryx_storage.cache_quota;\\echo READY_QUOTA\n");
    const staleReadyDeadline = performance.now() + 5000;
    while (!staleOutput.includes("READY_QUOTA") && performance.now() < staleReadyDeadline) {
      await new Promise<void>(resolveReady => setTimeout(resolveReady, 20));
    }
    assert(staleOutput.includes("READY_QUOTA"), "Native stale quota transaction readiness");
    await runChild("quota");
    stale.stdin!.end(`set role service_role;select storage_set_cached(${literal(identity)},${literal(retainedCacheRow)});commit;\n`);
    const staleResult = await staleDone;
    children.delete(stale);
    assert.notEqual(staleResult.code, 0);
    assert.match(staleError, /ERROR:\s+40001/u, "Actual stale RR cache writer must serialize/refuse");
    assert.equal(sql("select (q.row_count=count(c.text) and q.wire_bytes=coalesce(sum(octet_length(c.text)),0) and q.wire_bytes<=8388608)::text from keryx_storage.cache_quota q left join public.cache_items c on true group by q.row_count,q.wire_bytes"), "true");
    assert.equal(sql("select count(*) from keryx_storage.writer"), "0");
    registry = await startEnrolledSupabaseNativeRegistry();
    await runChild("domains");
    registry.assertHealthy();
    await registry.close();
    registry = undefined;
    await runChild("drift");
    assert.equal(sql("select count(*) from keryx_storage.writer"), "0");
    process.stdout.write("PASS native HTTPS closed factory, role/identity/deadline/read-only/provenance/drift gates\n");
  } finally {
    let cleanupFailed = false;
    for (const [child, completion] of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      const grace = async (milliseconds: number) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { return await Promise.race([completion.then(() => true),
          new Promise<boolean>((resolveGrace) => { timer = setTimeout(() => resolveGrace(false), milliseconds); })]); }
        finally { if (timer) clearTimeout(timer); }
      };
      if (!await grace(3000)) {
        child.kill("SIGKILL");
        if (!await grace(3000)) cleanupFailed = true;
      }
    }
    try { await registry?.close(); } catch { cleanupFailed = true; }
    try { await bridge?.close(); } catch { cleanupFailed = true; }
    try { rmSync(directory, { recursive: true }); } catch { cleanupFailed = true; }
    if (cleanupFailed) throw new Error("Owned native fixture cleanup deadline");
  }
}
