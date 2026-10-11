import assert from "node:assert/strict";

type FixtureSql = (statement: string, database: string) => string;

const window = Object.freeze({ network: "eip155:5042002", period: "custom",
  since: "2026-10-01T00:00:00.000Z", until: "2026-10-02T00:00:00.000Z" });
const originalDigestSql = `select encode(sha256(convert_to(jsonb_build_array(
  (select jsonb_agg(to_jsonb(q) order by id) from public.query_runs q),
  (select jsonb_agg(to_jsonb(p) order by id) from public.payment_events p))::text,'UTF8')),'hex');`;

/** Observations for the explicitly owned ordinary browser PG17 fixture only.
 * This does not open a database, grant authority, install a migration or enroll native storage. */
export function observeBrowserPublicUsage(sql: FixtureSql, database: string) {
  const query = (statement: string) => sql(statement, database);
  const rpc = (role = "service_role") => query(`begin read only; set local role ${role};
    select public.public_usage_window_v1('${JSON.stringify(window)}'::jsonb); commit;`);
  // Seed as the fixture administrator, never through the read-only observation port.
  query(`insert into public.query_runs(id,created_at,question,budget,engine,data) values
    ('browser-usage-in-window','2026-10-01T00:00:00.000Z','Synthetic question never returned',0,'heuristic',
      '{"answer":"Synthetic answer never returned"}'::jsonb),
    ('browser-usage-at-upper-bound','2026-10-02T00:00:00.000Z','Synthetic question never returned',0,'heuristic',
      '{"answer":"Synthetic answer never returned"}'::jsonb);`);
  const originals = () => query(originalDigestSql);
  const before = originals(); assert.match(before, /^[a-f0-9]{64}$/);
  assert.deepEqual(JSON.parse(rpc()), { complete: true, window,
    runs: [{ id: "browser-usage-in-window", createdAt: window.since,
      usage: null, provenance: null, actorId: null }], payments: [] });
  assert.equal(originals(), before, "Ordinary usage observation must not mutate original rows");
  const refusedRoles = () => {
    for (const role of ["anon", "authenticated"]) assert.throws(() => rpc(role), /permission denied/);
  };
  refusedRoles();
  assert.equal(query(`select exists(select 1 from pg_proc p,
    lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid='public.public_usage_window_v1(jsonb)'::regprocedure
      and a.grantee=0 and a.privilege_type='EXECUTE');`), "f", "No PUBLIC usage RPC authority");
  // Installing a later native identity must close the existing ordinary port,
  // not let SECURITY DEFINER read sealed originals or fall back to another reader.
  for (const marker of ["public.keryx_storage_identity", "keryx_storage.identity"]) {
    const schemaMarker = marker.startsWith("keryx_storage.");
    if (schemaMarker) query("create schema keryx_storage;");
    query(`create table ${marker}(synthetic_marker text);`);
    try {
      assert.throws(() => rpc(), /usage_unavailable/);
      refusedRoles();
      assert.equal(originals(), before, "Native refusal must preserve original rows");
    } finally {
      query(`drop table ${marker};`);
      if (schemaMarker) query("drop schema keryx_storage;");
    }
  }
  assert.equal(originals(), before, "Fixture identity checks must preserve original rows");
}
