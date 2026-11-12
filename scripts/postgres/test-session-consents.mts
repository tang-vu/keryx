/** Real native domain qualification on two independently installed synthetic
 * databases. No production data/credentials, signing, vendor IO or payment. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { nativeConsentDomainSource, nativeFundingDomainSource, nativeWithdrawalDomainSource, nativeCreatorWithdrawalDomainSource } from "./native-domain-source.mts";
import { qualifyFunding } from "./qualify-funding.mts";
import { exportPostgres17SchemaContract } from "../helpers/enrolled-postgres-schema-contract.mts";
import { postgresPoolConfiguration } from "../../lib/db/postgres/connection";
import { STORAGE_MAINNET_PROFILE_DIGEST, storageIdentityDigest, type StorageIdentity } from "../../lib/db/storage-identity";
import { canonicalJson } from "../../lib/canonical-json";
import { parseSessionGrantConsent, type SessionGrantConsent } from "../../lib/payments/session-grant-consent";
import { ARC_MAINNET_PROFILE } from "../../lib/arc-network-profile";
import { createPostgresConsentTransport, PostgresConsentWriteOutcomeUnknown, type PostgresConsentTransport } from "../../lib/db/postgres/consent-transport";
import { startCommitAckLossProxy } from "./commit-ack-loss.mts";
import { createPostgresSessionTransport, type PostgresSessionTransport } from "../../lib/db/postgres/session-transport";
import { createPostgresWithdrawalTransport, type PostgresWithdrawalTransport } from "../../lib/db/postgres/withdrawal-transport";
import { qualifySessionWithdrawals } from "./qualify-session-withdrawals.mts";
import { createPostgresCreatorWithdrawalTransport, type PostgresCreatorWithdrawalTransport } from "../../lib/db/postgres/creator-withdrawal-transport";
import { qualifyCreatorWithdrawals } from "./qualify-creator-withdrawals.mts";

const name = `keryx-postgres-consents-${randomUUID()}`, password = randomBytes(24).toString("hex");
const docker = (args: string[], input?: string, timeout = 30_000) => execFileSync("docker", args,
  { input, timeout, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
const sql = (database: "postgres" | "native_source" | "native_target", query: string) => docker(
  ["exec", "-i", name, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database], query).trim();
const literal = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const identity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real", network: "eip155:5042",
  profileDigest: STORAGE_MAINNET_PROFILE_DIGEST, deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(),
  enrolledAt: new Date().toISOString(), provenanceDigest: "11".repeat(32) };
const owner = `0x${"11".repeat(20)}`, signer = `0x${"22".repeat(20)}`;
const sig = `0x${"33".repeat(65)}`, sessionSig = `0x${"44".repeat(65)}`;
const consent = (overrides: Record<string, unknown> = {}): SessionGrantConsent => parseSessionGrantConsent({ format: "keryx-session-grant-consent-v1",
  network: "eip155:5042", origin: "https://keryx.cc", ownerAddr: owner, sessAddr: signer, grantEpoch: randomUUID(),
  capMicroUsdc: "10", expirySeconds: String(Math.floor(Date.now() / 1000) + 3600), ...overrides }, ARC_MAINNET_PROFILE);
let owned = false;
const clients: Client[] = [];
const transports: PostgresConsentTransport[] = [];
let ackProxy: Awaited<ReturnType<typeof startCommitAckLossProxy>> | undefined;
process.once("exit", () => { if (owned) try { docker(["rm", "-f", name]); } catch {} });
try {
  const image = docker(["image", "inspect", "postgres:17-alpine", "--format", "{{.Id}}"] ).trim();
  owned = true;
  docker(["run", "-d", "--name", name, "--user", "postgres", "--read-only", "--memory", "768m", "--cpus", "1", "--pids-limit", "64",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,uid=70,gid=70,size=256m",
    "--tmpfs", "/var/run/postgresql:rw,nosuid,uid=70,gid=70,size=8m", "--tmpfs", "/tmp:rw,nosuid,size=16m",
    "-p", "127.0.0.1::5432", "-e", `POSTGRES_PASSWORD=${password}`, "postgres:17-alpine", "-c", "shared_buffers=32MB", "-c", "max_connections=12"]);
  let ready = false;
  const startup = performance.now() + 20_000;
  while (performance.now() < startup) {
    try { docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], undefined, 2_000); ready = true; break; }
    catch { await delay(100); }
  }
  assert(ready, "Owned native domain fixture must start");
  sql("postgres", `CREATE ROLE keryx_owner NOLOGIN NOINHERIT; CREATE ROLE keryx_app LOGIN NOINHERIT CONNECTION LIMIT 8 PASSWORD '${password}';
    CREATE ROLE keryx_reader LOGIN NOINHERIT CONNECTION LIMIT 4 PASSWORD '${password}';
    CREATE DATABASE native_source WITH TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C' LC_CTYPE 'C' CONNECTION LIMIT 16;
    CREATE DATABASE native_target WITH TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C' LC_CTYPE 'C' CONNECTION LIMIT 16;`);
  const withCreator = process.argv.includes("--creator");
  const withWithdrawals = process.argv.includes("--withdrawals") || withCreator;
  const withFunding = process.argv.includes("--funding") || withWithdrawals;
  const source = withCreator ? nativeCreatorWithdrawalDomainSource() : withWithdrawals ? nativeWithdrawalDomainSource() : withFunding ? nativeFundingDomainSource() : nativeConsentDomainSource();
  for (const database of ["native_source", "native_target"] as const) {
    assert.equal(sql(database, "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public';"), "0");
    sql(database, "SET statement_timeout='30s'; GRANT CREATE ON SCHEMA public TO keryx_owner; BEGIN;\n" + source.sql + "\nCOMMIT;");
  }
  const describe = "SET statement_timeout='5s'; SELECT keryx_storage.catalog_contract();";
  const reference = exportPostgres17SchemaContract(JSON.parse(sql("native_source", describe)));
  const target = exportPostgres17SchemaContract(JSON.parse(sql("native_target", describe)));
  assert.equal(target.sha256, reference.sha256, "Target must match a separately built SOURCE before its seal is inserted");
  sql("native_target", `INSERT INTO keryx_storage.identity VALUES(true,${literal(identity)},'${storageIdentityDigest(identity)}');
    INSERT INTO keryx_storage.source_contract VALUES(true,${literal(JSON.parse(reference.canonicalJson))},'${reference.sha256}');
    INSERT INTO public.browser_signer_capacity VALUES('${signer}',7);
    UPDATE keryx_storage.control SET mode='active';`);
  const port = Number(docker(["port", name, "5432/tcp"]).trim().split(":")[1]);
  const connect = async (role: string) => {
    const client = new Client(postgresPoolConfiguration({ endpoint: { kind: "loopback", port }, database: "native_target", role, password }));
    client.on("error", () => {}); clients.push(client); await client.connect(); return client;
  };
  const app = await connect("keryx_app"), other = await connect("keryx_app"), reader = await connect("keryx_reader");
  const createTransport = withCreator ? createPostgresCreatorWithdrawalTransport : withWithdrawals ? createPostgresWithdrawalTransport : withFunding ? createPostgresSessionTransport : createPostgresConsentTransport;
  const nativeTransport = createTransport({ endpoint: { kind: "loopback", port }, database: "native_target", role: "keryx_app", password }, identity, reference.sha256);
  transports.push(nativeTransport);
  const issue = (value: unknown, expected = identity, digest = reference.sha256) => app.query(
    "SELECT public.storage_issue_session_grant_consent($1::jsonb,$2::text,$3::text) AS result", [JSON.stringify(expected), digest, canonicalJson(value)]);
  const consume = (client: Client, value: SessionGrantConsent, signature = sig) => client.query(
    "SELECT public.storage_consume_session_grant_consent($1::jsonb,$2::text,$3::text,$4::text,$5::text) AS result",
    [JSON.stringify(identity), reference.sha256, canonicalJson(value), signature, sessionSig]);
  const original = consent();
  await assert.rejects(issue(original)); // Inactive journal never acquires authority.
  assert.equal(sql("native_target", "SELECT count(*) FROM public.session_grant_consents;"), "0");
  sql("native_target", "UPDATE keryx_storage.control SET mode='held'; UPDATE public.browser_journal_control SET active=true; UPDATE keryx_storage.control SET mode='active';");
  await assert.rejects(issue(original, { ...identity, storageId: randomUUID() }));
  await assert.rejects(issue(original, identity, "00".repeat(32)));
  await assert.rejects(issue({ ...original, network: "eip155:5042002" }));
  await assert.rejects(issue({ ...original, origin: "https://foreign.invalid" }));
  await issue(original);
  await assert.rejects(issue(original));
  await assert.rejects(consume(app, original, "invalid"));
  const race = await Promise.allSettled([consume(app, original), consume(other, original)]);
  assert.equal(race.filter(r => r.status === "fulfilled").length, 1, JSON.stringify(race.map(r => r.status === "rejected"
    ? { status: r.status, code: r.reason?.code, message: String(r.reason?.message).slice(0, 240) } : { status: r.status })));
  assert.equal(race.filter(r => r.status === "rejected").length, 1);
  assert.equal(sql("native_target", `SELECT spent::text FROM public.session_grants WHERE session_id='${owner}';`), "0.000007");
  assert.equal(sql("native_target", `SELECT spent_micro FROM public.browser_signer_capacity WHERE signer='${signer}';`), "7");
  const low = consent({ capMicroUsdc: "6" }); await issue(low); await assert.rejects(consume(app, low));
  assert.equal(sql("native_target", `SELECT consumed_at IS NULL FROM public.session_grant_consents WHERE grant_epoch='${low.grantEpoch}';`), "t");
  assert.equal(sql("native_target", `SELECT count(*) FROM public.browser_retained_grants WHERE grant_epoch='${low.grantEpoch}';`), "0");
  const v2 = consent({ format: "keryx-session-grant-consent-v2", durationSeconds: 604800, questionCapMicroUsdc: "5" });
  await nativeTransport.issue(v2); await nativeTransport.consume(v2, sig, sessionSig);
  assert.deepEqual(await nativeTransport.get(owner, v2.grantEpoch), { consent: v2, ownerSignature: sig, sessionSignature: sessionSig });
  ackProxy = await startCommitAckLossProxy(port);
  const uncertainTransport = createPostgresConsentTransport({ endpoint: { kind: "loopback", port: ackProxy.port }, database: "native_target", role: "keryx_app", password }, identity, reference.sha256);
  transports.push(uncertainTransport);
  const uncertain = consent(); await uncertainTransport.issue(uncertain); ackProxy.arm();
  await assert.rejects(uncertainTransport.consume(uncertain, sig, sessionSig), PostgresConsentWriteOutcomeUnknown);
  assert.deepEqual(ackProxy.observation(), { dropped: true, commands: 2 }, "A lost commit acknowledgement must not cause a driver retry");
  assert.deepEqual(await nativeTransport.get(owner, uncertain.grantEpoch), { consent: uncertain, ownerSignature: sig, sessionSignature: sessionSig });
  assert.equal(sql("native_target", `SELECT count(*) FROM public.browser_retained_grants WHERE grant_epoch='${uncertain.grantEpoch}';`), "1");
  await uncertainTransport.close(); transports.splice(transports.indexOf(uncertainTransport), 1);
  await ackProxy.close(); ackProxy = undefined;
  const expired = consent(), hosted = consent({ sessAddr: `0x${"55".repeat(20)}` }),
    ownerWithdrawal = consent({ sessAddr: `0x${"66".repeat(20)}` }), sessionWithdrawal = consent({ sessAddr: `0x${"77".repeat(20)}` });
  const old = Date.now() - 100_000;
  sql("native_target", `UPDATE keryx_storage.control SET mode='held';
    INSERT INTO public.session_grant_consents VALUES('${expired.grantEpoch}','${owner}','${signer}',${literal(canonicalJson(expired))}#>>'{}',${old},${old + 90000},NULL,NULL,NULL);
    INSERT INTO public.hosted_treasury_policies VALUES('synthetic-policy','${hosted.sessAddr}','public','{}');
    INSERT INTO public.creator_withdrawal_requests VALUES('synthetic-original','${ownerWithdrawal.sessAddr}','{}');
    INSERT INTO public.session_withdrawal_preparations(request_id,recovery_owner,signer,grant_epoch,data)
     VALUES('synthetic-session-original','${owner}','${sessionWithdrawal.sessAddr}','${v2.grantEpoch}',
      jsonb_build_object('format','keryx-session-withdrawal-preparation-v1','network','eip155:5042','requestId','synthetic-session-original',
       'ownerAddr','${owner}','sessAddr','${sessionWithdrawal.sessAddr}','grantEpoch','${v2.grantEpoch}')::text);
    UPDATE keryx_storage.control SET mode='active';`);
  await assert.rejects(consume(app, expired));
  for (const blocked of [hosted, ownerWithdrawal, sessionWithdrawal]) {
    await issue(blocked); await assert.rejects(consume(app, blocked));
    assert.equal(sql("native_target", `SELECT consumed_at IS NULL FROM public.session_grant_consents WHERE grant_epoch='${blocked.grantEpoch}';`), "t");
    assert.equal(sql("native_target", `SELECT count(*) FROM public.browser_retained_grants WHERE grant_epoch='${blocked.grantEpoch}';`), "0");
  }
  await reader.query("BEGIN READ ONLY");
  const proof = await reader.query("SELECT public.storage_get_session_grant_consent($1::jsonb,$2::text,$3::text,$4::text) AS result",
    [JSON.stringify(identity), reference.sha256, owner, original.grantEpoch]);
  assert.equal(typeof proof.rows[0].result, "string");
  assert(Buffer.byteLength(proof.rows[0].result) <= 8192);
  assert.deepEqual(JSON.parse(proof.rows[0].result), { consent: original, ownerSignature: sig, sessionSignature: sessionSig });
  await reader.query("COMMIT");
  await app.query("SET synchronous_commit='off'"); await assert.rejects(issue(consent())); await app.query("SET synchronous_commit='on'");
  await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await assert.rejects(reader.query("SELECT public.storage_get_session_grant_consent($1::jsonb,$2::text,$3::text,$4::text)",
    [JSON.stringify(identity), reference.sha256, owner, original.grantEpoch]));
  await reader.query("ROLLBACK");
  await assert.rejects(reader.query("SELECT public.storage_issue_session_grant_consent($1::jsonb,$2::text,$3::text)", [JSON.stringify(identity), reference.sha256, canonicalJson(consent())]));
  await assert.rejects(app.query("SELECT * FROM keryx_storage.identity"));
  await assert.rejects(app.query("UPDATE public.browser_signer_capacity SET spent_micro=0"));
  await assert.rejects(app.query("SET ROLE keryx_owner"));
  await assert.rejects(app.query("SELECT keryx_storage.require_operation($1::jsonb,$2::text,'consume_session_grant_consent')", [JSON.stringify(identity), reference.sha256]));
  assert.equal(sql("native_target", "SELECT count(*) FROM keryx_storage.writer;"), "0");
  const funding = withFunding ? await qualifyFunding({ transport: nativeTransport as PostgresSessionTransport,
    ownerSql: statement => sql("native_target", statement) }) : undefined;
  const withdrawals = withWithdrawals ? await qualifySessionWithdrawals({ transport: nativeTransport as PostgresWithdrawalTransport,
    options: { endpoint: { kind: "loopback", port }, database: "native_target", role: "keryx_app", password }, identity, digest: reference.sha256,
    ownerSql: statement => sql("native_target", statement), ...(withCreator ? { creatorTransport: nativeTransport as PostgresCreatorWithdrawalTransport } : {}) }) : undefined;
  const creator = withCreator ? await qualifyCreatorWithdrawals({ transport: nativeTransport as PostgresCreatorWithdrawalTransport,
    options: { endpoint: { kind: "loopback", port }, database: "native_target", role: "keryx_app", password }, identity, digest: reference.sha256,
    ownerSql: statement => sql("native_target", statement) }) : undefined;
  assert.throws(() => sql("native_target", "UPDATE keryx_storage.source_contract SET source_digest=repeat('0',64);"));
  sql("native_target", "ALTER TABLE public.session_grants ADD COLUMN unexpected_drift text;");
  await assert.rejects(issue(consent()));
  console.log(JSON.stringify({ format: "keryx-native-postgres-consent-domain-qualification-v1", passed: true, image,
    sourceSha256: source.sha256, referenceContract: reference.sha256, independentSourceTargetEqual: true,
    concurrentConsumeExactlyOnce: true, cumulativeSignerSpendRetained: true, failedConsumeRolledBack: true,
    v1AndV2: true, expiredChallengeRefused: true, hostedAndWithdrawalBarriers: true,
    readonlyTransaction: true, unsafeDurabilityAndIsolationRefused: true, rawWriteAndContextRefused: true, contractDriftRefused: true,
    nativeTypedTransport: true, actualLostCommitAckReconciled: true, automaticWriteRetry: false, ...(funding ? { funding } : {}),
    ...(withdrawals ? { withdrawals } : {}),
    ...(creator ? { creator } : {}),
    paidOperations: 0, productionDataRead: false, applicationBackendSwitched: false,
    limitations: "Native consent/funding and explicitly selected withdrawal protocols only. Remaining financial protocols, full application/profile parity and production cutover are not admitted." }));
} finally {
  await ackProxy?.close();
  await Promise.allSettled(transports.map(transport => transport.close()));
  await Promise.allSettled(clients.map(client => client.end()));
  if (owned) {
    assert.match(name, /^keryx-postgres-consents-[0-9a-f-]{36}$/);
    docker(["rm", "-f", name]); assert.equal(docker(["ps", "-aq", "--filter", `name=^/${name}$`]).trim(), ""); owned = false;
  }
}
