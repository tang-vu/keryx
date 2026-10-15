/** AUTHORED, UNRUN. All rows/files are disposable synthetic fixtures. Imported
 * past associations exercise current decisions; they do NOT prove owner apply,
 * cross-domain occupancy, a real login journey, migration or production consent. */
import { afterEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { insertStorageIdentity, installStorageFences, registerStorageCapability } from "./storage-identity-sqlite";
import { openVerifiedSqliteStorage } from "./storage-identity-connection";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, storageIdentityDigest, type StorageIdentity } from "./storage-identity";
import { createEnrolledSqliteOwnerRunAssignments } from "./owner-run-assignments-sqlite";
import { canonicalJson } from "../canonical-json";
import { assignmentDigest } from "../owner-run-assignments/protocol";
import { eventSchema, type Association, type AssignmentEvent, type Manifest, type Receipt, type RecipientAction } from "../owner-run-assignments/contracts";
import { inboxSchema } from "../owner-run-assignments/projection";

const origin = "https://assignment.invalid", wallet = `0x${"a".repeat(40)}`;
const directories: string[] = [], connections: Array<{ close(): void }> = [];
afterEach(() => { for (const c of connections.splice(0)) { try { c.close(); } catch { /* A refusal may retire it. */ } }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture(imported = false, expired = false, lastRevision = 1) {
  const directory = mkdtempSync(join(tmpdir(), "keryx-owner269-")); directories.push(directory);
  const file = join(directory, "synthetic.sqlite"), now = Date.now();
  const identity: StorageIdentity = { ...syntheticStorageIdentity("testnet-real"), format: "keryx-mainnet-storage-identity-v1",
    authorityMode: "mainnet-real", network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const session = { sessionHash: "c".repeat(64), wallet, issuedAt: now - 10_000, expiresAt: now + 3_600_000 };
  const recipient = { accountId: `acct_${"a".repeat(64)}`, accountCreatedAt: now - 100_000, wallet, memberGeneration: "d".repeat(64) };
  const consentId = randomUUID(), applyId = randomUUID(), consentAt = expired ? now - 90_000_000 : now - 1000;
  const raw = new DatabaseSync(file); raw.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
  installMainnetApplicationSchema(raw); installNativeUserDomainSchema(raw);
  raw.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(session.sessionHash, wallet, session.issuedAt, session.expiresAt);
  raw.prepare("INSERT INTO account267_accounts VALUES(?,?,?)").run(recipient.accountId, 1, recipient.accountCreatedAt);
  raw.prepare("INSERT INTO account267_members VALUES(?,?,?,?,?)").run(wallet, recipient.accountId, recipient.memberGeneration, "e".repeat(64), now - 100_000);
  raw.prepare("INSERT INTO account267_credentials VALUES(?,?,?,?,?,?)").run(wallet, recipient.accountId, recipient.memberGeneration, "f".repeat(64), now - 100_000, 1);
  raw.prepare("INSERT INTO account267_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(session.sessionHash, wallet, recipient.accountId,
    recipient.memberGeneration, "f".repeat(64), session.issuedAt, session.expiresAt, origin, identity.network, 1, null);
  const members = ["synthetic_a", "synthetic_b"].map(runId => {
    const createdAt = new Date(now - 200_000).toISOString();
    const run = { id: runId, createdAt, question: "SYNTHETIC", answer: "SYNTHETIC", decisions: [], citations: [], trace: [], subClaims: [],
      budget: 0, engine: "heuristic", totalSpent: 0, totalToCreators: 0, fundingOwner: "offline", paymentMode: "offline" };
    const data = canonicalJson(run);
    raw.prepare("INSERT INTO query_runs(id,created_at,data) VALUES(?,?,?)").run(runId, createdAt, data);
    raw.prepare("INSERT INTO payment_events(id,query_id,network,settled,settlement_status,amount_usdc,payer,payee) VALUES(?,?,?,0,'simulated',0,?,?)")
      .run(`synthetic_payment_${runId}`, runId, identity.network, `0x${"b".repeat(40)}`, `0x${"9".repeat(40)}`);
    return { assignmentId: randomUUID(), runId, completedAt: createdAt, originalSha256: createHash("sha256").update(data).digest("hex") };
  });
  const manifest: Manifest = { version: 1, binding: { storageDigest: storageIdentityDigest(identity), network: identity.network, origin }, recipient,
    basis: { code: "early-run-recovery", reference: "synthetic-only" }, scope: "association-history-and-confirmation",
    admissionExpiresAt: expired ? now - 1000 : now + 3_600_000, members };
  const makeEvent = (input: AssignmentEvent["input"], actor: AssignmentEvent["actor"], committedAt: number,
    results: Receipt["results"], priorMembers: AssignmentEvent["priorMembers"]): AssignmentEvent => {
    const inputDigest = assignmentDigest("operation", { input, actor });
    return eventSchema.parse({ version: 1, input, actor, priorMembers, credentialGeneration: "f".repeat(64), inputDigest,
      manifest, consentId, consentAt, priorOperationId: null,
      receipt: { version: 1, requestId: input.requestId, action: input.action, inputDigest, committedAt, results,
        meaning: "historical-committed-result-not-current-authority" } });
  };
  if (imported) {
    const consent: RecipientAction = { action: "consent", requestId: consentId, manifest, acknowledgeAssignedLabel: true, noFinancialAuthority: true };
    const proof = makeEvent(consent, recipient, consentAt, [], []);
    raw.prepare("INSERT INTO owner269_operations VALUES(?,?,?)").run(consentId, proof.inputDigest, canonicalJson(proof));
    const rows: Association[] = members.map((member, ordinal) => ({ version: 1, manifest, member, consentId, applyId, lastOperationId: applyId,
      ordinal, revision: ordinal === 1 ? lastRevision : 1, status: "assigned-by-owner", assignedAt: consentAt + 1, confirmedAt: null, decidedAt: null }));
    const applied = makeEvent({ action: "apply", requestId: applyId, manifest, consentId },
      { ownerId: "posix-uid:0", ownerAuthorization: "9".repeat(64) }, consentAt + 1,
      rows.map(r => ({ assignmentId: r.member.assignmentId, revision: r.revision, status: r.status })),
      rows.map(r => ({ assignmentId: r.member.assignmentId, revision: null, status: null, priorOperationId: null })));
    raw.prepare("INSERT INTO owner269_operations VALUES(?,?,?)").run(applyId, applied.inputDigest, canonicalJson(applied));
    for (const row of rows) raw.prepare("INSERT INTO owner269_associations VALUES(?,?,?,?,?,?,?,?,?)").run(row.member.assignmentId, row.member.runId,
      recipient.accountId, recipient.memberGeneration, row.revision, row.status, applyId, applyId, canonicalJson(row));
  }
  insertStorageIdentity(raw, identity); installStorageFences(raw, identity); raw.exec("COMMIT"); raw.close();
  function inspect<T>(action: (db: DatabaseSync) => T): T { const db = new DatabaseSync(file, { readOnly: true }); try { return action(db); } finally { db.close(); } }
  function edit(action: (db: DatabaseSync) => void) { const db = new DatabaseSync(file); try { registerStorageCapability(db, identity, () => true); action(db); } finally { db.close(); } }
  const snapshot = () => inspect(db => canonicalJson(["query_runs", "payment_events", "session_grants", "browser_authorization_intents"].map(table =>
    [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()])));
  const associations = () => inspect(db => canonicalJson(db.prepare("SELECT * FROM owner269_associations ORDER BY assignment_id").all()));
  const events = () => inspect(db => db.prepare("SELECT count(*) AS n FROM owner269_operations").get()!.n);
  const open = (readOnly = false) => { const connection = openVerifiedSqliteStorage(file, identity,
    { readOnly, runtimeGuard() {}, applicationProfiles: supportedSqliteApplicationProfiles(true) }); connections.push(connection);
    return createEnrolledSqliteOwnerRunAssignments(connection.db)!; };
  return { file, identity, recipient, session, manifest, consentId, applyId, inspect, edit, snapshot, associations, events, open };
}
describe("owner269 genuine native metadata (authored UNRUN)", () => {
  it("records authentic transactional recipient consent, exact replay and changed-second-member conflict with two real connections", () => {
    const f = fixture(), first = f.open(), second = f.open(), financial = f.snapshot();
    const input: RecipientAction = { action: "consent", requestId: randomUUID(), manifest: f.manifest, acknowledgeAssignedLabel: true, noFinancialAuthority: true };
    const result = first.act(f.session, f.recipient, input, origin);
    expect(second.act(f.session, f.recipient, input, origin)).toEqual(result); expect(f.events()).toBe(1);
    const changed = { ...input, manifest: { ...f.manifest, members: f.manifest.members.map((m, i) => i === 1 ? { ...m, originalSha256: "0".repeat(64) } : m) } };
    expect(() => first.act(f.session, f.recipient, changed, origin)).toThrow("assignment_conflict");
    expect(f.events()).toBe(1); expect(f.snapshot()).toBe(financial);
    expect(first.stage(f.manifest, result.requestId)).toMatchObject({ applicable: true, holds: [] });
  });
  it("confirms imported pending attribution without manufacturing a claim and preserves original/economic rows", async () => {
    const f = fixture(true), store = f.open(), before = f.snapshot();
    const result = store.act(f.session, f.recipient, { action: "confirm", requestId: randomUUID(), expected: { assignmentId: f.manifest.members[0].assignmentId, revision: 1 } }, origin);
    const inbox = inboxSchema.parse(await store.reply(f.session, wallet, origin).json());
    expect(inbox.history.find(r => r.assignmentId === f.manifest.members[0].assignmentId)).toMatchObject({ attribution: "claimed-from-owner-assignment", effective: true });
    expect(result.results[0]).toMatchObject({ revision: 2, status: "claimed" });
    expect(f.inspect(db => db.prepare("SELECT count(*) AS n FROM anonymous_run_claims").get()!.n)).toBe(0);
    expect(f.snapshot()).toBe(before);
  });
  it("suppresses expired originals but permits genuine same-generation rejection and historical replay", async () => {
    const f = fixture(true, true), store = f.open(), before = f.snapshot();
    const inbox = inboxSchema.parse(await store.reply(f.session, wallet, origin).json());
    expect(inbox.history.every(row => !row.effective && row.runId === undefined && row.attribution === undefined)).toBe(true);
    const expected = { assignmentId: f.manifest.members[0].assignmentId, revision: 1 };
    expect(() => store.act(f.session, f.recipient, { action: "confirm", requestId: randomUUID(), expected }, origin)).toThrow("assignment_consent_required");
    const input = { action: "reject" as const, requestId: randomUUID(), expected };
    const result = store.act(f.session, f.recipient, input, origin);
    expect(store.act(f.session, f.recipient, input, origin)).toEqual(result); expect(f.events()).toBe(3);
    expect(f.snapshot()).toBe(before);
  });
  it("withdraws consent and all affected rows with one operation, including after suppression", () => {
    const f = fixture(true, true), store = f.open(), before = f.snapshot();
    const input = { action: "withdraw-consent" as const, requestId: randomUUID(), consentId: f.consentId,
      expected: f.manifest.members.map(m => ({ assignmentId: m.assignmentId, revision: 1 })) };
    const result = store.act(f.session, f.recipient, input, origin);
    expect(result.results).toHaveLength(2); expect(result.results.every(r => r.status === "revoked")).toBe(true);
    expect(f.events()).toBe(3); expect(store.act(f.session, f.recipient, input, origin)).toEqual(result); expect(f.snapshot()).toBe(before);
  });
  it("rolls back the first row AND consent invalidation when the last member cannot advance its revision", () => {
    const f = fixture(true, true, Number.MAX_SAFE_INTEGER - 1), store = f.open(), before = f.associations(), financial = f.snapshot();
    expect(() => store.act(f.session, f.recipient, { action: "withdraw-consent", requestId: randomUUID(), consentId: f.consentId,
      expected: f.manifest.members.map((m, i) => ({ assignmentId: m.assignmentId, revision: i === 1 ? Number.MAX_SAFE_INTEGER - 1 : 1 })) }, origin)).toThrow();
    expect(f.associations()).toBe(before); expect(f.events()).toBe(2); expect(f.snapshot()).toBe(financial);
  });
  it.each(["revoke-session", "replace-member", "replace-credential"] as const)("refuses captured authority after %s", mode => {
    const f = fixture(true, true), store = f.open(), before = f.associations();
    f.edit(db => {
      if (mode === "revoke-session") db.prepare("DELETE FROM web_sessions WHERE hash=?").run(f.session.sessionHash);
      if (mode === "replace-member") {
        db.prepare("UPDATE account267_members SET generation=? WHERE wallet=?").run("8".repeat(64), wallet);
        db.prepare("UPDATE account267_credentials SET member_generation=? WHERE wallet=?").run("8".repeat(64), wallet);
      }
      if (mode === "replace-credential") db.prepare("UPDATE account267_credentials SET generation=? WHERE wallet=?").run("8".repeat(64), wallet);
    });
    expect(() => store.act(f.session, f.recipient, { action: "reject", requestId: randomUUID(), expected: { assignmentId: f.manifest.members[0].assignmentId, revision: 1 } }, origin)).toThrow("assignment_unauthenticated");
    expect(f.associations()).toBe(before); expect(f.events()).toBe(2);
  });
  it("denies readonly mutations before input parsing and keeps the genuine reader usable", async () => {
    const f = fixture(true), readonly = f.open(true), before = f.associations();
    expect(() => readonly.act(f.session, f.recipient, { action: "reject", requestId: randomUUID(), expected: { assignmentId: f.manifest.members[0].assignmentId, revision: 1 } }, origin)).toThrow("assignment_unavailable");
    expect(inboxSchema.parse(await readonly.reply(f.session, wallet, origin).json()).history).toHaveLength(2);
    expect(f.associations()).toBe(before);
  });
  it("refuses cross-network substitution and a forged owner capability without writes", () => {
    const f = fixture(), store = f.open();
    expect(() => store.stage({ ...f.manifest, binding: { ...f.manifest.binding, network: "eip155:5042002" } })).toThrow("assignment_ineligible");
    // JSON cannot manufacture the private capability; this is a negative test,
    // never a native-authority cast or successful fixture authorization.
    expect(() => Reflect.apply(store.owner, store, [{ action: "apply", requestId: randomUUID(), manifest: f.manifest, consentId: f.consentId }, {}])).toThrow("assignment_owner_required");
    expect(f.events()).toBe(0);
  });
  it("keeps a genuine BUSY/LOCKED refusal recoverable only after no-active-transaction and full guard", () => {
    const f = fixture(), store = f.open(), competitor = new DatabaseSync(f.file);
    const input: RecipientAction = { action: "consent", requestId: randomUUID(), manifest: f.manifest, acknowledgeAssignedLabel: true, noFinancialAuthority: true };
    try {
      competitor.exec("BEGIN IMMEDIATE");
      expect(() => store.act(f.session, f.recipient, input, origin)).toThrow("assignment_unavailable");
      expect(f.events()).toBe(0); competitor.exec("ROLLBACK");
      expect(store.act(f.session, f.recipient, input, origin).action).toBe("consent");
    } finally { if (competitor.isTransaction) competitor.exec("ROLLBACK"); competitor.close(); }
  }, 30_000);
  it("permanently retires after an unknown schema and does not revive when that disposable schema is restored", () => {
    const f = fixture(), store = f.open();
    f.edit(db => db.exec("CREATE TABLE unknown_owner269_fixture(value TEXT)"));
    expect(() => store.reply(f.session, wallet, origin)).toThrow();
    f.edit(db => db.exec("DROP TABLE unknown_owner269_fixture"));
    expect(() => store.reply(f.session, wallet, origin)).toThrow("assignment_unavailable");
    expect(f.events()).toBe(0);
  });
});
