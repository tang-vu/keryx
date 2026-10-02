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
import { startOwnedSupabaseHttpsBridge, waitForOwnedSourceAdmissionEntry } from "./enrolled-supabase-native-https.mts";
import { startEnrolledSupabaseNativeRegistry } from "./enrolled-supabase-native-domains.mts";
import { describeOwnedSupabaseCurlState, launchOwnedSupabaseCurl } from "./enrolled-supabase-native-lifecycle.mts";

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
  const snapshotWithDiagnostics = () => {
    const relations = JSON.parse(sql("select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname) order by n.nspname,c.relname),'[]'::jsonb) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','keryx_storage') and c.relkind in ('r','p','S')")) as { schema: string; name: string }[];
    assert(relations.length <= 512);
    const logical = relations.map(relation => {
      assert(/^(public|keryx_storage)$/.test(relation.schema) && /^[a-z_][a-z0-9_]{0,62}$/.test(relation.name));
      const name = `${relation.schema}.${relation.name}`;
      return `select '${name}' name,encode(sha256(convert_to(coalesce(string_agg(h,'' order by h),''),'UTF8')),'hex') hash from (select encode(sha256(record_send(r)),'hex') h from "${relation.schema}"."${relation.name}" r) records`;
    }).join(" union all ");
    // Reuse the exact reviewed owner's catalog hash expression, excluding only
    // the relation branch being diagnosed separately. No target contract adoption.
    const assignment = migrationSql.indexOf(" into catalog_digest from (");
    const statementStart = migrationSql.lastIndexOf("  select ", assignment);
    const statementEnd = migrationSql.indexOf("  ) pieces;", assignment);
    assert(assignment > 0 && statementStart > 0 && statementEnd > assignment);
    const catalog = migrationSql.slice(statementStart, statementEnd + "  ) pieces".length)
      .replace(" into catalog_digest", "")
      .split("\n").filter(line => !line.trimStart().startsWith("union all select 'relation:'")).join("\n");
    return JSON.parse(sql(`select jsonb_build_object(
      'whole',keryx_storage.snapshot_digest(),
      'logical',(select jsonb_object_agg(name,hash) from (${logical}) rows),
      'otherCatalog',(${catalog}),
      'normalizedCatalog',encode(sha256(convert_to(public.browser_signing_source_canonical(keryx_storage.catalog_contract()),'UTF8')),'hex'),
      'relations',(select jsonb_object_agg(n.nspname||'.'||c.relname,jsonb_build_object(
        'raw',encode(sha256(convert_to(c::text,'UTF8')),'hex'),
        'structural',encode(sha256(convert_to((to_jsonb(c)-array['relpages','reltuples','relallvisible','relfrozenxid','relminmxid'])::text,'UTF8')),'hex'),
        'maintenance',encode(sha256(convert_to(jsonb_build_array(c.relpages,c.reltuples,c.relallvisible,c.relfrozenxid::text,c.relminmxid::text)::text,'UTF8')),'hex')))
        from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','keryx_storage')))`)) as Record<string, unknown>;
  };
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
    const enrolledDiagnostics = snapshotWithDiagnostics();
    const enrolled = enrolledDiagnostics.whole;
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.throws(() => sql(`set role ${role};insert into public.sources(id) values('forbidden')`));
      assert.throws(() => sql(`set role ${role};insert into keryx_storage.writer values(1,'${"0".repeat(64)}','upsert_source')`));
      assert.throws(() => sql(`set role ${role};delete from keryx_storage.identity`));
      if (role !== "service_role") {
        assert.throws(() => sql(`set role ${role};select read_storage_identity()`));
        assert.throws(() => sql(`set role ${role};select storage_read_browser_source_catalog(${literal(identity)},'absent','absent')`));
      }
    }
    assert.equal(snapshot(), enrolled, "ACL refusals leave the whole native snapshot unchanged");
    const foreign = { ...identity, storageId: randomUUID() };
    assert.throws(() => service(`select storage_get_source(${literal(foreign)},'absent')`));
    assert.throws(() => service(`select storage_read_browser_source_catalog(${literal(foreign)},'absent','absent')`));
    assert.deepEqual(JSON.parse(service(`select storage_read_browser_source_catalog(${literal(identity)},'absent','absent')`)),
      { source: null, item: null, offer: null });
    for (const timeout of ["0", "31s"]) {
      assert.throws(() => sql(`set role service_role;set statement_timeout='${timeout}';select storage_get_source(${literal(identity)},'absent')`));
    }
    assert.equal(snapshot(), enrolled);
    service(`begin read only;select storage_get_source(${literal(identity)},'absent');select storage_read_browser_source_catalog(${literal(identity)},'absent','absent');select storage_verify_runtime_authority(${literal(identity)});commit;`);
    for (const test of [
      { name: "raw-text", field: "name", value: "repeat('x',2097153)", error: "browser source catalog bound exceeded" },
      { name: "compressed-json", field: "tags", value: "jsonb_build_array(repeat('x',100000))", error: "browser source catalog compressed metadata refused" },
      { name: "nested-numeric-string-field", field: "authors", value: `'[{"name":{"nested":1e10000},"walletAddress":"0x${"11".repeat(20)}","splitWeight":1}]'::jsonb`,
        error: "browser source catalog metadata shape refused" },
      { name: "numeric-expansion", field: "authors", value: `'[{"name":"Fixture","walletAddress":"0x${"11".repeat(20)}","splitWeight":1e10000}]'::jsonb`,
        error: "browser source catalog metadata shape refused" },
    ]) {
      const source = `catalog-negative-${test.name}`;
      assert.throws(() => sql(`begin;set local role service_role;
        select storage_upsert_source(${literal(identity)},jsonb_build_object(
          'id','${source}','name','Fixture','wallet_address','0x${"11".repeat(20)}',
          'fetch_price',0.001,'tags','[]'::jsonb,'authors','[]'::jsonb,
          'created_at',clock_timestamp(),'active',true,'verified',true)
          || jsonb_build_object('${test.field}',${test.value}));
        select storage_read_browser_source_catalog(${literal(identity)},'${source}','absent');commit;`),
      error => {
        const stderr = (error as { stderr?: unknown }).stderr;
        return typeof stderr === "string" && stderr.includes(test.error);
      }, `Actual catalog preflight ${test.name} must reach its exact refusal`);
      assert.equal(snapshot(), enrolled, "Catalog preflight refusal rolls back the entire owned fixture transaction");
    }
    process.stdout.write("PASS actual coherent catalog raw-text/compressed-JSON/nested-numeric/numeric-expansion preflight refusals and rollback\n");
    const readonlyDiagnostics = snapshotWithDiagnostics();
    if (readonlyDiagnostics.whole !== enrolled) {
      for (const component of ["logical", "otherCatalog", "normalizedCatalog"] as const) {
        if (canonicalJson(readonlyDiagnostics[component]) !== canonicalJson(enrolledDiagnostics[component])) {
          process.stdout.write(`DIAGNOSTIC read-only changed component=${component}\n`);
        }
      }
      const beforeRelations = enrolledDiagnostics.relations as Record<string, Record<string, string>>;
      const afterRelations = readonlyDiagnostics.relations as Record<string, Record<string, string>>;
      for (const name of Object.keys(beforeRelations).sort()) {
        if (beforeRelations[name].raw !== afterRelations[name]?.raw) {
          const category = beforeRelations[name].structural === afterRelations[name]?.structural
            ? "maintenance-only" : "structural";
          process.stdout.write(`DIAGNOSTIC read-only relation=${name} category=${category}\n`);
        }
      }
    }
    assert.equal(readonlyDiagnostics.whole, enrolled, "native read-only authority calls allocate no capabilities or state");
    ownContainer(http);
    docker(["run", "-d", "--name", http, "--network", `container:${postgresContainer}`, "--memory", "256m",
      "-e", `PGRST_DB_URI=postgres://authenticator@127.0.0.1:5432/${database}`,
      "-e", "PGRST_DB_ANON_ROLE=anon", "-e", "PGRST_DB_SCHEMAS=public", "-e", "PGRST_DB_CONFIG=false",
      "-e", "PGRST_DB_POOL=4", "-e", `PGRST_JWT_SECRET=${secret}`, "postgrest/postgrest:v12.2.3"]);
    launchOwnedSupabaseCurl(postgresContainer, ownContainer, docker);
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
      const childStartedAt = performance.now();
      const timingBefore = new Map(bridge!.timings);
      const failureBefore = new Map(bridge!.failures);
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
          category: signal ? performance.now() - childStartedAt >= 120_000 ? "child-timeout" : "terminated"
            : processError ? "process-error" : code === 0 ? "success" : "assertion-failed" }));
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
      const stages = new Set(["startup", "provenance", "readonly", "drift", "source-write", "cache", "auth", "oversize-cache", "create-challenge", "consume-challenge", "reconsume-challenge", "upsert-user", "read-user", "query", "metrics", "creator-leaderboard", "domains", "quota", "close",
        "browser-provenance", "browser-activate", "browser-grant", "browser-source", "browser-items",
        "browser-item-read", "browser-query-admission", "browser-query-replay", "browser-source-admission",
        "browser-source-replay", "browser-expose", "browser-canonical-signature", "browser-conflict-refusal",
        "browser-submit", "browser-terminal"]);
      stages.add("browser-creator-offer");
      stages.add("browser-grant-lock-expiry");
      stages.add("private-intents");
      stages.add("treasury-intents");
      stages.add("treasury-capacity");
      child.stdout!.on("data", (part) => {
        output += part;
        if (output.length > 8192) child.kill();
        for (const match of output.matchAll(/^STAGE ([a-z-]+)$/gm)) if (stages.has(match[1]) && match[1] !== "close") stage = match[1];
      });
      let diagnostic = "";
      let errorOutput = "";
      child.stderr!.on("data", (part) => {
        errorOutput += part;
        if (errorOutput.length > 8192) child.kill();
        const match = errorOutput.match(/^FIXTURE_FAILURE category=(assertion|write-uncertain|storage-refused|type-error|operation-refused) code=(ERR_ASSERTION|[0-9A-Z]{5}|none) reason=(invalid_operation|identity_unavailable|identity_mismatch|adapter_not_initialized|readonly_operation|cache_migration_required|none)$/m);
        if (match) diagnostic = ` failure=${match[1]} code=${match[2]} reason=${match[3]}`;
      });
      const emitChildDiagnostics = () => {
        console.error(`FIXTURE_CHILD_ELAPSED mode=${mode} elapsedMs=${Math.ceil(performance.now() - childStartedAt)}`);
        for (const [operation, timing] of bridge!.timings) {
          const before = timingBefore.get(operation);
          const completed = timing.completed - (before?.completed ?? 0);
          const started = timing.started - (before?.started ?? 0);
          if (started > 0) console.error(`FIXTURE_RPC_TIMING operation=${operation} started=${started} completed=${completed} failed=${timing.failed - (before?.failed ?? 0)} totalMs=${timing.totalMs - (before?.totalMs ?? 0)} lifetimeMaxMs=${timing.maxMs}`);
        }
        for (const [category, count] of bridge!.failures) {
          const failed = count - (failureBefore.get(category) ?? 0);
          if (failed > 0) console.error(`FIXTURE_RPC_FAILURE category=${category} count=${failed}`);
        }
        for (const [operation, shape] of bridge!.metricShapes) {
          console.error(`FIXTURE_METRIC_SHAPE operation=${operation} shape=${shape.shape} length=${shape.length ?? "none"}`);
        }
      };
      try {
        if (mode === "drift") {
          const deadline = performance.now() + 30_000;
          while (!output.includes("READY synthetic schema drift") && !childTerminal && performance.now() < deadline) {
            await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 20));
          }
          assert(output.includes("READY synthetic schema drift"), `Native factory fixture mode=${mode} stage=${stage} category=handshake-refused`);
          sql("alter function public.storage_get_source(jsonb,text) cost 101");
          child.stdin!.end("resume\n");
        }
        if (mode === "domain-binding") {
          const deadline = performance.now() + 100_000;
          while (!output.includes("READY synthetic grant lock") && !childTerminal && performance.now() < deadline) {
            await new Promise<void>(resolveDelay => setTimeout(resolveDelay, 20));
          }
          if (!output.includes("READY synthetic grant lock")) {
            if (!childTerminal) child.kill("SIGKILL");
            const failed = await boundedCompletion;
            if (childTerminal) children.delete(child);
            assert.fail(`Native binding lock handshake mode=${mode} stage=${stage} category=${failed.category}${diagnostic}`);
          }
          const beforeLockAdmission = snapshot();
          const refusalKey = "storage_browser_signing_admit_source_original:http-400-sqlstate-P0001-source-observation-expired";
          const refusedBefore = bridge!.failures.get(refusalKey) ?? 0;
          const locker = execFile("docker", ["exec", "-i", postgresContainer, "psql", "-U", "postgres",
            "--dbname", database, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
          { timeout: 30_000, maxBuffer: 4096 });
          const lockerDone = new Promise<{ code: number | null; category: string }>(resolveDone => {
            locker.once("error", () => { if (!locker.pid) resolveDone({ code: null, category: "spawn-error" }); });
            locker.once("close", code => resolveDone({ code, category: code === 0 ? "success" : "lock-fixture-failed" }));
          });
          children.set(locker, lockerDone);
          let lockerOutput = "";
          locker.stdout!.on("data", part => { lockerOutput += part; if (lockerOutput.length > 4096) locker.kill(); });
          locker.stdin!.write("set statement_timeout='10s';begin;select 1 from public.session_grants for update;\\echo READY_GRANT_LOCK\n");
          const lockReadyDeadline = performance.now() + 5000;
          while (!lockerOutput.includes("READY_GRANT_LOCK") && performance.now() < lockReadyDeadline) {
            await new Promise<void>(resolveDelay => setTimeout(resolveDelay, 20));
          }
          assert(lockerOutput.includes("READY_GRANT_LOCK"), "Owned grant lock acquired");
          const sourceAdmissionOperation = "storage_browser_signing_admit_source_original";
          const admissionsBefore = bridge!.counts.get(sourceAdmissionOperation) ?? 0;
          const priorAdmissionDeadline = bridge!.getSourceAdmissionDeadlineMs();
          child.stdin!.write("resume\n");
          const waiterDeadline = performance.now() + 15_000;
          // Do not compete with the guarded catalog observation by launching
          // synchronous PostgreSQL probes before the actual admission RPC.
          await waitForOwnedSourceAdmissionEntry(bridge!.counts, admissionsBefore, waiterDeadline, () => childTerminal);
          const enteredAdmissionDeadline = bridge!.getSourceAdmissionDeadlineMs();
          assert.ok(enteredAdmissionDeadline !== null && enteredAdmissionDeadline !== priorAdmissionDeadline &&
            Date.now() < enteredAdmissionDeadline, "Fresh source RPC retains its original current deadline");
          let waited = false;
          while (performance.now() < waiterDeadline) {
            waited = sql("select exists(select 1 from pg_stat_activity a where a.datname=current_database() and a.pid<>pg_backend_pid() and a.wait_event_type='Lock' and a.query like '%storage_browser_signing_admit_source_original%' and exists(select 1 from pg_locks l where l.pid=a.pid and not l.granted))::text") === "true";
            if (waited) break;
            await new Promise<void>(resolveDelay => setTimeout(resolveDelay, 20));
          }
          assert(waited, "Actual protected source admission must wait on held grant lock");
          const waiterAt = performance.now();
          const admissionDeadline = bridge!.getSourceAdmissionDeadlineMs();
          assert.ok(admissionDeadline !== null && Number.isSafeInteger(admissionDeadline));
          const remaining = admissionDeadline + 25 - Date.now();
          assert.ok(remaining > 0 && remaining < 5000, "Actual token deadline remains within bounded grant wait");
          await new Promise<void>(resolveDelay => setTimeout(resolveDelay, remaining));
          assert.ok(Date.now() > admissionDeadline, "Release occurs after original source-token deadline");
          assert.ok(performance.now() - waiterAt < 5000, "Grant waiter stays within unchanged lock budget");
          locker.stdin!.end("rollback;\n");
          assert.equal((await lockerDone).code, 0);
          children.delete(locker);
          const refusalDeadline = performance.now() + 15_000;
          while ((bridge!.failures.get(refusalKey) ?? 0) === refusedBefore && !childTerminal && performance.now() < refusalDeadline) {
            await new Promise<void>(resolveDelay => setTimeout(resolveDelay, 20));
          }
          assert.equal(bridge!.failures.get(refusalKey), refusedBefore + 1, "Actual after-lock source deadline refusal");
          const refusalReadyDeadline = performance.now() + 5000;
          while (!output.includes("READY synthetic grant refusal") && !childTerminal && performance.now() < refusalReadyDeadline) {
            await new Promise<void>(resolveDelay => setTimeout(resolveDelay, 20));
          }
          assert(output.includes("READY synthetic grant refusal"), "Child pauses after exact grant refusal");
          assert.equal(snapshot(), beforeLockAdmission, "Expired after-lock admission preserves whole native database");
          child.stdin!.end("verified\n");
        }
      } catch (error) {
        // Parent assertions must retain the same redacted evidence as child
        // failures, including assertions reached after the first READY signal.
        if (!childTerminal) child.kill("SIGKILL");
        const failed = await boundedCompletion;
        if (childTerminal) children.delete(child);
        emitChildDiagnostics();
        const admissionDeadline = bridge!.getSourceAdmissionDeadlineMs();
        console.error(`FIXTURE_PARENT_FAILURE mode=${mode} stage=${stage} category=${failed.category}${diagnostic}`);
        console.error(`FIXTURE_ADMISSION_DEADLINE recorded=${admissionDeadline !== null} current=${admissionDeadline !== null && Date.now() < admissionDeadline}`);
        throw error;
      }
      const result = await boundedCompletion;
      if (childTerminal) children.delete(child);
      if (result.code !== 0) emitChildDiagnostics();
      assert.equal(result.code, 0, `Native factory fixture mode=${mode} stage=${stage} category=${result.category}${diagnostic}`);
      assert(output.includes("PASS"));
    };
    await runChild("refused-startup", "anon");
    await runChild("refused-startup", "authenticated");
    assert.equal(snapshot(), enrolled);
    await runChild("read-write");
    await runChild("auth-user");
    await runChild("query-metrics");
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
    await runChild("domain-binding");
    await runChild("domain-capacity");
    await runChild("domain-terminal");
    await runChild("domain-auth");
    await runChild("domain-intent");
    await runChild("domain-treasury");
    registry.assertHealthy();
    await registry.close();
    registry = undefined;
    const beforeMissingCounter = snapshot();
    sql(`do $missing$ begin
      begin
        delete from keryx_storage.cache_quota;
        set local role service_role;
        perform public.storage_set_cached(${literal(identity)},${literal(retainedCacheRow)});
        raise exception 'synthetic missing quota unexpectedly accepted';
      exception when others then
        if sqlerrm <> 'storage cache quota refused' then raise; end if;
      end;
    end $missing$;`);
    assert.equal(snapshot(), beforeMissingCounter,
      "Missing quota counter refusal rolls back the whole financial/cache snapshot");
    assert.equal(sql("select count(*) from keryx_storage.writer"), "0");
    process.stdout.write("PASS native missing quota refusal, full rollback and private capability cleanup\n");
    await runChild("drift");
    assert.equal(sql("select count(*) from keryx_storage.writer"), "0");
    process.stdout.write("PASS native HTTPS closed factory, role/identity/deadline/read-only/provenance/drift gates\n");
  } catch (error) {
    console.error(`FIXTURE_CURL_STATE ${describeOwnedSupabaseCurlState(postgresContainer, docker)}`);
    throw error;
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
