import { afterEach, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { canonicalJson } from "../canonical-json";
import type { QueryRun } from "../types";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST } from "./storage-identity";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { insertStorageIdentity, installStorageFences, registerStorageCapability } from "./storage-identity-sqlite";
import { openVerifiedSqliteStorage } from "./storage-identity-connection";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { writeSqliteQueryRun } from "./query-run-record";
import { applyLegacyRestorePlan, exportLegacyResearch, inspectLegacyRestorePlan, makeLegacyRestorePlan } from "./public-research-restore";

const wallet = `0x${"a".repeat(40)}`;
const date = "2026-10-01T00:00:00.000Z", cutoff = "2026-10-15T00:00:00.000Z";
const sha = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const opened: Array<{ close(): void }> = [], folders: string[] = [];
function fixture(readOnly = false) {
  const folder = mkdtempSync(join(tmpdir(), "keryx-public-restore-")); folders.push(folder);
  const file = join(folder, "synthetic.sqlite");
  const identity = { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1" as const,
    network: "eip155:5042" as const, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const raw = new DatabaseSync(file);
  const run = (id: string): QueryRun => ({ id, createdAt: date, question: `Synthetic public question ${id}`,
    answer: "Synthetic answer", budget: 0, engine: "heuristic", totalSpent: 0, totalToCreators: 0,
    subClaims: [], decisions: [], citations: [], trace: [] });
  try {
    raw.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(raw);
    for (const id of ["legacy-a", "legacy-b", "prv_hidden"]) writeSqliteQueryRun(raw, run(id), false);
    raw.prepare("INSERT INTO query_memories(id,source_scores,topics,created_at) VALUES(?,?,?,?)")
      .run("legacy-a", "{}", '["synthetic topic"]', date);
    raw.prepare("INSERT INTO payment_events(id,query_id,network,settled,settlement_status,amount_usdc,kind,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run("synthetic-pending", "legacy-a", "eip155:5042", 0, "pending", 0.005, "fetch", date);
    installNativeUserDomainSchema(raw); insertStorageIdentity(raw, identity); installStorageFences(raw, identity); raw.exec("COMMIT");
  } finally { raw.close(); }
  const connection = openVerifiedSqliteStorage(file, identity, { readOnly, applicationProfiles: supportedSqliteApplicationProfiles(true) });
  opened.push(connection);
  const edit = (action: (db: DatabaseSync) => void) => {
    const db = new DatabaseSync(file);
    try { registerStorageCapability(db, identity, () => true); action(db); } finally { db.close(); }
  };
  const review = () => exportLegacyResearch(connection.db, cutoff);
  const plan = () => {
    const exported = review();
    return makeLegacyRestorePlan(exported, exported.candidates.map(row => ({ id: row.id,
      decision: row.id.startsWith("prv_") ? "exclude" : "public", reason: "Synthetic operator-reviewed fixture" })));
  };
  const states = () => connection.db.prepare("SELECT run_id,visibility FROM run_privacy ORDER BY run_id").all();
  return { ...connection, file, folder, identity, edit, review, plan, states };
}
afterEach(() => {
  for (const connection of opened.splice(0)) connection.close();
  for (const folder of folders.splice(0)) {
    if (!resolve(folder).startsWith(resolve(tmpdir()) + sep) || !basename(folder).startsWith("keryx-public-restore-"))
      throw new Error("Unexpected synthetic cleanup target");
    rmSync(folder, { recursive: true, force: true });
  }
});

it("exports protected originals and related memories without changing missing legacy privacy", () => {
  const f = fixture(true), exported = f.review();
  expect(exported.candidates).toHaveLength(3);
  expect(exported.candidates.find(row => row.id === "legacy-a")!.related.memory?.topics).toContain("synthetic topic");
  expect(exported.candidates.find(row => row.id === "prv_hidden")!.related.privateJobReference).toBe(true);
  expect(inspectLegacyRestorePlan(f.db, f.plan())).toEqual({ approved: 2, excluded: 1, stale: 0, blocked: 0 });
  expect(f.states()).toEqual([]);
});

it("publishes every approved original atomically while retaining excluded originals and exact nonprivacy hashes", () => {
  const f = fixture(), plan = f.plan();
  const receipt = applyLegacyRestorePlan(f.db, plan, sha(plan));
  expect(receipt).toMatchObject({ published: 2, approved: 2, excluded: 1, stale: 0, blocked: 0 });
  expect(receipt.before).toEqual(receipt.after);
  expect(f.states()).toEqual([{ run_id: "legacy-a", visibility: "public" }, { run_id: "legacy-b", visibility: "public" }]);
  expect(() => applyLegacyRestorePlan(f.db, plan, sha(plan))).toThrow("stale or blocked");
});

it.each(["private", "unlisted", "public"])("aborts the entire apply when a reviewed original has acquired explicit %s state", visibility => {
  const f = fixture(), plan = f.plan();
  f.edit(db => db.prepare("INSERT INTO run_privacy(run_id,visibility,updated_at) VALUES(?,?,?)").run("legacy-b", visibility, date));
  expect(inspectLegacyRestorePlan(f.db, plan)).toMatchObject({ stale: 1 });
  expect(() => applyLegacyRestorePlan(f.db, plan, sha(plan))).toThrow("stale or blocked");
  expect(f.states()).toEqual([{ run_id: "legacy-b", visibility }]);
});

it("does not override an erased original or publish any earlier entry", () => {
  const f = fixture(), plan = f.plan();
  f.edit(db => db.prepare("INSERT INTO run_privacy(run_id,visibility,erased,updated_at) VALUES(?,'private',1,?)").run("legacy-b", date));
  expect(() => applyLegacyRestorePlan(f.db, plan, sha(plan))).toThrow("stale or blocked");
  expect(f.states()).toEqual([{ run_id: "legacy-b", visibility: "private" }]);
});

it("treats a new retained visibility audit as stale even without a sidecar", () => {
  const f = fixture(), plan = f.plan();
  f.edit(db => db.prepare("INSERT INTO run_privacy_audit VALUES(?,?,?,?,?,?,?,?)")
    .run("synthetic-request", wallet, "legacy-b", "visibility", "{}", "{}", null, date));
  expect(() => applyLegacyRestorePlan(f.db, plan, sha(plan))).toThrow("stale or blocked");
  expect(f.states()).toEqual([]);
});

it.each(["original", "memory"])("requires another review after the %s changes", kind => {
  const f = fixture(), plan = f.plan();
  f.edit(db => {
    if (kind === "memory") db.prepare("UPDATE query_memories SET topics=? WHERE id='legacy-a'").run('["changed synthetic topic"]');
    else {
      const original = JSON.parse(String(db.prepare("SELECT data FROM query_runs WHERE id='legacy-a'").get()!.data));
      original.answer = "Changed synthetic answer";
      db.prepare("UPDATE query_runs SET data=?,answer=? WHERE id='legacy-a'").run(JSON.stringify(original), original.answer);
    }
  });
  expect(() => applyLegacyRestorePlan(f.db, plan, sha(plan))).toThrow("stale or blocked");
  expect(f.states()).toEqual([]);
});

it("refuses hard private namespaces and private-job references during review", () => {
  const f = fixture();
  f.edit(db => db.prepare("INSERT INTO private_research_intents(id,payer,data) VALUES(?,?,?)")
    .run(`prv_${"a".repeat(64)}`, wallet, JSON.stringify({ queryId: "legacy-a", requirement: {
      network: "eip155:5042", asset: "0x3600000000000000000000000000000000000000",
      extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE" },
    } })));
  const review = f.review();
  expect(review.candidates.find(row => row.id === "legacy-a")!.related.privateJobReference).toBe(true);
  expect(() => makeLegacyRestorePlan(review, review.candidates.map(row => ({ id: row.id, decision: "public", reason: "Synthetic" }))))
    .toThrow("private-job reference");
});

it("requires linked hidden parent context to be reviewed and approved together", () => {
  const f = fixture();
  f.edit(db => {
    const run = JSON.parse(String(db.prepare("SELECT data FROM query_runs WHERE id='legacy-b'").get()!.data)); run.parentId = "legacy-a";
    db.prepare("UPDATE query_runs SET data=?,parent_id=? WHERE id='legacy-b'").run(JSON.stringify(run), run.parentId);
  });
  const exported = f.review(), plan = makeLegacyRestorePlan(exported, exported.candidates.map(row => ({ id: row.id,
    decision: row.id === "legacy-b" ? "public" : "exclude", reason: "Synthetic" })));
  expect(inspectLegacyRestorePlan(f.db, plan)).toMatchObject({ blocked: 1 });
  expect(() => applyLegacyRestorePlan(f.db, plan, sha(plan))).toThrow("stale or blocked");
  expect(f.states()).toEqual([]);
  const together = f.plan(); expect(applyLegacyRestorePlan(f.db, together, sha(together)).published).toBe(2);
});

it("preserves an explicit hidden account default instead of publishing its historical originals", () => {
  const f = fixture();
  f.edit(db => {
    const run = JSON.parse(String(db.prepare("SELECT data FROM query_runs WHERE id='legacy-a'").get()!.data)); run.asker = wallet;
    db.prepare("UPDATE query_runs SET data=?,asker=? WHERE id='legacy-a'").run(JSON.stringify(run), wallet);
    db.prepare("INSERT INTO run_privacy_defaults VALUES(?,?)").run(wallet, "private");
  });
  const exported = f.review();
  expect(() => makeLegacyRestorePlan(exported, exported.candidates.map(row => ({ id: row.id,
    decision: row.id.startsWith("prv_") ? "exclude" : "public", reason: "Synthetic" })))).toThrow("explicit privacy");
  expect(f.states()).toEqual([]);
});

it("permits a separately reviewed public recovery projection without publishing its operational packet", () => {
  const f = fixture();
  f.edit(db => {
    const run = JSON.parse(String(db.prepare("SELECT data FROM query_runs WHERE id='legacy-a'").get()!.data));
    // A synthetic format marker, not a fulfillment receipt or payment proof.
    run.originalFulfillment = { format: "keryx-a2a-original-fulfillment-result-v1", operationalSecret: "synthetic-private-marker" };
    db.prepare("UPDATE query_runs SET data=? WHERE id='legacy-a'").run(JSON.stringify(run));
  });
  const review = f.review(), selected = review.candidates.find(row => row.id === "legacy-a")!;
  expect(selected.related.privateJobReference).toBe(false); expect(selected.related.recoveryReference).toBe(true);
  expect(selected.publicProjection).not.toHaveProperty("originalFulfillment");
  expect(JSON.stringify(selected.publicProjection)).not.toContain("synthetic-private-marker");
  const decisions = review.candidates.map(row => ({ id: row.id, decision: row.id.startsWith("prv_") ? "exclude" : "public", reason: "Synthetic" }));
  expect(() => makeLegacyRestorePlan(review, decisions)).toThrow("separate recovery review");
  const plan = makeLegacyRestorePlan(review, decisions.map(row => row.id === "legacy-a" ? { ...row, recoveryReviewed: true } : row));
  expect(applyLegacyRestorePlan(f.db, plan, sha(plan)).published).toBe(2);
});

it("refuses unverified handles, read-only mutation, edited plans and incomplete review decisions", () => {
  const f = fixture(true), raw = new DatabaseSync(f.file); opened.push(raw);
  expect(() => exportLegacyResearch(raw, cutoff)).toThrow();
  const plan = f.plan(); expect(() => applyLegacyRestorePlan(f.db, plan, sha(plan))).toThrow();
  expect(() => applyLegacyRestorePlan(f.db, { ...plan, reviewSha256: "a".repeat(64) }, sha(plan))).toThrow("digest changed");
  expect(() => makeLegacyRestorePlan(f.review(), [])).toThrow("every candidate");
  expect(f.states()).toEqual([]);
});

it("sanitizes actual operator decoder failures so private stored text never reaches stderr", () => {
  const f = fixture(), marker = "SYNTHETIC_PRIVATE_DECODER_CANARY";
  f.edit(db => db.prepare("UPDATE query_runs SET data=? WHERE id='legacy-a'").run(`{"question":"${marker}",`));
  const manifest = join(f.folder, "deployment.json"), output = join(f.folder, "protected-review.json");
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity: f.identity,
    backend: { kind: "sqlite", databasePath: f.file } }));
  const child = spawnSync(process.execPath, ["--import", "tsx", "scripts/restore-public-research.mts", "export", "--out", output], {
    cwd: process.cwd(), env: { ...process.env, KERYX_STORAGE_MANIFEST: manifest, KERYX_FORCE_OFFLINE: "0", NODE_OPTIONS: "--max-old-space-size=2048" },
    encoding: "utf8", timeout: 30000,
  });
  expect(child.status).toBe(1); expect(child.stderr).toContain('"code":"protected_review_refused"');
  expect(child.stderr + child.stdout).not.toContain(marker); expect(child.stderr).not.toContain("SyntaxError");
  expect(f.states()).toEqual([]);
});
