/** Actual PG17 transport qualification on an owned synthetic-only container.
 * These fixture functions are not a mainnet runtime/schema admission contract. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { createPostgresBootstrapTransport, PostgresStorageBusy, PostgresStorageUnavailable } from "../../lib/db/postgres/connection";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "../../lib/db/storage-identity";
import { rehearseSqliteSnapshot } from "./rehearse-snapshot.mts";

const name = `keryx-postgres-bootstrap-${randomUUID()}`;
const password = randomBytes(24).toString("hex");
const contract = "22".repeat(32);
const identity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real",
  network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST, deploymentId: randomUUID(),
  storageId: randomUUID(), enrollmentId: randomUUID(), enrolledAt: "2026-11-11T00:00:00.000Z", provenanceDigest: "11".repeat(32) };
const jsonLiteral = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const docker = (args: string[], input?: string, timeout = 20_000) => execFileSync("docker", args,
  { input, timeout, encoding: "utf8", maxBuffer: 256 * 1024, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
const sql = (text: string) => docker(["exec", "-i", name, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], text).trim();
let owned = false;
let transport: ReturnType<typeof createPostgresBootstrapTransport> | undefined;
process.once("exit", () => {
  if (owned) try { docker(["rm", "-f", name]); } catch { /* Preserve the failed trial; its caller retains the exact owned name. */ }
});
try {
  const image = docker(["image", "inspect", "postgres:17-alpine", "--format", "{{.Id}}"] ).trim();
  owned = true;
  docker(["run", "-d", "--name", name, "--user", "postgres", "--read-only", "--memory", "768m", "--cpus", "1", "--pids-limit", "64",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,uid=70,gid=70,size=256m",
    "--tmpfs", "/var/run/postgresql:rw,nosuid,uid=70,gid=70,size=8m", "--tmpfs", "/tmp:rw,nosuid,size=16m",
    "-p", "127.0.0.1::5432", "-e", `POSTGRES_PASSWORD=${password}`,
    "postgres:17-alpine", "-c", "shared_buffers=32MB", "-c", "max_connections=12"]);
  let ready = false;
  const startupDeadline = performance.now() + 20_000;
  while (performance.now() < startupDeadline) {
    // The image starts a temporary Unix-only server while initializing. Wait
    // for the final TCP listener so its deliberate shutdown is not readiness.
    try { docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], undefined, 2_000); ready = true; break; }
    catch { await delay(100); }
  }
  if (!ready) {
    const state = docker(["inspect", "--format", "{{.State.Status}} {{.State.OOMKilled}} {{.State.ExitCode}}", name]).trim();
    const logs = docker(["logs", "--tail", "12", name]).slice(-3000);
    throw new Error(`Owned PostgreSQL startup failed (${state}): ${logs}`);
  }
  const version = Number(sql("SELECT current_setting('server_version_num');"));
  assert(version >= 170000 && version < 180000);
  const portText = docker(["port", name, "5432/tcp"]).trim();
  assert.match(portText, /^127\.0\.0\.1:\d+$/);
  const port = Number(portText.split(":")[1]);
  sql(`CREATE ROLE keryx_fixture_reader LOGIN PASSWORD '${password}';
    CREATE SCHEMA keryx_pg;
    REVOKE ALL ON SCHEMA keryx_pg FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES IN SCHEMA keryx_pg REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
    CREATE TABLE keryx_pg.fixture_identity(identity jsonb NOT NULL);
    INSERT INTO keryx_pg.fixture_identity VALUES(${jsonLiteral(identity)});
    CREATE FUNCTION keryx_pg.read_identity(expected jsonb) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
    DECLARE actual jsonb;
    BEGIN SELECT identity INTO actual FROM keryx_pg.fixture_identity;
      IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'private fixture refusal'; END IF;
      RETURN actual;
    END $$;
    CREATE FUNCTION keryx_pg.verify_runtime_authority(expected jsonb,digest text) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
    BEGIN PERFORM keryx_pg.read_identity(expected);
      IF digest IS DISTINCT FROM '${contract}' THEN RAISE EXCEPTION 'private fixture refusal'; END IF;
      RETURN jsonb_build_object('ready',true);
    END $$;
    CREATE FUNCTION keryx_pg.inspect_runtime_readiness(expected jsonb,digest text) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
    BEGIN PERFORM keryx_pg.verify_runtime_authority(expected,digest);
      PERFORM pg_sleep(0.2); RETURN jsonb_build_object('ready',true);
    END $$;
    GRANT USAGE ON SCHEMA keryx_pg TO keryx_fixture_reader;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA keryx_pg TO keryx_fixture_reader;`);
  const options = { endpoint: { kind: "loopback" as const, port }, database: "postgres", role: "keryx_fixture_reader", password };
  transport = createPostgresBootstrapTransport(options);
  assert.deepEqual(await transport.read("identity", identity), identity);
  assert.deepEqual(await transport.read("authority", identity, contract), { ready: true });
  await assert.rejects(transport.read("identity", { ...identity, storageId: randomUUID() }), PostgresStorageUnavailable);
  await assert.rejects(transport.read("authority", identity, "33".repeat(32)), PostgresStorageUnavailable);
  await assert.rejects(transport.read("constructor" as never, identity), PostgresStorageUnavailable);
  assert.throws(() => sql("SET ROLE keryx_fixture_reader; INSERT INTO keryx_pg.fixture_identity VALUES('{}');"));
  assert.equal(sql("SELECT count(*) FROM keryx_pg.fixture_identity;"), "1");

  const requests = Array.from({ length: 10 }, () => transport!.read("readiness", identity, contract));
  await assert.rejects(transport.read("readiness", identity, contract), PostgresStorageBusy);
  let timerServiced = false;
  const timer = setTimeout(() => { timerServiced = true; }, 20);
  await Promise.all(requests); clearTimeout(timer);
  assert(timerServiced, "Database work must leave the JS event loop available");
  const connections = Number(sql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_fixture_reader';"));
  assert(connections <= 2);
  const pending = transport.read("readiness", identity, contract);
  const closed = transport.close();
  await assert.rejects(pending, PostgresStorageUnavailable); await closed;
  await assert.rejects(transport.read("identity", identity), PostgresStorageUnavailable);
  assert.equal(sql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_fixture_reader';"), "0");
  transport = undefined;
  // Separate operational role and namespace: the runtime fixture reader has
  // no permission to import or observe this private migration copy.
  sql(`CREATE ROLE keryx_fixture_importer LOGIN PASSWORD '${password}';
    GRANT CREATE ON DATABASE postgres TO keryx_fixture_importer;`);
  const importer = { endpoint: { kind: "loopback" as const, port }, database: "postgres", role: "keryx_fixture_importer", password };
  const snapshot = new DatabaseSync(":memory:");
  let snapshotResult: Awaited<ReturnType<typeof rehearseSqliteSnapshot>>;
  try {
    snapshot.exec(`CREATE TABLE sample(a,b,c,d,e,f,g);
      CREATE TABLE empty_table(id INTEGER PRIMARY KEY AUTOINCREMENT);
      INSERT INTO sample VALUES(NULL,9223372036854775807,-9223372036854775808,1.5,x'00ff',CAST(x'00c3ff' AS TEXT),'');
      WITH RECURSIVE n(x) AS(VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<129)
      INSERT INTO sample SELECT x,'duplicate',NULL,0.1,x'ff',CAST(x'c3ff' AS TEXT),'' FROM n;
      BEGIN;`);
    snapshotResult = await rehearseSqliteSnapshot(snapshot, importer);
    assert.equal(snapshotResult.totalRows, 130); assert.equal(snapshotResult.tables.length, 3);
    assert.equal(snapshotResult.verified, true); assert.equal(snapshotResult.applicationBackendSwitched, false);
    const count = sql("SELECT count(*) FROM keryx_migration.snapshot_rows"); assert.equal(count, "130");
    // A second attempt refuses rather than merging into or replacing a copy.
    await assert.rejects(rehearseSqliteSnapshot(snapshot, importer));
    assert.equal(sql("SELECT count(*) FROM keryx_migration.snapshot_rows"), count);
    assert.throws(() => sql("SET ROLE keryx_fixture_reader; SELECT * FROM keryx_migration.snapshot_rows;"));
  } finally { snapshot.close(); }
  assert.equal(sql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_fixture_importer';"), "0");
  console.log(JSON.stringify({ format: "keryx-postgres-bootstrap-qualification-v1", passed: true, image, serverVersion: version,
    liveProductionCalls: 0, paidOperations: 0, syntheticIdentityOnly: true, eventLoopServiced: true,
    configuredConnections: 2, actualConnections: connections, boundedQueueRefused: true, closedResultsRefused: true,
    directProtectedWriteRefused: true, snapshotRehearsal: snapshotResult,
    limitations: "Actual PG transport and synthetic lossless-copy fixture only; no current mainnet domain parity, production enrollment, application migration or cutover acceptance." }));
} finally {
  await transport?.close();
  if (owned) {
    assert.match(name, /^keryx-postgres-bootstrap-[0-9a-f-]{36}$/);
    docker(["rm", "-f", name]);
    const remaining = docker(["ps", "-aq", "--filter", `name=^/${name}$`]).trim();
    assert.equal(remaining, "", "Owned fixture container must be removed");
    owned = false;
  }
}
