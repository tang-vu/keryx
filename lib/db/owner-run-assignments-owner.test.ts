/** SOURCE ONLY, UNRUN. Disposable synthetic data; no live assignment/settlement.
 * Positive owner acceptance requires actual POSIX real/effective uid0 and the
 * unchanged exact CLI. Ordinary Windows/non-root discovery executes its refusal
 * contract and the portable native controls below. Conditional positives are NOT
 * owner acceptance: see the dedicated root-only UNRUN command in the handoff.
 * No capability, uid, owner boolean, argv or native-policy substitution. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../canonical-json";
import { assignmentDigest } from "../owner-run-assignments/protocol";
import { receiptSchema, type Manifest, type OwnerAction } from "../owner-run-assignments/contracts";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { insertStorageIdentity, installStorageFences, registerStorageCapability } from "./storage-identity-sqlite";
import { openVerifiedSqliteStorage } from "./storage-identity-connection";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, storageIdentityDigest, type StorageIdentity } from "./storage-identity";
import { snapshotTopicWatchesStorage } from "./topic-watches-storage-migration";
import { createEnrolledSqliteOwnerRunAssignments } from "./owner-run-assignments-sqlite";
import { createEnrolledSqliteRunClaims } from "./run-claims-sqlite";

const execute = promisify(execFile), directories: string[] = [], connections: Array<{ close(): void }> = [];
const genuineOwnerRunner = process.platform !== "win32" && process.getuid?.() === 0 && process.geteuid?.() === 0;
const origin = "https://assignment.invalid", wallet = `0x${"a".repeat(40)}`, payer = `0x${"b".repeat(40)}`;
afterEach(() => {
  for (const c of connections.splice(0)) { try { c.close(); } catch { /* Refused connections can retire. */ } }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function requireOwnerRunner() {
  if (process.platform === "win32" || process.getuid?.() !== 0 || process.geteuid?.() !== 0)
    throw new Error("OPEN owner acceptance: genuine POSIX real/effective uid0 plus exact scripts/owner-run-assignment.mts invocation required; Windows unsupported");
}
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "keryx-owner269-fresh-")); directories.push(directory);
  const file = join(directory, "synthetic.sqlite"), deploymentFile = join(directory, "deployment.json"), now = Date.now();
  const identity: StorageIdentity = { ...syntheticStorageIdentity("testnet-real"), format: "keryx-mainnet-storage-identity-v1",
    authorityMode: "mainnet-real", network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const session = { sessionHash: "c".repeat(64), wallet, issuedAt: now - 10_000, expiresAt: now + 3_600_000 };
  const recipient = { accountId: `acct_${"a".repeat(64)}`, accountCreatedAt: now - 100_000, wallet, memberGeneration: "d".repeat(64) };
  const db = new DatabaseSync(file); db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
  installMainnetApplicationSchema(db); installNativeUserDomainSchema(db);
  db.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(session.sessionHash, wallet, session.issuedAt, session.expiresAt);
  db.prepare("INSERT INTO account267_accounts VALUES(?,?,?)").run(recipient.accountId, 1, recipient.accountCreatedAt);
  db.prepare("INSERT INTO account267_members VALUES(?,?,?,?,?)").run(wallet, recipient.accountId, recipient.memberGeneration, "e".repeat(64), now - 100_000);
  db.prepare("INSERT INTO account267_credentials VALUES(?,?,?,?,?,?)").run(wallet, recipient.accountId, recipient.memberGeneration, "f".repeat(64), now - 100_000, 1);
  db.prepare("INSERT INTO account267_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(session.sessionHash, wallet, recipient.accountId,
    recipient.memberGeneration, "f".repeat(64), session.issuedAt, session.expiresAt, origin, identity.network, 1, null);
  const members = ["fresh_a", "fresh_b"].map(runId => {
    const createdAt = new Date(now - 200_000).toISOString(), data = canonicalJson({ id: runId, createdAt,
      question: "SYNTHETIC", answer: "SYNTHETIC", decisions: [], citations: [], trace: [], subClaims: [],
      budget: 0, engine: "heuristic", totalSpent: 0, totalToCreators: 0, fundingOwner: "offline", paymentMode: "offline" });
    db.prepare("INSERT INTO query_runs(id,created_at,data,duration_ms) VALUES(?,?,?,9007199254740993)").run(runId, createdAt, data);
    // Explicitly synthetic retained rows, seeded before enrollment. No real
    // settlement is claimed; these only bind original network and payer cells.
    db.prepare("INSERT INTO payment_events(id,query_id,network,settled,settlement_status,amount_usdc,payer,payee,rationale) VALUES(?,?,?,0,'pending',0,?,?,?)")
      .run(`synthetic_${runId}`, runId, identity.network, payer, `0x${"9".repeat(40)}`, Buffer.from([0, 255, 128]));
    return { assignmentId: randomUUID(), runId, completedAt: createdAt, originalSha256: createHash("sha256").update(data).digest("hex") };
  });
  db.exec("INSERT INTO sync_state(key,value,updated_at) VALUES('raw-text',CAST(X'fffe00c3' AS TEXT),NULL)");
  // A preexisting synthetic A2A association on a DIFFERENT original is used only
  // for an UPDATE association race; no purchase, payment or claim is fabricated
  // by an owner operation. The existing purchase-authority trigger remains intact.
  db.prepare(`INSERT INTO a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,
    service_fee_usdc,research_mode,status,transaction_id,request_data,created_at,updated_at)
    VALUES('synthetic_order','unrelated','synthetic_authorization','synthetic_hash',?,?,0.000001,0,0.000001,'quick','failed','synthetic',?,?,?)`)
    .run(payer, `0x${"9".repeat(40)}`, canonicalJson({ network: identity.network }), new Date(now).toISOString(), new Date(now).toISOString());
  insertStorageIdentity(db, identity); installStorageFences(db, identity); db.exec("COMMIT"); db.close();
  const manifest: Manifest = { version: 1, binding: { storageDigest: storageIdentityDigest(identity), network: identity.network, origin }, recipient,
    basis: { code: "early-run-recovery", reference: "synthetic-only" }, scope: "association-history-and-confirmation",
    admissionExpiresAt: now + 3_600_000, members };
  writeFileSync(deploymentFile, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } }));
  const inspect = <T>(read: (raw: DatabaseSync) => T): T => { const raw = new DatabaseSync(file, { readOnly: true }); try { return read(raw); } finally { raw.close(); } };
  const edit = (write: (raw: DatabaseSync) => void) => { const raw = new DatabaseSync(file); try { registerStorageCapability(raw, identity, () => true); write(raw); } finally { raw.close(); } };
  const oldTyped = () => inspect(raw => {
    const tables = { ...snapshotTopicWatchesStorage(raw, identity, supportedSqliteApplicationProfiles(true)).tables };
    delete tables.owner269_operations; delete tables.owner269_associations; return tables;
  });
  const open = (readOnly = false) => { const c = openVerifiedSqliteStorage(file, identity, { readOnly,
    applicationProfiles: supportedSqliteApplicationProfiles(true), runtimeGuard() {} }); connections.push(c); return c; };
  const store = () => createEnrolledSqliteOwnerRunAssignments(open().db)!;
  const consent = () => store().act(session, recipient, { action: "consent", requestId: randomUUID(), manifest,
    acknowledgeAssignedLabel: true, noFinancialAuthority: true }, origin).requestId;
  const invoke = async (verb: OwnerAction["action"] | "receipt", operation: OwnerAction, manifestPath = deploymentFile) => {
    const input = join(directory, `${operation.requestId}.json`); writeFileSync(input, canonicalJson(operation));
    const { stdout } = await execute(process.execPath, ["--import", "tsx", "scripts/owner-run-assignment.mts", verb,
      "--storage-manifest", manifestPath, "--identity-digest", storageIdentityDigest(identity), "--input", input,
      "--approve-operation-digest", assignmentDigest("owner-operation", operation)],
      { cwd: resolve("."), timeout: 15_000, maxBuffer: 131_072, windowsHide: true });
    return JSON.parse(stdout);
  };
  const counts = () => inspect(raw => ({ operations: raw.prepare("SELECT count(*) AS n FROM owner269_operations").get()!.n,
    associations: raw.prepare("SELECT count(*) AS n FROM owner269_associations").get()!.n }));
  return { directory, file, identity, session, recipient, manifest, deploymentFile, inspect, edit, oldTyped, open, store, consent, invoke, counts };
}
describe.runIf(genuineOwnerRunner)("fresh owner269 POSIX uid0 acceptance, exact local CLI (SOURCE UNRUN)", () => {
  beforeEach(requireOwnerRunner);
  it("atomically applies two fresh members, resolves a discarded response, undoes, and replays historical receipt without restoration", async () => {
    const f = fixture(), before = f.oldTyped(), consentId = f.consent();
    const apply: OwnerAction = { action: "apply", requestId: randomUUID(), manifest: f.manifest, consentId };
    expect(await f.invoke("receipt", apply)).toEqual({ status: "absent" });
    await f.invoke("apply", apply); // Deliberately discard the client receipt; no replacement ID or automatic retry.
    const lookup = await f.invoke("receipt", apply), committed = receiptSchema.parse(lookup.receipt);
    expect(lookup.status).toBe("committed"); expect(committed.results).toHaveLength(2);
    expect(f.counts()).toEqual({ operations: 2, associations: 2 }); expect(f.oldTyped()).toEqual(before);
    const staleUndo: OwnerAction = { action: "undo", requestId: randomUUID(), applyId: apply.requestId,
      expected: f.manifest.members.map((m, i) => ({ assignmentId: m.assignmentId, revision: i === 1 ? 2 : 1 })) };
    await expect(f.invoke("undo", staleUndo)).rejects.toThrow("assignment_conflict");
    expect(await f.invoke("receipt", staleUndo)).toEqual({ status: "absent" });
    expect(f.counts()).toEqual({ operations: 2, associations: 2 });
    expect(f.inspect(raw => raw.prepare("SELECT count(*) AS n FROM owner269_associations WHERE status='assigned-by-owner'").get()!.n)).toBe(2);
    const undo: OwnerAction = { action: "undo", requestId: randomUUID(), applyId: apply.requestId,
      expected: f.manifest.members.map(m => ({ assignmentId: m.assignmentId, revision: 1 })) };
    expect(receiptSchema.parse(await f.invoke("undo", undo)).results.every(row => row.status === "revoked")).toBe(true);
    expect(await f.invoke("apply", apply)).toEqual(committed);
    expect(await f.invoke("receipt", undo)).toMatchObject({ status: "committed", receipt: { action: "undo" } });
    expect(f.inspect(raw => raw.prepare("SELECT count(*) AS n FROM owner269_associations WHERE status='revoked'").get()!.n)).toBe(2);
    expect(f.counts()).toEqual({ operations: 3, associations: 2 }); expect(f.oldTyped()).toEqual(before);
  }, 30_000);
  it("rolls back the first member and operation audit when the second original changed after genuine consent", async () => {
    const f = fixture(), consentId = f.consent();
    f.edit(raw => raw.prepare("UPDATE query_runs SET data=? WHERE id=?").run('{"changed":"synthetic"}', f.manifest.members[1].runId));
    const before = f.oldTyped(), apply: OwnerAction = { action: "apply", requestId: randomUUID(), manifest: f.manifest, consentId };
    await expect(f.invoke("apply", apply)).rejects.toThrow("assignment_ineligible");
    expect(f.counts()).toEqual({ operations: 1, associations: 0 }); expect(f.oldTyped()).toEqual(before);
    expect(await f.invoke("receipt", apply)).toEqual({ status: "absent" });
  }, 30_000);
  it.each(["member", "credential", "account"] as const)("refuses fresh apply after current %s lineage changed without recording an assignment", async mode => {
    const f = fixture(), consentId = f.consent();
    f.edit(raw => {
      if (mode === "member") {
        raw.prepare("UPDATE account267_members SET generation=? WHERE wallet=?").run("8".repeat(64), wallet);
        raw.prepare("UPDATE account267_credentials SET member_generation=? WHERE wallet=?").run("8".repeat(64), wallet);
      } else if (mode === "credential") raw.prepare("UPDATE account267_credentials SET generation=? WHERE wallet=?").run("8".repeat(64), wallet);
      else raw.prepare("UPDATE account267_accounts SET created_at=created_at+1 WHERE account_id=?").run(f.recipient.accountId);
    });
    const before = f.oldTyped(), apply: OwnerAction = { action: "apply", requestId: randomUUID(), manifest: f.manifest, consentId };
    await expect(f.invoke("apply", apply)).rejects.toThrow();
    expect(await f.invoke("receipt", apply)).toEqual({ status: "absent" });
    expect(f.counts()).toEqual({ operations: 1, associations: 0 }); expect(f.oldTyped()).toEqual(before);
  }, 30_000);
  it("races the unchanged native ticket issuer against the owner CLI on two real connections; only one can occupy", async () => {
    const f = fixture(), consentId = f.consent(), claims = createEnrolledSqliteRunClaims(f.open().db), member = f.manifest.members[0];
    const tokenHash = "7".repeat(64), binding = { network: f.identity.network, origin };
    const apply: OwnerAction = { action: "apply", requestId: randomUUID(), manifest: f.manifest, consentId };
    const owner = f.invoke("apply", apply);
    const results = await Promise.allSettled([owner, claims.issue({ runId: member.runId, tokenHash, completedAt: member.completedAt, binding })]);
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
    const count = f.counts();
    if (results[1].status === "fulfilled") {
      expect(count).toEqual({ operations: 1, associations: 0 });
      const captured = f.inspect(raw => canonicalJson(raw.prepare("SELECT * FROM anonymous_run_claims").all()));
      await expect(f.invoke("apply", apply)).rejects.toThrow("assignment_ineligible");
      expect(f.inspect(raw => canonicalJson(raw.prepare("SELECT * FROM anonymous_run_claims").all()))).toBe(captured);
      // Existing token/session/original proof remains the only ticket authority.
      expect(await claims.claim({ tokenHash, wallet, sessionHash: f.session.sessionHash, binding })).toMatchObject({ runId: member.runId, wallet });
      await expect(claims.claim({ tokenHash, wallet, sessionHash: f.session.sessionHash, binding })).rejects.toThrow();
    } else {
      expect(count).toEqual({ operations: 2, associations: 2 });
      expect(f.inspect(raw => raw.prepare("SELECT count(*) AS n FROM anonymous_run_claims").get()!.n)).toBe(0);
    }
    expect(f.inspect(raw => raw.prepare("SELECT DISTINCT payer FROM payment_events").all())).toEqual([{ payer }]);
  }, 30_000);
  it.each(["original", "a2a"] as const)("serializes an existing %s writer held on a second connection, then refuses the changed original", async mode => {
    const f = fixture(), consentId = f.consent(), raw = new DatabaseSync(f.file);
    const apply: OwnerAction = { action: "apply", requestId: randomUUID(), manifest: f.manifest, consentId };
    registerStorageCapability(raw, f.identity, () => true);
    try {
      raw.exec("BEGIN IMMEDIATE");
      if (mode === "original") raw.prepare("UPDATE query_runs SET data=? WHERE id=?").run('{"changed":"synthetic"}', f.manifest.members[1].runId);
      else raw.prepare("UPDATE a2a_orders SET query_id=? WHERE id='synthetic_order'").run(f.manifest.members[1].runId);
      // Keep the real second writer lock until the actual stock 5000ms wait
      // refuses. No timeout/policy override or timing-based unlock is used.
      await expect(f.invoke("apply", apply)).rejects.toThrow();
      raw.exec("COMMIT");
    } finally { if (raw.isTransaction) raw.exec("ROLLBACK"); raw.close(); }
    const before = f.oldTyped();
    await expect(f.invoke("apply", apply)).rejects.toThrow("assignment_ineligible");
    expect(await f.invoke("receipt", apply)).toEqual({ status: "absent" });
    expect(f.counts()).toEqual({ operations: 1, associations: 0 }); expect(f.oldTyped()).toEqual(before);
  }, 30_000);
  it("guards occupied originals on both UPDATE keys, REPLACE, DELETE, A2A association and ticket issue; undo releases only metadata occupancy", async () => {
    const f = fixture(), consentId = f.consent(), apply: OwnerAction = { action: "apply", requestId: randomUUID(), manifest: f.manifest, consentId };
    // Seed the unrelated collision original and its normal privacy row BEFORE
    // the typed baseline. Retain both; privacy tombstones must never be erased.
    const collisionCreatedAt = f.manifest.members[0].completedAt;
    f.edit(raw => raw.prepare("INSERT INTO query_runs(id,created_at,data) VALUES('other',?,?)").run(collisionCreatedAt,
      canonicalJson({ id: "other", createdAt: collisionCreatedAt, question: "SYNTHETIC", answer: "SYNTHETIC",
        decisions: [], citations: [], trace: [], subClaims: [], budget: 0, engine: "heuristic",
        totalSpent: 0, totalToCreators: 0, fundingOwner: "offline", paymentMode: "offline" })));
    await f.invoke("apply", apply); const before = f.oldTyped(), member = f.manifest.members[0];
    f.edit(raw => {
      for (const sql of ["DELETE FROM query_runs WHERE id=?", "UPDATE query_runs SET asker='synthetic' WHERE id=?",
        "INSERT OR REPLACE INTO query_runs(id,data) VALUES(?,'{}')"]) expect(() => raw.prepare(sql).run(member.runId)).toThrow("assignment_original_occupied");
      expect(() => raw.prepare("UPDATE OR REPLACE query_runs SET id=? WHERE id='other'").run(member.runId)).toThrow("assignment_original_occupied");
      expect(() => raw.prepare("UPDATE a2a_orders SET query_id=? WHERE id='synthetic_order'").run(member.runId)).toThrow("assignment_original_occupied");
      expect(() => raw.prepare(`INSERT INTO a2a_orders SELECT 'another',?,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,
        service_fee_usdc,research_mode,package_data,status,transaction_id,request_data,started_at,worker_id,execution_journal_version,
        payment_started_at,result_saving_at,response_data,error_code,resolution_data,created_at,updated_at FROM a2a_orders WHERE id='synthetic_order'`)
        .run(member.runId)).toThrow("assignment_original_occupied");
    });
    const issue = { runId: member.runId, tokenHash: "7".repeat(64), completedAt: member.completedAt, binding: { network: f.identity.network, origin } };
    await expect(createEnrolledSqliteRunClaims(f.open().db).issue(issue)).rejects.toThrow();
    expect(f.oldTyped()).toEqual(before);
    await f.invoke("undo", { action: "undo", requestId: randomUUID(), applyId: apply.requestId,
      expected: f.manifest.members.map(m => ({ assignmentId: m.assignmentId, revision: 1 })) });
    await expect(createEnrolledSqliteRunClaims(f.open().db).issue(issue)).resolves.toMatchObject({ runId: member.runId });
  }, 30_000);
  it("refuses changed manifests and missing fences through the genuine owner CLI", async () => {
    const f = fixture(), consentId = f.consent(), apply: OwnerAction = { action: "apply", requestId: randomUUID(), manifest: f.manifest, consentId };
    const wrongFile = join(f.directory, "wrong-manifest.json"), original = JSON.parse(readFileSync(f.deploymentFile, "utf8"));
    writeFileSync(wrongFile, canonicalJson({ ...original, identity: { ...original.identity, deploymentId: "unknown" } }));
    await expect(f.invoke("apply", apply, wrongFile)).rejects.toThrow();
    f.edit(raw => raw.exec("DROP TRIGGER storage_mode_payment_insert"));
    await expect(f.invoke("apply", apply)).rejects.toThrow();
    expect(f.counts()).toEqual({ operations: 1, associations: 0 });
  }, 30_000);
});

