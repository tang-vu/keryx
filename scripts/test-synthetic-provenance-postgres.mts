/** Hermetic actual-migration acceptance. Owned disposable PostgreSQL; no app env or provider IO. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { SEED_SOURCES } from "../lib/sources/seed-data.ts";
import { contentBodyHash } from "../lib/sources/content-receipt.ts";

const name = `keryx-demo-provenance-${randomUUID()}`;
const docker = (args: string[], input?: string, timeout = 30_000) => execFileSync("docker", args, { input, encoding: "utf8", timeout,
  maxBuffer: 16 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
const sql = (statement: string, timeout?: number) => docker(["exec", "-i", name, "psql", "-h", "127.0.0.1", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"], statement, timeout);
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
let created = false;
try {
  docker(["info", "--format", "{{.ServerVersion}}"]);
  created = true;
  docker(["run", "-d", "--name", name, "--network", "none", "--memory", "512m", "--cpus", "1", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine"]);
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      // The image's temporary initialization server listens only on a Unix socket.
      // Require the final TCP server, then prove the same transport can execute SQL.
      docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-t", "1"], undefined, 3_000);
      assert.equal(sql("select 1;", 3_000).trim(), "1");
      break;
    } catch (cause) {
      if (Date.now() >= deadline) throw new Error("Owned PostgreSQL final TCP startup timed out", { cause });
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  const migrations = readdirSync("supabase/migrations").filter(file => /^\d{4}.*\.sql$/.test(file) && Number(file.slice(0, 4)) <= 79).sort();
  sql("create role anon; create role authenticated; create role service_role bypassrls; create publication supabase_realtime;\n" +
    migrations.filter(file => Number(file.slice(0, 4)) < 79).map(file => readFileSync(`supabase/migrations/${file}`, "utf8")).join("\n"));
  const seed = SEED_SOURCES.flatMap(source => source.items ?? []).find(item => item.title === "Measuring x402 settlement latency on Arc")!;
  sql(`insert into public.sources(id,name,wallet_address,fetch_price) values ('matching','Unrelated name','0xfixture',0.003),('mixed','Mixed','0xfixture',0.003),('near','Arc Settlement Benchmarks','0xfixture',0.003);
    insert into public.source_items(id,source_id,title,summary,link,content,body_hash,storage_mode,item_key_enc) values
      ('encrypted','matching',${literal(seed.title)},${literal(seed.summary)},${literal(seed.link)},'retained ciphertext',${literal(contentBodyHash(seed.content))},'db_encrypted','retained envelope'),
      ('mixed-demo','mixed',${literal(seed.title)},${literal(seed.summary)},${literal(seed.link)},${literal(seed.content)},null,'db_plaintext',null),
      ('mixed-real','mixed','Original research','Observed evidence','https://real.test','Real body',null,'db_plaintext',null),
      ('near','near',${literal(seed.title)},${literal(seed.summary)},${literal(seed.link)},'Different body',null,'db_plaintext',null);
    insert into public.payment_events(id,kind,query_id,source_id,amount_usdc,tx_hash,network,settled,settlement_status) values
      ('retained-payment','fetch','retained-dispatch','matching',0.003,'real-retained-circle-transfer','eip155:5042002',true,'settled');`);
  const retained = sql("select row_to_json(p) from public.payment_events p where id='retained-payment'").trim();
  sql(readFileSync("supabase/migrations/0079_synthetic_evidence_provenance.sql", "utf8"));
  assert.equal(sql("select evidence_provenance from public.sources where id='matching'").trim(), "synthetic-demo");
  assert.equal(sql("select count(*) from public.sources where id in ('mixed','near') and evidence_provenance is null").trim(), "2");
  assert.equal(sql("select count(*) from public.source_items where id in ('encrypted','mixed-demo') and evidence_provenance='synthetic-demo'").trim(), "2");
  assert.equal(sql("select content||':'||item_key_enc from public.source_items where id='encrypted'").trim(), "retained ciphertext:retained envelope");
  sql("update public.sources set evidence_provenance=null where id='matching'; update public.source_items set evidence_provenance=null where id='encrypted'; insert into public.source_items(id,source_id,title) values('inherited','matching','New demo item');");
  assert.equal(sql("select count(*) from public.source_items where id in ('encrypted','inherited') and evidence_provenance='synthetic-demo'").trim(), "2");
  assert.equal(sql("select evidence_provenance from public.sources where id='matching'").trim(), "synthetic-demo");
  assert.equal(sql("select row_to_json(p) from public.payment_events p where id='retained-payment'").trim(), retained);
  assert.equal(sql("select has_function_privilege('anon','public.storage_read_evidence_provenance(jsonb,text[],text[])','execute')").trim(), "f");
  assert.equal(sql("select has_function_privilege('authenticated','public.preserve_evidence_provenance()','execute')").trim(), "f");
  assert.throws(() => sql("set role service_role; select public.storage_read_evidence_provenance('{}'::jsonb,array['matching'],array['encrypted']);"), /invalid_identity|storage identity refused/);
  assert.throws(() => sql("set role service_role; select public.storage_read_evidence_provenance('{}'::jsonb,array_fill('x'::text,array[501]),array[]::text[]);"), /bounded provenance identities/);
  assert.throws(() => sql("select public.storage_upsert_source('{}'::jsonb,'{\"id\":\"refused\",\"evidence_provenance\":\"synthetic-demo\"}'::jsonb);"), /storage identity refused/);
  sql("insert into public.sources(id,name,wallet_address,rss_url,url,fetch_price,active,verified,authors) values('cas','Current metadata','0x1111111111111111111111111111111111111111','https://feed.test/rss','https://feed.test',0.019,false,false,'[]'::jsonb);");
  assert.equal(sql("set role service_role; select public.verify_source_if_unchanged('cas','0x1111111111111111111111111111111111111111','https://feed.test/rss'); reset role;").trim(), "t");
  assert.equal(sql("select verified::text||':'||fetch_price::text||':'||active::text from public.sources where id='cas'").trim(), "true:0.019:false");
  sql("update public.sources set verified=false,rss_url='https://changed.test/rss' where id='cas';");
  assert.equal(sql("select public.verify_source_if_unchanged('cas','0x1111111111111111111111111111111111111111','https://feed.test/rss')").trim(), "f");
  assert.equal(sql("select public.verify_source_if_unchanged('cas','0x2222222222222222222222222222222222222222','https://changed.test/rss')").trim(), "f");
  assert.equal(sql("select public.verify_source_if_unchanged('deleted','0x1111111111111111111111111111111111111111','https://feed.test/rss')").trim(), "f");
  assert.equal(sql("select has_function_privilege('anon','public.verify_source_if_unchanged(text,text,text)','execute')").trim(), "f");
  assert.throws(() => sql("select public.storage_verify_source_if_unchanged('{}'::jsonb,'cas','0x1111111111111111111111111111111111111111','https://changed.test/rss');"), /storage identity refused/);
  console.log("PASS PostgreSQL17 actual migrations: encrypted/plaintext corpus backfill, near-match refusal, mixed source exclusion, sticky/inherited trusted provenance, unchanged custody and real settled record, bounded metadata-only RPC and unchanged identity/permission fences.");
} catch (error) {
  if (created) {
    const logs = spawnSync("docker", ["logs", "--tail", "100", name], { encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024 });
    console.error("Owned disposable PostgreSQL diagnostics:\n", logs.stdout ?? "", logs.stderr ?? "", logs.error?.message ?? "");
  }
  throw error;
} finally {
  if (created) { docker(["rm", "-f", name]); assert.equal(docker(["ps", "-a", "--filter", `name=^/${name}$`, "--format", "{{.Names}}"] ).trim(), ""); }
}
