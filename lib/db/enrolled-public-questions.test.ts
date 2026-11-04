/** Isolated synthetic native fixtures; no live store, signature or settlement. */
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { QueryRun } from "../types";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { insertStorageIdentity, installStorageFences } from "./storage-identity-sqlite";
import { isVerifiedSqliteConnection, openVerifiedSqliteStorage } from "./storage-identity-connection";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { writeSqliteQueryRun } from "./query-run-record";
import { createEnrolledSqliteRunPrivacy, createSqliteRunPrivacy, isEnrolledSqlitePrivacyContention } from "./run-privacy-sqlite";
import { listedQuestions } from "../run-privacy/listed-questions";

let directory: string, template: string, identity: StorageIdentity, index = 0;
const opened: Array<{ close(): void }> = [];
const wallet = `0x${"a".repeat(40)}`, sessionHash = "a".repeat(64);
const actor = { wallet, sessionHash, binding: { network: "eip155:5042" as const, origin: "https://synthetic-public-questions.example" } };
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "keryx-public-questions-")); template = join(directory, "template.sqlite");
  identity = { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1",
    network: actor.binding.network, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const db = new DatabaseSync(template), now = Date.now();
  const run = (id: string): QueryRun => ({ id, createdAt: new Date(now - 1000).toISOString(), question: "Canonical " + id,
    answer: "ANSWER_SENTINEL", budget: 0.03, engine: "synthetic", totalSpent: 0.012345, totalToCreators: 0.000001,
    subClaims: [], decisions: [], citations: [], trace: [], asker: wallet, paymentMode: "offline" });
  try {
    db.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(db);
    writeSqliteQueryRun(db, run("historical"), false); installNativeUserDomainSchema(db);
    for (const id of ["public", "private", "unlisted", "erased"]) writeSqliteQueryRun(db, run(id), false);
    db.prepare("UPDATE run_privacy SET visibility='public' WHERE run_id IN ('public','erased')").run();
    db.prepare("UPDATE run_privacy SET visibility='unlisted' WHERE run_id='unlisted'").run();
    db.prepare("UPDATE run_privacy SET erased=1 WHERE run_id='erased'").run();
    db.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(sessionHash, wallet, now - 2000, now + 600_000);
    insertStorageIdentity(db, identity); installStorageFences(db, identity); db.exec("COMMIT");
  } finally { db.close(); }
});
afterEach(() => { for (const value of opened.splice(0)) value.close(); });
afterAll(() => {
  if (!directory) return;
  const target = resolve(directory), base = resolve(tmpdir()), child = relative(base, target);
  if (!child || isAbsolute(child) || child === ".." || child.startsWith(".." + sep)) throw Error("Fixture cleanup escaped its temporary root");
  rmSync(target, { recursive: true, force: true });
});
function fixture(options: { readOnly?: boolean; runtimeGuard?: () => void } = {}) {
  const file = join(directory, "case-" + ++index + ".sqlite"); copyFileSync(template, file);
  const connection = openVerifiedSqliteStorage(file, identity, { ...options, applicationProfiles: supportedSqliteApplicationProfiles(true) });
  opened.push(connection);
  return { file, connection, privacy: createEnrolledSqliteRunPrivacy(connection.db) };
}

it("admits only current public canonical questions through the actual native readonly port", async () => {
  let guards = 0; const f = fixture({ readOnly: true, runtimeGuard: () => { guards++; } }), before = guards;
  const raw = new DatabaseSync(f.file, { readOnly: true }); opened.push(raw);
  const original = raw.prepare("SELECT id,data FROM query_runs ORDER BY id").all();
  expect(await f.privacy.questions!(["public", "private", "unlisted", "erased", "historical", "missing"]))
    .toEqual([{ id: "public", question: "Canonical public" }]);
  expect(guards).toBeGreaterThan(before + 1); expect(isVerifiedSqliteConnection(f.connection.db)).toBe(true);
  expect(raw.prepare("SELECT id,data FROM query_runs ORDER BY id").all()).toEqual(original);
  expect(() => createSqliteRunPrivacy(raw)).toThrow();
  expect(() => createEnrolledSqliteRunPrivacy(raw)).toThrow();
});

it("freshly observes native publication retraction and erasure without changing financial originals", async () => {
  const f = fixture(), reader = openVerifiedSqliteStorage(f.file, identity, { readOnly: true,
    applicationProfiles: supportedSqliteApplicationProfiles(true) }); opened.push(reader);
  const publicReader = createEnrolledSqliteRunPrivacy(reader.db), raw = new DatabaseSync(f.file, { readOnly: true }); opened.push(raw);
  const financial = () => raw.prepare("SELECT id,budget,total_spent,total_to_creators FROM query_runs ORDER BY id").all();
  const before = financial(); expect(await publicReader.questions!(["public"])).toHaveLength(1);
  await f.privacy.change("public", actor, { visibility: "private", revision: 0, requestId: randomUUID() });
  expect(await publicReader.questions!(["public"])).toEqual([]);
  await f.privacy.change("public", actor, { visibility: "public", revision: 1, requestId: randomUUID() });
  expect(await publicReader.questions!(["public"])).toHaveLength(1);
  await f.privacy.erase("public", actor, { revision: 2, requestId: randomUUID() });
  expect(await publicReader.questions!(["public"])).toEqual([]); expect(financial()).toEqual(before);
});

it("preserves native transient contention identity without retiring or falling back to raw reads", async () => {
  const f = fixture(), blocker = new DatabaseSync(f.file); opened.push(blocker);
  const denied = vi.fn(async () => { throw Error("Raw fallback is forbidden"); });
  const db = { runPrivacyActive: true, runPrivacy: { ...f.privacy, list: denied }, getQueryRun: denied };
  blocker.exec("BEGIN EXCLUSIVE");
  try {
    let failure: unknown;
    try { await listedQuestions(db, ["public"]); } catch (error) { failure = error; }
    expect(failure).toBeDefined(); expect(isEnrolledSqlitePrivacyContention(failure)).toBe(true);
    expect(isVerifiedSqliteConnection(f.connection.db)).toBe(true); expect(denied).not.toHaveBeenCalled();
  } finally { blocker.exec("ROLLBACK"); }
  expect(await listedQuestions(db, ["public"])).toEqual(new Map([["public", "Canonical public"]]));
});

it("keeps native guard revocation terminal even if the external guard later recovers", async () => {
  let refused = false; const f = fixture({ readOnly: true, runtimeGuard: () => { if (refused) throw Error("Synthetic guard revoked"); } });
  expect(await f.privacy.questions!(["public"])).toHaveLength(1); refused = true;
  await expect(f.privacy.questions!(["public"])).rejects.toThrow("privacy_unavailable"); refused = false;
  await expect(f.privacy.questions!(["public"])).rejects.toThrow("privacy_unavailable");
});
