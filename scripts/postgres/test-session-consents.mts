/** Real native domain qualification on two independently installed synthetic
 * databases. No production data/credentials, signing, vendor IO or payment. */
import assert from "node:assert/strict";
import { execFileSync,spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { nativeConsentDomainSource, nativeFundingDomainSource, nativeWithdrawalDomainSource, nativeCreatorWithdrawalDomainSource, nativeHostedLedgerSource, nativeOwnerWithdrawalSource } from "./native-domain-source.mts";
import { qualifyFunding } from "./qualify-funding.mts";
import { nativePostgres17DescriptorBody } from './native-catalog-body.mts';
import { exportNativePostgresSchemaContract } from "./native-contract.mts";
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
import { createPostgresHostedLedgerTransport, type PostgresHostedLedgerTransport } from "../../lib/db/postgres/hosted-ledger-transport";
import { qualifyHostedLedger } from "./qualify-hosted-ledger.mts";
import { createPostgresOwnerWithdrawalTransport, type PostgresOwnerWithdrawalTransport } from "../../lib/db/postgres/owner-withdrawal-transport";
import { qualifyOwnerWithdrawals } from "./qualify-owner-withdrawals.mts";
import { qualifyCurrentTableConstraints } from "./qualify-current-tables.mts";
import { nativeAuthApplicationSource } from "./auth-domain-source.mts";
import { qualifyAuthDomains } from "./qualify-auth-domains.mts";
import { nativeOperationalApplicationSource } from "./operational-domain-source.mts";
import { qualifyOperationalDomains } from "./qualify-operational-domains.mts";
import { nativeBoundedReadApplicationSource } from "./bounded-read-source.mts";
import { qualifyBoundedReads } from "./qualify-bounded-reads.mts";
import { qualifyDashboardMetrics } from "./qualify-dashboard-metrics.mts";
import { nativePrivateProfilesSource } from "./private-profiles-source.mts";
import { qualifyPrivateProfiles } from "./qualify-private-profiles.mts";
import { nativeProfileIdentitiesSource } from "./profile-identities-source.mts";
import { qualifyProfileIdentities } from "./qualify-profile-identities.mts";
import { nativePersonalHistorySource } from "./personal-history-source.mts";
import { qualifyPersonalHistory } from "./qualify-personal-history.mts";
import { nativeRuntimeSource } from "./native-runtime-source.mts";
import { qualifyNativeRuntime } from "./qualify-native-runtime.mts";
import { qualifyOriginalJson } from "./qualify-original-json.mts";
import { nativePrivacySource } from './privacy-source.mts';
import { qualifyPrivacy } from './qualify-privacy.mts';
import { qualifyWorkspaces } from './qualify-workspaces.mts';
import { nativeWorkspacesSource } from './workspaces-source.mts';
import { qualifyOwnershipHistory } from './qualify-ownership-history.mts';
import { qualifyRunClaims } from "./qualify-run-claims.mts";
import { createPostgresRuntimeTransport } from "../../lib/db/postgres/runtime-transport";
import { NATIVE_READONLY_RUNTIME_PROFILE } from "../../lib/db/postgres/runtime-profile";
import { createPostgresUserDomainTransport,type PostgresUserDomainTransport } from "../../lib/db/postgres/user-domain-transport";
import { createPostgresApplicationDomainTransport,type PostgresApplicationDomainTransport } from "../../lib/db/postgres/application-domain-transport";
import { nativeCurrentApplicationSource } from "./current-application-source.mts";
import { inspectApplicationTableParity } from "./application-table-parity.mts";
import { assembleNativePostgresBusinessCore } from "../../lib/db/supabase-adapter";
import { createPostgresReadDomainAuthority } from "../../lib/db/postgres/read-domain-authority";
import { nativeApplicationDomainsReferenceSource } from "./application-domains-source.mts";
import { createPostgresApplicationReadTransport,type PostgresApplicationReadTransport } from "../../lib/db/postgres/application-read-transport";
import { nativeApplicationFinancialReferenceSource } from "./application-reference-source.mts";

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
async function qualify(){
try {
  const image = docker(["image", "inspect", "postgres@sha256:d3244e8ce3f165ee3c93d9c4a4b1d0fe48b3a89e2287b717fdcbbde92d405065", "--format", "{{.Id}}"] ).trim();
  owned = true;
  docker(["run", "-d", "--name", name, "--user", "postgres", "--read-only", "--memory", "768m", "--cpus", "1", "--pids-limit", "64",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,uid=70,gid=70,size=256m",
    "--tmpfs", "/var/run/postgresql:rw,nosuid,uid=70,gid=70,size=8m", "--tmpfs", "/tmp:rw,nosuid,size=16m",
    "-p", "127.0.0.1::5432", "-e", `POSTGRES_PASSWORD=${password}`, image, "-c", "shared_buffers=32MB", "-c", "max_connections=12"]);
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
  const privateProfilesOnly=process.argv.includes("--private-profiles-only");
  const profileIdentitiesOnly=process.argv.includes("--profile-identities-only");
  const personalHistoryOnly=process.argv.includes("--personal-history-only");
  const nativeRuntimeOnly=process.argv.includes("--native-runtime-only");
  const nativeFactoryOnly=process.argv.includes("--native-factory-only");
  const originalJsonOnly=process.argv.includes("--original-json-only");
  const runClaimsOnly=process.argv.includes("--run-claims-only");
  const ownershipHistoryOnly=process.argv.includes("--ownership-history-only");
  const privacyOnly=process.argv.includes("--privacy-only");
  const workspacesOnly=process.argv.includes("--workspaces-only");
  const runtimeSourceReferenceOnly=process.argv.includes("--runtime-source-reference-only");
  const withNativeRuntime=process.argv.includes("--native-runtime")||nativeRuntimeOnly||nativeFactoryOnly||runtimeSourceReferenceOnly||originalJsonOnly||runClaimsOnly||ownershipHistoryOnly;
  const withPersonalHistory=process.argv.includes("--personal-history")||personalHistoryOnly||withNativeRuntime||privacyOnly||workspacesOnly;
  const withProfileIdentities=process.argv.includes("--profile-identities")||profileIdentitiesOnly||withPersonalHistory;
  const withPrivateProfiles=process.argv.includes("--private-profiles")||privateProfilesOnly||withProfileIdentities;
  const boundedReadsOnly=process.argv.includes("--bounded-reads-only");
  const withBoundedReads=process.argv.includes("--bounded-reads")||boundedReadsOnly||withPrivateProfiles;
  const operationalOnly=process.argv.includes("--operational-only");
  const withOperational=process.argv.includes("--operational")||operationalOnly||withBoundedReads;
  const authOnly=process.argv.includes("--auth-only");
  const withAuth=process.argv.includes("--auth")||authOnly||withOperational;
  const currentTables=process.argv.includes("--current-application-tables")||withAuth;
  const inventoryOnly=process.argv.includes("--inventory-only");
  const applicationDomainsOnly=process.argv.includes("--application-domains-only");
  const withApplicationDomains=process.argv.includes("--application-domains")||applicationDomainsOnly||inventoryOnly||currentTables;
  const catalogOnly=process.argv.includes("--catalog-only");
  const withApplicationReference = process.argv.includes("--application-financial-reference")||catalogOnly||withApplicationDomains;
  const withOwner = process.argv.includes("--owner-withdrawals") || withApplicationReference;
  const withHosted = process.argv.includes("--hosted-ledger") || withOwner;
  const withCreator = process.argv.includes("--creator") || withHosted;
  const withWithdrawals = process.argv.includes("--withdrawals") || withCreator;
  const withFunding = process.argv.includes("--funding") || withWithdrawals;
  const source = workspacesOnly ? nativeWorkspacesSource() : privacyOnly ? nativePrivacySource() : withNativeRuntime ? nativeRuntimeSource() : withPersonalHistory ? nativePersonalHistorySource() : withProfileIdentities ? nativeProfileIdentitiesSource() : withPrivateProfiles ? nativePrivateProfilesSource() : withBoundedReads ? nativeBoundedReadApplicationSource() : withOperational ? nativeOperationalApplicationSource() : withAuth ? nativeAuthApplicationSource() : currentTables ? nativeCurrentApplicationSource() : withApplicationDomains ? nativeApplicationDomainsReferenceSource() : withApplicationReference ? nativeApplicationFinancialReferenceSource() : withOwner ? nativeOwnerWithdrawalSource() : withHosted ? nativeHostedLedgerSource() : withCreator ? nativeCreatorWithdrawalDomainSource() : withWithdrawals ? nativeWithdrawalDomainSource() : withFunding ? nativeFundingDomainSource() : nativeConsentDomainSource();
  if(withApplicationReference)sql('postgres','CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;');
  for (const database of ["native_source", "native_target"] as const) {
    assert.equal(sql(database, "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public';"), "0");
    if(withApplicationReference)sql(database,`GRANT CREATE ON DATABASE ${database} TO keryx_owner;CREATE PUBLICATION supabase_realtime;ALTER PUBLICATION supabase_realtime OWNER TO keryx_owner;`);
    sql(database, "SET statement_timeout='30s'; GRANT CREATE ON SCHEMA public TO keryx_owner; BEGIN;\n" + source.sql + "\nCOMMIT;");
  }
  let catalogMeasurement:unknown;
  if(withApplicationReference){
    catalogMeasurement=JSON.parse(sql('native_source',`CREATE FUNCTION pg_temp.baseline_catalog() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $baseline$${nativePostgres17DescriptorBody()}$baseline$;
      CREATE FUNCTION pg_temp.measure_catalog() RETURNS jsonb LANGUAGE plpgsql AS $check$
      DECLARE baseline jsonb;observed jsonb;started timestamptz;b_ms numeric;n_ms numeric;
      BEGIN started:=clock_timestamp();baseline:=pg_temp.baseline_catalog();b_ms:=extract(epoch from clock_timestamp()-started)*1000;
        started:=clock_timestamp();observed:=keryx_storage.catalog_contract();n_ms:=extract(epoch from clock_timestamp()-started)*1000;
        IF baseline IS DISTINCT FROM observed THEN RAISE EXCEPTION 'native descriptor parity failed';END IF;
        RETURN jsonb_build_object('allDescriptorFieldsEqual',true,'baselineMs',b_ms,'nativeMs',n_ms,'metadataCached',false);
      END;$check$;SELECT pg_temp.measure_catalog();`));
  }
  const describe = "SET statement_timeout='5s'; SELECT keryx_storage.catalog_contract();";
  const reference = exportNativePostgresSchemaContract(sql("native_source", describe));
  const target = exportNativePostgresSchemaContract(sql("native_target", describe));
  if(target.sha256!==reference.sha256){
    const expected=JSON.parse(reference.canonicalJson),actual=JSON.parse(target.canonicalJson);
    for(const key of Object.keys(expected.sections))if(JSON.stringify(expected.sections[key])!==JSON.stringify(actual.sections[key]))
      console.error(JSON.stringify({syntheticCatalogMismatch:key,source:expected.sections[key],target:actual.sections[key]}));
  }
  assert.equal(target.sha256, reference.sha256, "Target must match a separately built SOURCE before its seal is inserted");
  // PG17.12's per-attribute WAL versions differ across the two fresh installs.
  // Both real schema options must still invalidate admission independently.
  const backendVersion=Number(sql('native_source','SHOW server_version_num;'));
  assert.equal(backendVersion,170012,'The reviewed native fixture engine is pinned');
  const sourceVersions=sql('native_source',"SELECT attoptions::text FROM pg_attribute WHERE attrelid='keryx_storage.identity'::regclass AND attname='identity';"),targetVersions=sql('native_target',"SELECT attoptions::text FROM pg_attribute WHERE attrelid='keryx_storage.identity'::regclass AND attname='identity';");
  assert.match(sourceVersions,/pg_attver=[0-9]+/);assert.notEqual(sourceVersions,targetVersions);
  for(const option of ['n_distinct','n_distinct_inherited']){
    sql('native_source',`ALTER TABLE keryx_storage.identity ALTER COLUMN identity SET (${option}=0.5);`);
    assert.notEqual(exportNativePostgresSchemaContract(sql('native_source',describe)).sha256,reference.sha256,'Real column options must remain in the contract');
    sql('native_source',`ALTER TABLE keryx_storage.identity ALTER COLUMN identity RESET (${option});`);
    assert.equal(exportNativePostgresSchemaContract(sql('native_source',describe)).sha256,reference.sha256);
  }
  if(withNativeRuntime){
    assert.equal(sql('native_source',`SELECT encode(sha256(convert_to((${literal(JSON.parse(reference.canonicalJson))})::text,'UTF8')),'hex');`),reference.sha256,'Independent SOURCE wire digest must match the native constraint');
    assert.throws(()=>sql('native_source',"INSERT INTO keryx_storage.source_contract VALUES(true,'{}'::jsonb,'"+'00'.repeat(32)+"');"),/source_contract_digest/);
    assert.equal(sql('native_source','SELECT count(*) FROM keryx_storage.source_contract;'),'0');
    if(runtimeSourceReferenceOnly){console.log(JSON.stringify({sourceReferenceOnly:true,sourceSqlSha256:source.sha256,referenceCatalogSha256:reference.sha256,normalizedDescriptorSha256:reference.normalizedSha256,digestFormat:reference.digestFormat,nativeMetadataDigestBound:true,independentSourceTargetEqual:true,runtimeQualified:false,applicationBackendSwitched:false}));return;}
    assert.equal(source.sha256,NATIVE_READONLY_RUNTIME_PROFILE.sourceSqlSha256,'Runtime profile must be pinned to the separately reviewed SOURCE');
    assert.equal(reference.sha256,NATIVE_READONLY_RUNTIME_PROFILE.catalogSha256,'An unknown SOURCE catalog cannot self-allocate runtime approval');
    assert.equal(reference.digestFormat,NATIVE_READONLY_RUNTIME_PROFILE.digestFormat);
  }
  let currentTableConstraints:unknown;
  if(currentTables){
    const inventory=inspectApplicationTableParity(reference.canonicalJson);
    assert.equal(inventory.sqliteTables,93);assert.equal(inventory.sqliteColumns,601);assert.deepEqual(inventory.missingTables,[]);
    assert.deepEqual(inventory.missingColumns.map(t=>({name:t.name,columns:t.columns.map(c=>c.name)})),[
      {name:'browser_journal_writer',columns:['id']},{name:'browser_signing_v2_writer',columns:['id']},{name:'browser_signing_v3_writer',columns:['id']}]);
    assert.equal(sql('native_target','SELECT (SELECT count(*) FROM public.browser_journal_writer)+(SELECT count(*) FROM public.browser_signing_v2_writer)+(SELECT count(*) FROM public.browser_signing_v3_writer);'),'0');
    currentTableConstraints=qualifyCurrentTableConstraints(statement=>sql('native_target',statement));
  }
  if(inventoryOnly){console.log(JSON.stringify({passed:true,sourceSha256:source.sha256,referenceContract:reference.sha256,currentTableConstraints,schemaInventory:inspectApplicationTableParity(reference.canonicalJson)}));return;}
  if(withApplicationReference){
    // Raw source is below its bound, but JSON escaping makes one descriptor
    // exceed its separate field bound. Refuse before the final aggregation.
    const body="SELECT '"+'\\'.repeat(70000)+"'::text";
    sql('native_source',`SET ROLE keryx_owner;CREATE FUNCTION public.metadata_bound_probe() RETURNS text LANGUAGE sql AS '${body.replaceAll("'","''")}';RESET ROLE;`);
    assert.throws(()=>sql('native_source',describe),/schema contract metadata bound/);
    sql('native_source','SET ROLE keryx_owner;DROP FUNCTION public.metadata_bound_probe();RESET ROLE;');
    assert.equal(exportNativePostgresSchemaContract(sql('native_source',describe)).sha256,reference.sha256);
    assert.equal(sql('native_target',"SELECT count(*) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND left(p.proname,8)<>'storage_' AND (has_function_privilege('keryx_app',p.oid,'EXECUTE') OR has_function_privilege('keryx_reader',p.oid,'EXECUTE'));"),'0');
    assert.equal(sql('native_target',"SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped AND (has_column_privilege('keryx_app',c.oid,a.attnum,'SELECT') OR has_column_privilege('keryx_reader',c.oid,a.attnum,'SELECT'));"),'0');
  }
  if(catalogOnly){console.log(JSON.stringify({passed:true,catalogOnly:true,image,sourceSha256:source.sha256,referenceContract:reference.sha256,catalogMeasurement,metadataBoundRefused:true,legacyRpcAndColumnReadsRefused:true,applicationBackendSwitched:false}));return;}

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
  const createTransport = withNativeRuntime ? createPostgresRuntimeTransport : withPrivateProfiles ? createPostgresUserDomainTransport : withAuth ? createPostgresApplicationDomainTransport : withApplicationDomains ? createPostgresApplicationReadTransport : withOwner ? createPostgresOwnerWithdrawalTransport : withHosted ? createPostgresHostedLedgerTransport : withCreator ? createPostgresCreatorWithdrawalTransport : withWithdrawals ? createPostgresWithdrawalTransport : withFunding ? createPostgresSessionTransport : createPostgresConsentTransport;
  const nativeTransport = createTransport({ endpoint: { kind: "loopback", port }, database: "native_target", role: "keryx_app", password }, identity, reference.sha256);
  transports.push(nativeTransport);
  if(withApplicationDomains){
    const read=(nativeTransport as PostgresApplicationReadTransport).applicationRead;
    assert.deepEqual(await read('list_all_sources',{}),[]);
    assert.deepEqual(await read('list_sources',{p_active:true}),[]);
    assert.equal(await read('get_user',{p_wallet_address:owner}),null);
    assert.equal(await read('get_sync_state',{p_key:'synthetic-missing'}),null);
    await assert.rejects(read('get_user',{p_wallet_address:owner,unexpected:true}));
    await assert.rejects(app.query('SELECT public.storage_application_list_all_sources($1::jsonb,$2::text,$3::jsonb)',[canonicalJson(identity),reference.sha256,'{}']));
    sql('native_target',`INSERT INTO public.sources(id,name,wallet_address) VALUES('synthetic-domain-source','Synthetic native domain','${owner}');`);
    const sources=await read('list_all_sources',{});assert(Array.isArray(sources)&&sources.length===1&&sources[0].id==='synthetic-domain-source');
    await assert.rejects(app.query('SELECT public.storage_list_all_sources($1::jsonb)',[canonicalJson(identity)]));
    const business=assembleNativePostgresBusinessCore({identity,authority:createPostgresReadDomainAuthority(nativeTransport as PostgresApplicationReadTransport),
      assertEntry:()=>{},verify:async()=>{await read('get_sync_state',{p_key:'synthetic-authority-read'});}});
    await business.adapter.init();
    try{
      const decoded=await business.adapter.listAllSources();assert.equal(decoded.length,1);assert.equal(decoded[0].id,'synthetic-domain-source');
      assert.equal((await business.adapter.getSource('synthetic-domain-source'))?.name,'Synthetic native domain');
      assert.equal(await business.adapter.getUser(owner),null);assert.equal(await business.adapter.getSyncState('synthetic-missing'),null);
      assert.deepEqual(await business.adapter.getItems('synthetic-domain-source'),[]);
    }finally{business.hooks.close();}
    await assert.rejects(business.adapter.listAllSources());

    await assert.rejects(app.query('SELECT public.storage_set_sync_state($1::jsonb,$2::jsonb)',[canonicalJson(identity),JSON.stringify({key:'unsafe',value:'x'})]));
    if(applicationDomainsOnly){console.log(JSON.stringify({passed:true,applicationDomainsOnly:true,image,sourceSha256:source.sha256,referenceContract:reference.sha256,catalogMeasurement,guardedNativeReads:true,sharedBusinessDecoders:true,actualReadOnlyTransaction:true,legacyReadAndWritesRefused:true,applicationBackendSwitched:false}));return;}
  }

  if(workspacesOnly){
    const workspaces=await qualifyWorkspaces({options:{endpoint:{kind:'loopback',port},database:'native_target',role:'keryx_app',password},identity,digest:reference.sha256,ownerSql:statement=>sql('native_target',statement)});
    console.log(JSON.stringify({passed:true,workspacesOnly:true,sourceSha256:source.sha256,referenceContract:reference.sha256,workspaces,runtimeQualified:false,applicationBackendSwitched:false}));return;
  }
  if(nativeFactoryOnly){
    const nativeRuntime=await qualifyNativeRuntime({postgresContainer:name,password,identity,digest:reference.sha256,ownerSql:statement=>sql('native_target',statement)});
    console.log(JSON.stringify({passed:true,nativeFactoryOnly:true,image,sourceSha256:source.sha256,referenceContract:reference.sha256,nativeRuntime,applicationBackendSwitched:false}));return;
  }
  if(privacyOnly){
    const privacy=await qualifyPrivacy({options:{endpoint:{kind:'loopback',port},database:'native_target',role:'keryx_app',password},identity,digest:reference.sha256,ownerSql:statement=>sql('native_target',statement)});
    console.log(JSON.stringify({passed:true,privacyOnly:true,sourceSha256:source.sha256,referenceContract:reference.sha256,privacy,runtimeQualified:false,applicationBackendSwitched:false}));return;
  }
  const ownershipHistory=withNativeRuntime?await qualifyOwnershipHistory({options:{endpoint:{kind:'loopback',port},database:'native_target',role:'keryx_app',password},identity,digest:reference.sha256,ownerSql:statement=>sql('native_target',statement)}):undefined;
  if(ownershipHistoryOnly){console.log(JSON.stringify({passed:true,ownershipHistoryOnly:true,sourceSha256:source.sha256,referenceContract:reference.sha256,ownershipHistory,runtimeQualified:false,applicationBackendSwitched:false}));return;}
  const runClaims=withNativeRuntime?await qualifyRunClaims({transport:nativeTransport as PostgresUserDomainTransport,options:{endpoint:{kind:'loopback',port},database:'native_target',role:'keryx_app',password},identity,digest:reference.sha256,ownerSql:statement=>sql('native_target',statement)}):undefined;
  if(runClaimsOnly){console.log(JSON.stringify({passed:true,runClaimsOnly:true,sourceSha256:source.sha256,referenceContract:reference.sha256,runClaims,runtimeQualified:false,applicationBackendSwitched:false}));return;}
  const originalJson=withNativeRuntime?await qualifyOriginalJson({transport:nativeTransport as PostgresUserDomainTransport,network:identity.network,ownerSql:statement=>sql('native_target',statement)}):undefined;
  if(originalJsonOnly){console.log(JSON.stringify({passed:true,originalJsonOnly:true,sourceSha256:source.sha256,referenceContract:reference.sha256,originalJson,runtimeQualified:false,applicationBackendSwitched:false}));return;}
  const privacy=withNativeRuntime?await qualifyPrivacy({options:{endpoint:{kind:'loopback',port},database:'native_target',role:'keryx_app',password},identity,digest:reference.sha256,ownerSql:statement=>sql('native_target',statement)}):undefined;
  const workspaces=withNativeRuntime?await qualifyWorkspaces({options:{endpoint:{kind:'loopback',port},database:'native_target',role:'keryx_app',password},identity,digest:reference.sha256,ownerSql:statement=>sql('native_target',statement)}):undefined;
  const nativeRuntime=withNativeRuntime?await qualifyNativeRuntime({postgresContainer:name,password,identity,digest:reference.sha256,ownerSql:statement=>sql('native_target',statement)}):undefined;
  if(nativeRuntimeOnly){console.log(JSON.stringify({passed:true,nativeRuntimeOnly:true,image,sourceSha256:source.sha256,referenceContract:reference.sha256,originalJson,privacy,workspaces,nativeRuntime,applicationBackendSwitched:false}));return;}
  const personalHistory=withPersonalHistory?await qualifyPersonalHistory({transport:nativeTransport as PostgresUserDomainTransport,options:{endpoint:{kind:'loopback',port},database:'native_target',role:'keryx_app',password},identity,digest:reference.sha256,ownerSql:statement=>sql('native_target',statement),originalProjection:withNativeRuntime}):undefined;
  if(personalHistoryOnly){console.log(JSON.stringify({passed:true,personalHistoryOnly:true,image,sourceSha256:source.sha256,referenceContract:reference.sha256,personalHistory,applicationBackendSwitched:false}));return;}
  const profileIdentities=withProfileIdentities?await qualifyProfileIdentities({transport:nativeTransport as PostgresUserDomainTransport,options:{endpoint:{kind:'loopback',port},database:'native_target',role:'keryx_app',password},identity,digest:reference.sha256,ownerSql:statement=>sql('native_target',statement)}):undefined;
  if(profileIdentitiesOnly){console.log(JSON.stringify({passed:true,profileIdentitiesOnly:true,image,sourceSha256:source.sha256,referenceContract:reference.sha256,profileIdentities,applicationBackendSwitched:false}));return;}
  const privateProfiles=withPrivateProfiles?await qualifyPrivateProfiles({transport:nativeTransport as PostgresUserDomainTransport,options:{endpoint:{kind:'loopback',port},database:'native_target',role:'keryx_app',password},identity,digest:reference.sha256,ownerSql:statement=>sql('native_target',statement)}):undefined;
  if(privateProfilesOnly){console.log(JSON.stringify({passed:true,privateProfilesOnly:true,image,sourceSha256:source.sha256,referenceContract:reference.sha256,privateProfiles,applicationBackendSwitched:false}));return;}
  const dashboard=withBoundedReads?await qualifyDashboardMetrics({transport:nativeTransport as PostgresApplicationDomainTransport,identity,ownerSql:statement=>sql('native_target',statement)}):undefined;
  const boundedReads=withBoundedReads?await qualifyBoundedReads({transport:nativeTransport as PostgresApplicationReadTransport,ownerSql:statement=>sql('native_target',statement)}):undefined;
  if(boundedReadsOnly){console.log(JSON.stringify({passed:true,boundedReadsOnly:true,image,sourceSha256:source.sha256,referenceContract:reference.sha256,boundedReads,dashboard,applicationBackendSwitched:false}));return;}
  const auth=withAuth?await qualifyAuthDomains({contentionClient:app,transport:nativeTransport as PostgresApplicationDomainTransport,options:{endpoint:{kind:'loopback',port},database:'native_target',role:'keryx_app',password},identity,digest:reference.sha256,ownerSql:statement=>sql('native_target',statement)}):undefined;
  if(authOnly){console.log(JSON.stringify({passed:true,authOnly:true,image,sourceSha256:source.sha256,referenceContract:reference.sha256,auth,currentTableConstraints,applicationBackendSwitched:false}));return;}
  const operational=withOperational?await qualifyOperationalDomains({transport:nativeTransport as PostgresApplicationDomainTransport,options:{endpoint:{kind:'loopback',port},database:'native_target',role:'keryx_app',password},identity,digest:reference.sha256,ownerSql:statement=>sql('native_target',statement)}):undefined;
  if(operationalOnly){console.log(JSON.stringify({passed:true,operationalOnly:true,image,sourceSha256:source.sha256,referenceContract:reference.sha256,auth,operational,currentTableConstraints,applicationBackendSwitched:false}));return;}
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
  assert.equal(sql("native_target", `SELECT spent=0.000007 FROM public.session_grants WHERE session_id='${owner}';`), "t");
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
    INSERT INTO public.creator_withdrawal_requests(id,owner,data) VALUES('0x${"99".repeat(32)}','${ownerWithdrawal.sessAddr}','{}');
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
    ownerSql: statement => sql("native_target", statement),applicationTableReference:withApplicationReference }) : undefined;
  const withdrawals = withWithdrawals ? await qualifySessionWithdrawals({ transport: nativeTransport as PostgresWithdrawalTransport,
    options: { endpoint: { kind: "loopback", port }, database: "native_target", role: "keryx_app", password }, identity, digest: reference.sha256,
    ownerSql: statement => sql("native_target", statement), ...(withCreator ? { creatorTransport: nativeTransport as PostgresCreatorWithdrawalTransport } : {}) }) : undefined;
  const creator = withCreator ? await qualifyCreatorWithdrawals({ transport: nativeTransport as PostgresCreatorWithdrawalTransport,
    options: { endpoint: { kind: "loopback", port }, database: "native_target", role: "keryx_app", password }, identity, digest: reference.sha256,
    ownerSql: statement => sql("native_target", statement) }) : undefined;
  const hostedLedger = withHosted ? await qualifyHostedLedger({ transport: nativeTransport as PostgresHostedLedgerTransport,
    options: { endpoint: { kind: "loopback", port }, database: "native_target", role: "keryx_app", password }, identity, digest: reference.sha256,
    ownerSql: statement => sql("native_target", statement),applicationTableReference:withApplicationReference }) : undefined;
  const ownerWithdrawals = withOwner ? await qualifyOwnerWithdrawals({ transport: nativeTransport as PostgresOwnerWithdrawalTransport,
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
    ...(hostedLedger ? { hostedLedger } : {}),
    ...(ownerWithdrawals ? { ownerWithdrawals } : {}),
    ...(withApplicationReference?{applicationFinancialReference:true,catalogMeasurement,completeApplicationAdmitted:false}:{}),
    ...(currentTables?{currentTableConstraints}:{}),
    ...(auth?{auth}:{}),
    ...(operational?{operational}:{}),
    ...(boundedReads?{boundedReads,dashboard}:{}),
    ...(privateProfiles?{privateProfiles}:{}),
    ...(profileIdentities?{profileIdentities}:{}),
    ...(personalHistory?{personalHistory}:{}),
    ...(nativeRuntime?{nativeRuntime}:{}),
    ...(privacy?{privacy}:{}),
    ...(workspaces?{workspaces}:{}),
    ...(originalJson?{originalJson}:{}),
    ...(runClaims?{runClaims}:{}),
    ...(ownershipHistory?{ownershipHistory}:{}),
    paidOperations: 0, productionDataRead: false, applicationBackendSwitched: false,
    limitations: "Native consent/funding and explicitly selected withdrawal protocols only. Remaining financial protocols, full application/profile parity and production cutover are not admitted." }));
} catch(error) {
  if(owned){try{const logs=spawnSync('docker',['logs','--tail','80',name],{encoding:'utf8',timeout:5000,maxBuffer:131072,windowsHide:true});
    const messages=(String(logs.stdout)+String(logs.stderr)).split(/\r?\n/).filter(line=>line.includes(' ERROR: ')).slice(-4).map(line=>line.slice(line.indexOf(' ERROR: ')+8, line.indexOf(' ERROR: ')+248));
    console.error(JSON.stringify({syntheticNativeFixtureErrors:messages}));}catch{}}
  throw error;
} finally {
  await ackProxy?.close();
  await Promise.allSettled(transports.map(transport => transport.close()));
  await Promise.allSettled(clients.map(client => client.end()));
  if (owned) {
    assert.match(name, /^keryx-postgres-consents-[0-9a-f-]{36}$/);
    docker(["rm", "-f", name]); assert.equal(docker(["ps", "-aq", "--filter", `name=^/${name}$`]).trim(), ""); owned = false;
  }
}

}
await qualify();