describe("fresh owner269 ordinary platform refusal and native controls (SOURCE UNRUN)", () => {
  it.skipIf(genuineOwnerRunner)("executes the unchanged CLI on Windows/non-root and refuses owner access without mutation", async () => {
    const f = fixture(), consentId = f.consent();
    const apply: OwnerAction = { action: "apply", requestId: randomUUID(), manifest: f.manifest, consentId };
    const snapshot = () => f.inspect(raw => snapshotTopicWatchesStorage(raw, f.identity, supportedSqliteApplicationProfiles(true)));
    const before = snapshot(), originalBytes = readFileSync(f.file), manifestBytes = readFileSync(f.deploymentFile);
    // Both mutation and receipt lookup require the real OS owner. No imported
    // CLI function, injected capability or altered process identity can pass.
    for (const verb of ["apply", "receipt"] as const) {
      await expect(f.invoke(verb, apply)).rejects.toMatchObject({ code: 1, stdout: "",
        stderr: expect.stringContaining('"error":"assignment_owner_required"') });
      expect(snapshot()).toEqual(before); // Includes both owner journals and all old typed tables/schema.
      expect(f.counts()).toEqual({ operations: 1, associations: 0 });
      expect(readFileSync(f.file)).toEqual(originalBytes); expect(readFileSync(f.deploymentFile)).toEqual(manifestBytes);
    }
  }, 30_000);
  it("refuses readonly owner mutation before parsing/capability and retires unknown native schemas on every platform", () => {
    const f = fixture(), consentId = f.consent();
    const readonly = createEnrolledSqliteOwnerRunAssignments(f.open(true).db)!;
    expect(() => Reflect.apply(readonly.owner, readonly, [null, {}])).toThrow("assignment_unavailable");
    const admitted = f.store(); f.edit(raw => raw.exec("CREATE TABLE unknown_owner_fixture(value TEXT)"));
    expect(() => admitted.stage(f.manifest, consentId)).toThrow();
    f.edit(raw => raw.exec("DROP TABLE unknown_owner_fixture"));
    expect(() => admitted.stage(f.manifest, consentId)).toThrow("assignment_unavailable");
    expect(f.counts()).toEqual({ operations: 1, associations: 0 });
  }, 30_000);
});
