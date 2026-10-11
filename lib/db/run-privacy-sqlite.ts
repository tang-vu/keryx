import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { assertOrdinarySqliteResearchAuthority, initializeSqliteResearchMonthly } from "./research-monthly";
import { sqliteSchemaMatches, type SqliteSchemaExpectation } from "./sqlite-schema-match";
import { erasedRun, PrivacyError, privacyId, privacyMutation, privacySession, privacyWallet, validatePrivacyRun, visibilitySchema,
  type PrivacyActor, type PrivacyState, type RunPrivacyStore } from "../run-privacy/contracts";
import type { RunOwnershipHistoryStore } from "../run-claims/history";
import { runClaimBindingSchema } from "../run-claims/contracts";
import { MAX_USAGE_RUNS } from "../usage/contracts";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";

/** SOURCE ONLY. Install explicitly in an isolated fixture or after a separately approved rollout.
 * No historical backfill: a missing sidecar means unlisted. New INSERTs capture defaults. */
export const RUN_PRIVACY_SQL = `
CREATE TABLE run_privacy (
  run_id TEXT PRIMARY KEY, visibility TEXT NOT NULL CHECK(visibility IN ('private','unlisted','public')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0), erased INTEGER NOT NULL DEFAULT 0 CHECK(erased IN (0,1)),
  retained_owner TEXT, retained_digest TEXT, retained_binding TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE run_privacy_defaults (wallet TEXT PRIMARY KEY, visibility TEXT NOT NULL CHECK(visibility IN ('private','unlisted','public')));
CREATE TABLE run_privacy_audit (
  request_id TEXT PRIMARY KEY, wallet TEXT NOT NULL, run_id TEXT NOT NULL, action TEXT NOT NULL,
  input TEXT NOT NULL, result TEXT NOT NULL, original_digest TEXT, created_at TEXT NOT NULL
);
CREATE TRIGGER run_privacy_new AFTER INSERT ON query_runs BEGIN
  INSERT INTO run_privacy(run_id,visibility,updated_at) SELECT new.id,
    CASE WHEN new.asker GLOB '0x*' AND length(new.asker)=42 AND substr(new.asker,3) NOT GLOB '*[^0-9a-f]*'
      THEN coalesce((SELECT visibility FROM run_privacy_defaults WHERE wallet=new.asker),'private') ELSE 'unlisted' END,new.created_at
    WHERE NOT EXISTS(SELECT 1 FROM run_privacy WHERE run_id=new.id);
END;
CREATE TRIGGER run_privacy_no_resurrection_insert BEFORE INSERT ON query_runs
WHEN EXISTS(SELECT 1 FROM run_privacy WHERE run_id=new.id AND erased=1)
BEGIN SELECT RAISE(ABORT,'privacy_erased'); END;
CREATE TRIGGER run_privacy_keep_historical BEFORE INSERT ON query_runs
WHEN EXISTS(SELECT 1 FROM query_runs WHERE id=new.id)
BEGIN INSERT INTO run_privacy(run_id,visibility,updated_at) SELECT new.id,'unlisted',new.created_at
  WHERE NOT EXISTS(SELECT 1 FROM run_privacy WHERE run_id=new.id); END;
CREATE TRIGGER run_privacy_no_resurrection_update BEFORE UPDATE ON query_runs
WHEN EXISTS(SELECT 1 FROM run_privacy WHERE run_id=old.id AND erased=1)
BEGIN SELECT RAISE(ABORT,'privacy_erased'); END;
CREATE TRIGGER run_privacy_keep_tombstone BEFORE DELETE ON run_privacy
BEGIN SELECT RAISE(ABORT,'privacy_retained'); END;
CREATE TRIGGER run_privacy_keep_erasure BEFORE UPDATE ON run_privacy WHEN old.erased=1
BEGIN SELECT RAISE(ABORT,'privacy_erased'); END;
CREATE TRIGGER run_privacy_audit_no_update BEFORE UPDATE ON run_privacy_audit
BEGIN SELECT RAISE(ABORT,'privacy_retained'); END;
CREATE TRIGGER run_privacy_audit_no_delete BEFORE DELETE ON run_privacy_audit
BEGIN SELECT RAISE(ABORT,'privacy_retained'); END;
CREATE TRIGGER run_privacy_memory_no_resurrection BEFORE INSERT ON query_memories
WHEN EXISTS(SELECT 1 FROM run_privacy WHERE run_id=new.id AND erased=1)
BEGIN SELECT RAISE(ABORT,'privacy_erased'); END;
CREATE TRIGGER run_privacy_memory_no_resurrection_update BEFORE UPDATE ON query_memories
WHEN EXISTS(SELECT 1 FROM run_privacy WHERE run_id=new.id AND erased=1)
BEGIN SELECT RAISE(ABORT,'privacy_erased'); END;
`;
let expectations: SqliteSchemaExpectation[][] | undefined;
export function assertRunPrivacySchema(db: DatabaseSync) {
  assertOrdinarySqliteResearchAuthority(db);
  if (!expectations) {
    const reference = new DatabaseSync(":memory:");
    try {
      // Only source-known ordinary relations are admitted, including the existing
      // hash-only SIWE session definition. No caller schema becomes authority.
      installSqliteApplicationSchema(reference); reference.exec(RUN_PRIVACY_SQL);
      const sourceShape=()=>reference.prepare(`SELECT name,type,sql FROM sqlite_schema WHERE sql IS NOT NULL AND
        (name LIKE 'run_privacy%' OR name IN ('query_runs','query_memories','web_sessions','a2a_orders','gap_intents','payment_events')
          OR type='trigger' AND tbl_name IN ('query_runs','query_memories','web_sessions','a2a_orders','gap_intents','payment_events'))`).all()
        .map(row => [String(row.name), row.type as "table" | "trigger", String(row.sql)] as SqliteSchemaExpectation);
      expectations=[sourceShape()];
      // The existing ordinary initializer adds one authorization trigger on
      // a2a_orders. Admit that exact compiled variant, never observed target DDL.
      initializeSqliteResearchMonthly(reference); expectations.push(sourceShape());
    } finally { reference.close(); }
  }
  const actualTriggers=Number(db.prepare(`SELECT count(*) n FROM sqlite_schema WHERE type='trigger'
    AND (tbl_name IN ('query_runs','query_memories','web_sessions','a2a_orders','gap_intents','payment_events','run_privacy','run_privacy_defaults','run_privacy_audit') OR name LIKE 'run_privacy%')`).get()?.n);
  if(!expectations.some(shape=>actualTriggers===shape.filter(value=>value[1]==="trigger").length && sqliteSchemaMatches(db,shape)))
    throw new PrivacyError("privacy_unavailable");
}
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const stateOf = (row: Record<string, unknown>): PrivacyState => ({ visibility: visibilitySchema.parse(row.visibility ?? "unlisted"),
  revision: z.number().int().min(0).parse(row.revision ?? 0), erased: row.erased === 1 });

/** No schema installation, environment loading, owner inference or financial writes. */
export function createSqliteRunPrivacy(db: DatabaseSync, claims?: RunOwnershipHistoryStore): RunPrivacyStore {
  assertRunPrivacySchema(db);
  const guard = () => assertRunPrivacySchema(db);
  const row = (id: string) => db.prepare(`SELECT q.data,q.asker,p.visibility,p.revision,p.erased,p.retained_owner,p.retained_digest,p.retained_binding
    FROM query_runs q LEFT JOIN run_privacy p ON p.run_id=q.id WHERE q.id=?`).get(privacyId.parse(id));
  function transaction<T>(action: () => T): T {
    guard(); db.exec("BEGIN IMMEDIATE");
    try { guard(); const value = action(); db.exec("COMMIT"); return value; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  function actor(raw: PrivacyActor, write = false) {
    const value = { wallet: privacyWallet.parse(raw.wallet), binding: runClaimBindingSchema.parse(raw.binding), sessionHash: raw.sessionHash };
    if (write) {
      const session = privacySession.parse(value.sessionHash), now = Date.now();
      if (!db.prepare("SELECT 1 FROM web_sessions WHERE hash=? AND wallet=? AND issued_at<=? AND expires_at>?").get(session, value.wallet, now, now))
        throw new PrivacyError("unauthenticated");
    }
    return value;
  }
  async function proof(id: string, input: PrivacyActor) {
    guard(); const who = actor(input), current = row(id);
    if (!current) return null;
    if (current.asker === who.wallet) return { wallet: who.wallet, original: String(current.data) };
    if (current.erased === 1 && current.retained_owner === who.wallet && current.retained_digest === digest(String(current.data))
      && current.retained_binding === JSON.stringify(who.binding))
      return { wallet: who.wallet, original: String(current.data) };
    if (current.asker !== null || !claims) return null;
    const owned = await claims.read(who.wallet, who.binding, id);
    return owned && JSON.stringify(owned.run) === JSON.stringify(JSON.parse(String(current.data)))
      ? { wallet: who.wallet, original: String(current.data) } : null;
  }
  function owned(id: string, verified: Awaited<ReturnType<typeof proof>>) {
    const current = row(id);
    if (!verified || !current || current.data !== verified.original) throw new PrivacyError("not_found");
    return { current, run: validatePrivacyRun(JSON.parse(String(current.data)), id), state: stateOf(current) };
  }
  function audit(wallet: string, id: string, action: string, requestId: string, input: unknown, result?: unknown, original?: string) {
    z.string().uuid().parse(requestId);
    const packet = JSON.stringify(input), old = db.prepare("SELECT wallet,run_id,action,input,result FROM run_privacy_audit WHERE request_id=?").get(requestId);
    if (old) {
      if (old.wallet !== wallet || old.run_id !== id || old.action !== action || old.input !== packet) throw new PrivacyError("conflict");
      return JSON.parse(String(old.result)) as unknown;
    }
    if (result !== undefined) db.prepare(`INSERT INTO run_privacy_audit VALUES(?,?,?,?,?,?,?,?)`)
      .run(requestId, wallet, id, action, packet, JSON.stringify(result), original ? digest(original) : null, new Date().toISOString());
    return undefined;
  }
  async function mutate(id: string, rawActor: PrivacyActor, rawInput: Parameters<RunPrivacyStore["change"]>[2], erase: boolean) {
    id = privacyId.parse(id); const input = privacyMutation.parse(rawInput), verified = await proof(id, rawActor);
    return transaction(() => {
      const who = actor(rawActor, true), { current, run, state } = owned(id, verified);
      const action = erase ? "erase" : "visibility", previous = audit(who.wallet, id, action, input.requestId, input);
      if (previous !== undefined) return previous as PrivacyState;
      if (state.erased) { if (erase) { audit(who.wallet,id,action,input.requestId,input,state); return state; } throw new PrivacyError("conflict"); }
      if (input.revision !== state.revision) throw new PrivacyError("conflict");
      if (!erase && !input.visibility) throw new PrivacyError("conflict");
      let retained: string | null = null;
      if (erase) {
        if (run.originalFulfillment || db.prepare("SELECT 1 FROM a2a_orders WHERE query_id=?").get(id)) throw new PrivacyError("retention_hold");
        if(db.prepare("SELECT 1 FROM gap_intents WHERE failed_query_id=? AND status NOT IN ('filled','missed','unpaid','failed','stale')").get(id))throw new PrivacyError("retention_hold");
        retained = JSON.stringify(erasedRun(run));
        db.prepare("UPDATE query_runs SET question='',answer='',data=? WHERE id=?").run(retained, id);
        // Remove ordinary question-derived indexes; reward/custody/payment journals remain unchanged.
        db.prepare("DELETE FROM query_memories WHERE id=?").run(id);
        db.prepare("UPDATE gap_intents SET question='',claim='',last_error=NULL WHERE failed_query_id=?").run(id);
      }
      const result: PrivacyState = { visibility: erase ? "private" : input.visibility!, revision: state.revision + 1, erased: erase };
      db.prepare(`INSERT INTO run_privacy(run_id,visibility,revision,erased,retained_owner,retained_digest,retained_binding,updated_at) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(run_id) DO UPDATE SET visibility=excluded.visibility,revision=excluded.revision,erased=excluded.erased,
          retained_owner=excluded.retained_owner,retained_digest=excluded.retained_digest,retained_binding=excluded.retained_binding,updated_at=excluded.updated_at`)
        .run(id,result.visibility,result.revision,erase ? 1 : 0,erase ? who.wallet : null,retained ? digest(retained) : null,
          erase ? JSON.stringify(who.binding) : null,new Date().toISOString());
      audit(who.wallet,id,action,input.requestId,input,result,String(current.data)); return result;
    });
  }
  return Object.freeze({
    async read(id, input) {
      guard(); id = privacyId.parse(id);
      // No broad original lookup on anonymous/public paths: select only visible JSON in storage.
      const current = db.prepare(`SELECT q.data,p.visibility,p.revision,p.erased FROM query_runs q LEFT JOIN run_privacy p ON p.run_id=q.id
        WHERE q.id=? AND coalesce(p.visibility,'unlisted') IN ('public','unlisted') AND coalesce(p.erased,0)=0`).get(id);
      if (current) return { exists: true, item: { run: validatePrivacyRun(JSON.parse(String(current.data)),id), state: stateOf(current) } };
      if (input) { const verified = await proof(id,input); if (verified) { const item = owned(id,verified); if (!item.state.erased) return { exists:true,item }; } }
      return { exists: !!db.prepare("SELECT 1 FROM query_runs WHERE id=?").get(id), item: null };
    },
    async list(query) {
      guard(); const take = z.number().int().min(1).max(2500).parse(query.take), args: (string | number)[] = [];
      let filter = "";
      if (query.before) { privacyId.parse(query.before.id); filter += " AND (q.created_at<? OR (q.created_at=? AND q.id<?))"; args.push(query.before.createdAt,query.before.createdAt,query.before.id); }
      if (query.parentId) { filter += " AND q.parent_id=?"; args.push(privacyId.parse(query.parentId)); }
      if (query.ids) { filter += " AND q.id IN (SELECT value FROM json_each(?))"; args.push(JSON.stringify(z.array(privacyId).max(MAX_USAGE_RUNS).parse(query.ids))); }
      args.push(take);
      return db.prepare(`SELECT q.data FROM query_runs q JOIN run_privacy p ON p.run_id=q.id WHERE p.visibility='public' AND p.erased=0${filter}
        ORDER BY q.created_at DESC,q.id DESC LIMIT ?`).all(...args).map(value => validatePrivacyRun(JSON.parse(String(value.data))));
    },
    async settlement(id) {
      guard(); const value = db.prepare("SELECT id,created_at,budget,engine,total_spent,total_to_creators FROM query_runs WHERE id=?").get(privacyId.parse(id));
      return value ? { id: String(value.id), createdAt:String(value.created_at), budget:Number(value.budget),engine:String(value.engine),
        totalSpent:Number(value.total_spent),totalToCreators:Number(value.total_to_creators),question:"",answer:"",subClaims:[],decisions:[],citations:[],trace:[] } : null;
    },
    async owner(id,input) { const verified=await proof(privacyId.parse(id),input); if (!verified) return null; const item=owned(id,verified); return {run:item.run,state:item.state}; },
    async memories(take) {
      guard(); z.number().int().min(1).max(2500).parse(take);
      return db.prepare(`SELECT m.* FROM query_memories m JOIN run_privacy p ON p.run_id=m.id
        WHERE p.visibility='public' AND p.erased=0 ORDER BY m.created_at DESC,m.id DESC LIMIT ?`).all(take).map(value=>({
        id:String(value.id),createdAt:String(value.created_at),sourceScores:JSON.parse(String(value.source_scores)),
        topics:JSON.parse(String(value.topics)),...(value.sources_read!==null?{sourcesRead:JSON.parse(String(value.sources_read))}:{})}));
    },
    async offers(take) {
      guard();z.number().int().min(1).max(200).parse(take);
      return db.prepare(`SELECT g.id,g.gap_id,g.source_id,g.source_item_link,g.item_id,g.content_version,g.article_offer_id,g.owner_wallet,g.status,g.attempts,
        g.retry_run_id,g.coverage,g.reward_usdc,g.created_at,g.updated_at FROM gap_intents g JOIN run_privacy p ON p.run_id=g.failed_query_id
        WHERE p.visibility='public' AND p.erased=0 AND (g.retry_run_id IS NULL OR EXISTS(SELECT 1 FROM run_privacy r WHERE r.run_id=g.retry_run_id AND r.visibility='public' AND r.erased=0))
        ORDER BY g.created_at DESC,g.id DESC LIMIT ?`).all(take).map(row=>({id:String(row.id),gapId:String(row.gap_id),sourceId:String(row.source_id),sourceItemLink:String(row.source_item_link),
          itemId:row.item_id==null?undefined:String(row.item_id),contentVersion:row.content_version==null?undefined:String(row.content_version),articleOfferId:row.article_offer_id==null?undefined:String(row.article_offer_id),
          ownerWallet:String(row.owner_wallet),status:row.status as import("../types").GapIntent["status"],attempts:Number(row.attempts),
          retryRunId:row.retry_run_id==null?undefined:String(row.retry_run_id),coverage:row.coverage==null?undefined:Number(row.coverage),rewardUsdc:row.reward_usdc==null?undefined:Number(row.reward_usdc),
          createdAt:String(row.created_at),updatedAt:String(row.updated_at)}));
    },
    async defaults(input) { guard(); return visibilitySchema.parse(db.prepare("SELECT visibility FROM run_privacy_defaults WHERE wallet=?").get(actor(input).wallet)?.visibility ?? "private"); },
    async setDefault(input,rawVisibility,requestId) {
      const visibility=visibilitySchema.parse(rawVisibility);
      return transaction(() => { const who=actor(input,true), prior=audit(who.wallet,"","default",requestId,{visibility});
        if (prior!==undefined) return visibilitySchema.parse(prior);
        db.prepare("INSERT INTO run_privacy_defaults VALUES(?,?) ON CONFLICT(wallet) DO UPDATE SET visibility=excluded.visibility").run(who.wallet,visibility);
        audit(who.wallet,"","default",requestId,{visibility},visibility); return visibility; });
    },
    change: (id,input,mutation) => mutate(id,input,mutation,false), erase: (id,input,mutation) => mutate(id,input,mutation,true),
    async export(id,input,requestId) {
      id=privacyId.parse(id); const verified=await proof(id,input);
      return transaction(() => { const who=actor(input), item=owned(id,verified);
        audit(who.wallet,id,"export",requestId,{},item.state,String(item.current.data)); return {run:item.run,state:item.state}; });
    },
  } satisfies RunPrivacyStore);
}
