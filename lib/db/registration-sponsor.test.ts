import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { encodeAbiParameters, keccak256, toBytes, type Address, type Hex } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { registrationIntentDigest, registrationPolicyDigest, type RegistrationSponsorPolicy, type SponsoredRegistration } from "../sources/registration-sponsor-protocol";
import { sourceClaimSchema, type SourceClaim } from "../sources/public-source-claim";
import { admitSqliteRegistrationSponsor as admit, getSqliteRegistrationSponsor as get,
  RegistrationSponsorError, transitionSqliteRegistrationSponsor as transition } from "./registration-sponsor";

const A = "0x1111111111111111111111111111111111111111" as Address;
const B = "0x2222222222222222222222222222222222222222" as Address;
const REGISTRY = "0x3333333333333333333333333333333333333333" as Address;
const SPONSOR = "0x4444444444444444444444444444444444444444" as Address;
const HASH = ("0x" + "12".repeat(32)) as Hex;
const OTHER_HASH = ("0x" + "34".repeat(32)) as Hex;
const NOW = Date.UTC(2026, 9, 9, 12);
const RESERVATION = BigInt("420000000000000");
const prefix = "keryx:registration-sponsor:v1:";
const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });

function policy(overrides: Partial<RegistrationSponsorPolicy> = {}): RegistrationSponsorPolicy {
  return { protocol: "keryx-registration-sponsor-v1", network: "eip155:5042", deploymentOrigin: "https://keryx.example",
    registryAddress: REGISTRY, registryCodeHash: HASH, sponsorAddress: SPONSOR, expiresAt: NOW + 7 * 86_400_000,
    maxTransactionWei: String(RESERVATION), maxDailyWei: String(BigInt(10) * RESERVATION), maxLifetimeWei: String(BigInt(10) * RESERVATION),
    maxGas: 21000, maxFeePerGasWei: "20000000000", maxRegistrationsPerWallet: 10,
    maxRegistrationsPerDay: 10, maxRegistrationsTotal: 10, allowlistedCreators: [A, B], ...overrides };
}
function row(p = policy(), index = 1, creator = A, at = NOW): SponsoredRegistration {
  const canonicalUrl = `https://creator.example/feed-${index}.xml`, urlHash = keccak256(toBytes(canonicalUrl));
  const value: SponsoredRegistration = { id: HASH, policyDigest: keccak256(toBytes("unused")), creator, canonicalUrl, rssUrl: canonicalUrl,
    claimId: keccak256(toBytes(canonicalUrl)).slice(2), claimRevision: 1, sourceId: `source-${index}`,
    onchainId: keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [creator, urlHash])),
    registryAddress: p.registryAddress, registryCodeHash: p.registryCodeHash, relayer: p.sponsorAddress, chainId: p.network === "eip155:5042" ? 5042 : 5042002,
    params: { urlHash, payoutWallet: creator, authors: [{ wallet: creator, basisPoints: 10000 }], fetchPriceUsdc6: "5000", contentCid: "", tags: "engineering" },
    nonce: String(index), deadline: Math.floor(at / 1000) + 600, createdAt: at, updatedAt: at,
    reservedWei: p.maxTransactionWei, state: "prepared" };
  // Importing the production policy digest also exercises the exact policy serialization.
  return finalizePolicyRow(p, value);
}
function finalizePolicyRow(p: RegistrationSponsorPolicy, value: SponsoredRegistration): SponsoredRegistration {
  value.policyDigest = registrationPolicyDigest(p); value.id = registrationIntentDigest(value); return value;
}
function saveClaim(db: DatabaseSync, p: RegistrationSponsorPolicy, request: SponsoredRegistration, overrides: Partial<SourceClaim> = {}): SourceClaim {
  const claim = sourceClaimSchema.parse({ id: request.claimId, canonicalUrl: request.canonicalUrl, rssUrl: request.rssUrl,
    ownerWallet: request.creator, deploymentOrigin: p.deploymentOrigin, network: p.network,
    verifiedAt: new Date(request.createdAt).toISOString(), revision: request.claimRevision, effectiveAt: new Date(request.createdAt).toISOString(),
    mode: "free", distributionPermission: false, proofMethod: "rss-channel", linkedSourceId: request.sourceId,
    onchainId: request.onchainId, registryAddress: request.registryAddress, ...overrides });
  db.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
    .run("keryx:source-claims:v1:claim:" + request.claimId, JSON.stringify(claim), new Date(request.createdAt).toISOString());
  return claim;
}
function fixture(fileBacked = false) {
  const directory = fileBacked ? mkdtempSync(join(tmpdir(), "keryx-registration-sponsor-")) : undefined;
  if (directory) cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const file = directory ? join(directory, "journal.sqlite") : ":memory:";
  const db = new DatabaseSync(file); cleanup.push(() => db.close());
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE sync_state(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)");
  return { db, file };
}
function expectCode(operation: () => unknown, code: string, status = 409) {
  try { operation(); throw new Error("Expected a refusal"); }
  catch (error) { expect(error).toBeInstanceOf(RegistrationSponsorError); expect(error).toMatchObject({ code, status }); }
}

describe("registration sponsor journal", () => {
  it("keeps GET read-only and wallet-bound, and reuses the exact original across connections and restart", () => {
    const { db, file } = fixture(true), p = policy(), request = row(p);
    expect(get(db, { wallet: A, id: request.id })).toBeNull();
    expect(db.prepare("SELECT COUNT(*) n FROM sync_state").get()?.n).toBe(0);
    const original = admit(db, p, { ...request, createdAt: NOW - 1000, updatedAt: NOW - 1000 }, NOW);
    const other = new DatabaseSync(file); cleanup.push(() => other.close());
    expect(admit(other, p, { ...request, createdAt: NOW + 1000, updatedAt: NOW + 1000 }, NOW + 1000)).toEqual(original);
    expect(original.createdAt).toBe(NOW);
    expect(get(other, { wallet: B, id: request.id })).toBeNull();
    expect(get(other, { wallet: A, id: request.id, canonicalUrl: "https://wrong.example/" })).toBeNull();
    expect(get(other, { wallet: A, canonicalUrl: request.canonicalUrl + "#ignored" })).toEqual(original);
    expect(db.prepare("SELECT COUNT(*) n FROM sync_state WHERE key LIKE ?").get(prefix + "row:%")?.n).toBe(1);
  });

  it("rejects changed typed params, claim metadata, or owner for a retained canonical source", () => {
    const { db } = fixture(), p = policy(), original = row(p); admit(db, p, original, NOW);
    for (const changed of [
      { ...original, claimRevision: 2 }, { ...original, sourceId: "replacement" },
      { ...original, params: { ...original.params, fetchPriceUsdc6: "6000" } },
      row(p, 1, B),
    ]) {
      changed.id = registrationIntentDigest(changed);
      expectCode(() => admit(db, p, changed, NOW), "registration_sponsor_original_conflict");
    }
    expect(get(db, { wallet: A, id: original.id })).toEqual(original);
  });

  it("validates the exact digest, payout, chain, source identity, gas reservation, and creator allowlist", () => {
    const { db } = fixture(), p = policy(), original = row(p);
    const candidates = [
      { ...original, id: OTHER_HASH }, { ...original, onchainId: OTHER_HASH }, { ...original, chainId: 5042002 as const },
      { ...original, reservedWei: "1" }, { ...original, params: { ...original.params, payoutWallet: B } },
      { ...original, canonicalUrl: original.canonicalUrl + "#fragment" },
      { ...original, rssUrl: "https://foreign.example/feed.xml" },
      row(p, 2, "0x5555555555555555555555555555555555555555"),
    ];
    for (const value of candidates) expectCode(() => admit(db, p, value, NOW), "registration_sponsor_invalid");
    expect(db.prepare("SELECT COUNT(*) n FROM sync_state").get()?.n).toBe(0);
  });

  it("pins a policy to a stable cohort so changing a cap or expiry cannot reset allowances", () => {
    const { db } = fixture(), p = policy({ maxRegistrationsTotal: 1 }); admit(db, p, row(p), NOW);
    for (const changed of [{ ...p, maxRegistrationsTotal: 2 }, { ...p, expiresAt: p.expiresAt + 1000 }]) {
      expectCode(() => admit(db, changed, row(changed, 2), NOW), "registration_sponsor_policy_changed");
    }
    expectCode(() => admit(db, p, row(p, 2, B), NOW), "registration_sponsor_limit");
  });

  it("reserves daily and lifetime maximum gas before signing, including duplicate admission", () => {
    const { db } = fixture(), p = policy({ maxDailyWei: String(RESERVATION), maxLifetimeWei: String(BigInt(2) * RESERVATION) });
    const original = admit(db, p, row(p), NOW);
    saveClaim(db, p, original);
    expect(admit(db, p, row(p), NOW)).toEqual(original);
    expectCode(() => admit(db, p, row(p, 2, B), NOW), "registration_sponsor_limit");
    transition(db, { wallet: A, id: original.id, expectedState: "prepared", nextState: "signing", transactionNonce: 0, now: NOW });
    transition(db, { wallet: A, id: original.id, expectedState: "signing", nextState: "submitted", transactionHash: HASH, now: NOW });
    transition(db, { wallet: A, id: original.id, expectedState: "submitted", nextState: "confirmed", actualGasWei: String(RESERVATION), now: NOW });
    const tomorrow = NOW + 86_400_000;
    const second = admit(db, p, row(p, 2, B, tomorrow), tomorrow);
    saveClaim(db, p, second);
    transition(db, { wallet: B, id: second.id, expectedState: "prepared", nextState: "signing", transactionNonce: 1, now: tomorrow });
    expectCode(() => admit(db, p, row(p, 3, A, tomorrow + 86_400_000), tomorrow + 86_400_000), "registration_sponsor_limit");
  });

  it("preserves wallet and daily attempt counts after prepared expiry releases only the monetary hold", () => {
    const { db } = fixture(), p = policy({ maxDailyWei: String(RESERVATION), maxRegistrationsPerWallet: 1, maxRegistrationsPerDay: 2 });
    const request = row(p); request.deadline = NOW / 1000 + 1; request.id = registrationIntentDigest(request);
    admit(db, p, request, NOW);
    expectCode(() => transition(db, { wallet: A, id: request.id, expectedState: "prepared", nextState: "expired", now: NOW + 1000 }), "registration_sponsor_conflict");
    expect(transition(db, { wallet: A, id: request.id, expectedState: "prepared", nextState: "expired", now: NOW + 1001 }).state).toBe("expired");
    expectCode(() => admit(db, p, row(p, 2), NOW + 1001), "registration_sponsor_limit");
    admit(db, p, row(p, 2, B), NOW + 1001);
    expectCode(() => admit(db, p, row(p, 3, B), NOW + 1001), "registration_sponsor_creator_busy");
    expect(admit(db, p, request, NOW + 1002).state).toBe("expired");
  });

  it("automatically expires only unsigned originals when admitting another source", () => {
    const { db } = fixture(), p = policy({ maxDailyWei: String(RESERVATION) }), first = row(p);
    first.deadline = NOW / 1000 + 1; first.id = registrationIntentDigest(first); admit(db, p, first, NOW);
    admit(db, p, row(p, 2, B), NOW + 1001);
    expect(get(db, { wallet: A, id: first.id })?.state).toBe("expired");
  });

  it.each(["prepared", "signing", "submitted"] as const)("retains only one active creator nonce while an original is %s", pending => {
    const { db } = fixture(), p = policy(), first = row(p), second = row(p, 2);
    second.nonce = first.nonce; second.id = registrationIntentDigest(second);
    admit(db, p, first, NOW);
    saveClaim(db, p, first);
    if (pending !== "prepared") transition(db, { wallet: A, id: first.id, expectedState: "prepared", nextState: "signing", transactionNonce: 0, now: NOW });
    if (pending === "submitted") transition(db, { wallet: A, id: first.id, expectedState: "signing", nextState: "submitted", transactionHash: HASH, now: NOW });
    expectCode(() => admit(db, p, second, NOW), "registration_sponsor_creator_busy");
    expect(admit(db, p, first, NOW).state).toBe(pending);
    expect(db.prepare("SELECT COUNT(*) n FROM sync_state WHERE key LIKE ?").get(prefix + "row:%")?.n).toBe(1);
  });

  it("lets an expired unsigned creator original unblock a different source without resetting its attempt", () => {
    const { db } = fixture(), p = policy({ maxRegistrationsPerWallet: 2 }), first = row(p);
    first.deadline = NOW / 1000 + 1; first.id = registrationIntentDigest(first); admit(db, p, first, NOW);
    const second = row(p, 2); second.nonce = first.nonce; second.id = registrationIntentDigest(second);
    expect(admit(db, p, second, NOW + 1001).state).toBe("prepared");
    expect(get(db, { wallet: A, id: first.id })?.state).toBe("expired");
    const expiresSecond = second.deadline * 1000 + 1;
    transition(db, { wallet: A, id: second.id, expectedState: "prepared", nextState: "expired", now: expiresSecond });
    expectCode(() => admit(db, p, row(p, 3, A, expiresSecond), expiresSecond), "registration_sponsor_limit");
  });

  it("explicitly renews only the latest conclusively expired unsigned original and retains all attempts", () => {
    const { db } = fixture(), p = policy({ maxRegistrationsPerWallet: 2, maxRegistrationsPerDay: 2 }), first = row(p);
    first.deadline = NOW / 1000 + 1; first.id = registrationIntentDigest(first); admit(db, p, first, NOW);
    transition(db, { wallet: A, id: first.id, expectedState: "prepared", nextState: "expired", now: NOW + 1001 });
    const renewal = row(p, 1, A, NOW + 2000); renewal.replacesRequestId = first.id; renewal.id = registrationIntentDigest(renewal);
    expectCode(() => admit(db, p, renewal, NOW + 1999), "registration_sponsor_renewal_refused");
    expectCode(() => admit(db, p, { ...renewal, replacesRequestId: undefined }, NOW + 2000), "registration_sponsor_original_conflict");
    const second = admit(db, p, renewal, NOW + 2000);
    expect(get(db, { wallet: A, canonicalUrl: first.canonicalUrl })).toEqual(second);
    expect(get(db, { wallet: A, id: first.id })?.state).toBe("expired");
    expect(admit(db, p, first, NOW + 2001).state).toBe("expired");
    const afterSecond = (second.deadline + 1) * 1000;
    transition(db, { wallet: A, id: second.id, expectedState: "prepared", nextState: "expired", now: afterSecond });
    const third = row(p, 1, A, afterSecond); third.replacesRequestId = first.id; third.id = registrationIntentDigest(third);
    expectCode(() => admit(db, p, third, afterSecond), "registration_sponsor_renewal_refused");
    third.replacesRequestId = second.id;
    expectCode(() => admit(db, p, third, afterSecond), "registration_sponsor_limit");
    expect(db.prepare("SELECT COUNT(*) n FROM sync_state WHERE key LIKE ?").get(prefix + "row:%")?.n).toBe(2);
  });

  it.each(["prepared", "signing", "submitted", "confirmed", "reverted"] as const)("never renews a %s original", priorState => {
    const { db } = fixture(), p = policy(), first = admit(db, p, row(p), NOW); saveClaim(db, p, first);
    if (priorState !== "prepared") transition(db, { wallet: A, id: first.id, expectedState: "prepared", nextState: "signing", transactionNonce: 0, now: NOW });
    if (["submitted", "confirmed", "reverted"].includes(priorState)) transition(db, { wallet: A, id: first.id, expectedState: "signing", nextState: "submitted", transactionHash: HASH, now: NOW });
    if (priorState === "confirmed" || priorState === "reverted") transition(db, { wallet: A, id: first.id, expectedState: "submitted", nextState: priorState, actualGasWei: "100", now: NOW });
    const at = priorState === "prepared" ? NOW + 1000 : (first.deadline + 1) * 1000;
    const renewal = row(p, 1, A, at); renewal.replacesRequestId = first.id; renewal.id = registrationIntentDigest(renewal);
    expectCode(() => admit(db, p, renewal, at), "registration_sponsor_renewal_refused");
    expect(get(db, { wallet: A, id: first.id })?.state).toBe(priorState);
  });

  it("refuses orphan or corrupted renewal lineages", () => {
    const { db } = fixture(), p = policy(), request = row(p); request.replacesRequestId = OTHER_HASH;
    expectCode(() => admit(db, p, request, NOW), "registration_sponsor_renewal_refused");
    const first = row(p); first.deadline = NOW / 1000 + 1; first.id = registrationIntentDigest(first); admit(db, p, first, NOW);
    const next = row(p, 1, A, NOW + 2000); next.replacesRequestId = first.id; next.id = registrationIntentDigest(next);
    admit(db, p, next, NOW + 2000);
    const key = prefix + "row:" + next.id, saved = JSON.parse(String(db.prepare("SELECT value FROM sync_state WHERE key=?").get(key)?.value));
    saved.original.replacesRequestId = OTHER_HASH; saved.current.replacesRequestId = OTHER_HASH;
    db.prepare("UPDATE sync_state SET value=? WHERE key=?").run(JSON.stringify(saved), key);
    expectCode(() => get(db, { wallet: A, canonicalUrl: first.canonicalUrl }), "registration_sponsor_unavailable", 503);
  });

  it("rechecks live publishing-control bindings inside sponsor signing admission", () => {
    const { db, file } = fixture(true), p = policy(), original = admit(db, p, row(p), NOW);
    const change = { wallet: A, id: original.id, expectedState: "prepared" as const, nextState: "signing" as const, transactionNonce: 0, now: NOW };
    expectCode(() => transition(db, change), "registration_sponsor_proof_changed");
    for (const changed of [
      { ownerWallet: B }, { revision: 2 }, { canonicalUrl: "https://changed.example/" },
      { rssUrl: "https://creator.example/other.xml" }, { linkedSourceId: "different-source" },
      { onchainId: OTHER_HASH }, { registryAddress: B }, { network: "eip155:5042002" },
      { deploymentOrigin: "https://different.example" }, { verifiedAt: new Date(NOW - 86_400_001).toISOString() },
    ]) {
      saveClaim(db, p, original, changed);
      expectCode(() => transition(db, change), "registration_sponsor_proof_changed");
      expect(get(db, { wallet: A, id: original.id })?.state).toBe("prepared");
    }
    saveClaim(db, p, original);
    const other = new DatabaseSync(file); cleanup.push(() => other.close());
    saveClaim(other, p, original, { revision: 2 });
    expectCode(() => transition(db, change), "registration_sponsor_proof_changed");
    saveClaim(other, p, original, { proofMethod: "website-file" });
    expect(transition(db, change).state).toBe("signing");
  });

  it.each(["signing", "submitted"] as const)("never releases an ambiguous %s original after deadline", uncertain => {
    const { db } = fixture(), p = policy({ maxDailyWei: String(RESERVATION) }), request = row(p);
    request.deadline = NOW / 1000 + 1; request.id = registrationIntentDigest(request); admit(db, p, request, NOW);
    saveClaim(db, p, request);
    transition(db, { wallet: A, id: request.id, expectedState: "prepared", nextState: "signing", transactionNonce: 9, now: NOW });
    if (uncertain === "submitted") transition(db, { wallet: A, id: request.id, expectedState: "signing", nextState: "submitted", transactionHash: HASH, now: NOW });
    expectCode(() => transition(db, { wallet: A, id: request.id, expectedState: uncertain, nextState: "expired", now: NOW + 1001 }), "registration_sponsor_transition_refused");
    expectCode(() => admit(db, p, row(p, 2, B), NOW + 1001), "registration_sponsor_limit");
    expect(get(db, { wallet: A, id: request.id })?.state).toBe(uncertain);
  });

  it("serializes sponsor signing and permanently binds its nonce and transaction hash", () => {
    const { db } = fixture(), p = policy(), first = admit(db, p, row(p), NOW), second = admit(db, p, row(p, 2, B), NOW);
    saveClaim(db, p, first); saveClaim(db, p, second);
    transition(db, { wallet: A, id: first.id, expectedState: "prepared", nextState: "signing", transactionNonce: 8, now: NOW });
    expectCode(() => transition(db, { wallet: B, id: second.id, expectedState: "prepared", nextState: "signing", transactionNonce: 9, now: NOW }), "registration_sponsor_busy");
    expectCode(() => transition(db, { wallet: A, id: first.id, expectedState: "signing", nextState: "submitted", transactionNonce: 9, transactionHash: HASH, now: NOW }), "registration_sponsor_conflict");
    transition(db, { wallet: A, id: first.id, expectedState: "signing", nextState: "submitted", transactionHash: HASH, now: NOW });
    expectCode(() => transition(db, { wallet: B, id: second.id, expectedState: "prepared", nextState: "signing", transactionNonce: 9, now: NOW }), "registration_sponsor_busy");
    transition(db, { wallet: A, id: first.id, expectedState: "submitted", nextState: "confirmed", actualGasWei: "100", now: NOW });
    expectCode(() => transition(db, { wallet: B, id: second.id, expectedState: "prepared", nextState: "signing", transactionNonce: 8, now: NOW }), "registration_sponsor_conflict");
    transition(db, { wallet: B, id: second.id, expectedState: "prepared", nextState: "signing", transactionNonce: 9, now: NOW });
    expectCode(() => transition(db, { wallet: B, id: second.id, expectedState: "signing", nextState: "submitted", transactionHash: HASH, now: NOW }), "registration_sponsor_conflict");
  });

  it("counts reverted receipt gas, limits actual fees, and preserves terminal originals", () => {
    const { db } = fixture(), p = policy({ maxDailyWei: String(RESERVATION + BigInt(100)), maxLifetimeWei: String(RESERVATION + BigInt(100)) });
    const first = admit(db, p, row(p), NOW);
    saveClaim(db, p, first);
    transition(db, { wallet: A, id: first.id, expectedState: "prepared", nextState: "signing", transactionNonce: 0, now: NOW });
    transition(db, { wallet: A, id: first.id, expectedState: "signing", nextState: "submitted", transactionHash: HASH, now: NOW });
    expectCode(() => transition(db, { wallet: A, id: first.id, expectedState: "submitted", nextState: "reverted", actualGasWei: String(RESERVATION + BigInt(1)), now: NOW }), "registration_sponsor_conflict");
    expectCode(() => transition(db, { wallet: A, id: first.id, expectedState: "submitted", nextState: "reverted", transactionHash: OTHER_HASH, actualGasWei: "100", now: NOW }), "registration_sponsor_conflict");
    const terminal = transition(db, { wallet: A, id: first.id, expectedState: "submitted", nextState: "reverted", actualGasWei: "100", now: NOW });
    admit(db, p, row(p, 2, B), NOW);
    expectCode(() => admit(db, p, row(p, 3), NOW), "registration_sponsor_limit");
    for (const nextState of ["prepared", "expired", "confirmed", "reverted"] as const)
      expectCode(() => transition(db, { wallet: A, id: first.id, expectedState: "reverted", nextState, now: NOW }), "registration_sponsor_transition_refused");
    expect(get(db, { wallet: A, id: first.id })).toEqual(terminal);
  });

  it("keeps receipt gas attributed to admission day and allows recovery after policy expiry", () => {
    const { db } = fixture(), p = policy({ maxDailyWei: String(RESERVATION), maxLifetimeWei: String(BigInt(2) * RESERVATION) });
    const original = admit(db, p, row(p), NOW);
    saveClaim(db, p, original);
    transition(db, { wallet: A, id: original.id, expectedState: "prepared", nextState: "signing", transactionNonce: 0, now: NOW });
    const later = p.expiresAt + 1;
    transition(db, { wallet: A, id: original.id, expectedState: "signing", nextState: "submitted", transactionHash: HASH, now: later });
    const terminal = transition(db, { wallet: A, id: original.id, expectedState: "submitted", nextState: "confirmed", actualGasWei: "100", now: later });
    expect(terminal.createdAt).toBe(NOW); expect(get(db, { wallet: A, id: original.id })).toEqual(terminal);
    expectCode(() => admit(db, p, row(p, 2, B, later), later), "registration_sponsor_invalid");
  });

  it("does not move an older receipt fee into the reconciliation day's gas allowance", () => {
    const { db } = fixture(), p = policy({ maxDailyWei: String(RESERVATION), maxLifetimeWei: String(BigInt(2) * RESERVATION) });
    const original = admit(db, p, row(p), NOW);
    saveClaim(db, p, original);
    transition(db, { wallet: A, id: original.id, expectedState: "prepared", nextState: "signing", transactionNonce: 0, now: NOW });
    transition(db, { wallet: A, id: original.id, expectedState: "signing", nextState: "submitted", transactionHash: HASH, now: NOW });
    const tomorrow = NOW + 86_400_000;
    transition(db, { wallet: A, id: original.id, expectedState: "submitted", nextState: "confirmed", actualGasWei: String(RESERVATION), now: tomorrow });
    expect(admit(db, p, row(p, 2, B, tomorrow), tomorrow).state).toBe("prepared");
  });

  it("fails closed at the bounded journal inspection limit", () => {
    const { db } = fixture();
    const insert = db.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?)");
    db.exec("BEGIN IMMEDIATE");
    for (let index = 0; index <= 1000; index++) insert.run(prefix + "row:" + index, "{}", new Date(NOW).toISOString());
    db.exec("COMMIT");
    expectCode(() => get(db, { wallet: A, id: HASH }), "registration_sponsor_unavailable", 503);
  });

  it("refuses foreign owners, skipped transitions, unknown mutation fields, and corrupt retained intent", () => {
    const { db } = fixture(), p = policy(), original = admit(db, p, row(p), NOW);
    expectCode(() => transition(db, { wallet: B, id: original.id, expectedState: "prepared", nextState: "signing", transactionNonce: 0, now: NOW }), "registration_sponsor_original_missing");
    expectCode(() => transition(db, { wallet: A, id: original.id, expectedState: "prepared", nextState: "confirmed", actualGasWei: "1", now: NOW }), "registration_sponsor_transition_refused");
    expectCode(() => transition(db, { wallet: A, id: original.id, expectedState: "prepared", nextState: "signing", transactionNonce: 0, params: original.params, now: NOW } as never), "registration_sponsor_invalid");
    const key = prefix + "row:" + original.id;
    const saved = JSON.parse(String(db.prepare("SELECT value FROM sync_state WHERE key=?").get(key)?.value));
    saved.current.claimRevision = 2; db.prepare("UPDATE sync_state SET value=? WHERE key=?").run(JSON.stringify(saved), key);
    expectCode(() => get(db, { wallet: A, id: original.id }), "registration_sponsor_unavailable", 503);
  });

  it.each(["global allowance", "creator nonce"] as const)("atomically retains the %s boundary across concurrent native connections", async boundary => {
    const { db, file } = fixture(true), p = policy(boundary === "global allowance" ? { maxRegistrationsTotal: 1 } : {});
    const script = `import { DatabaseSync } from 'node:sqlite';
      import { admitSqliteRegistrationSponsor } from ${JSON.stringify(pathToFileURL(resolve("lib/db/registration-sponsor.ts")).href)};
      const db = new DatabaseSync(process.argv[1]); db.exec('PRAGMA busy_timeout=5000');
      try { const row = admitSqliteRegistrationSponsor(db, JSON.parse(process.argv[2]), JSON.parse(process.argv[3]), Number(process.argv[4]));
        process.stdout.write(JSON.stringify({ id: row.id })); }
      catch (error) { process.stdout.write(JSON.stringify({ code: error.code, status: error.status })); }
      finally { db.close(); }`;
    const run = promisify(execFile);
    const results = await Promise.all([row(p), row(p, 2, boundary === "creator nonce" ? A : B)].map(request => run(process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script, file, JSON.stringify(p), JSON.stringify(request), String(NOW)])));
    const outcomes = results.map(result => JSON.parse(result.stdout));
    expect(outcomes.filter(value => value.id)).toHaveLength(1);
    const refusedCode = boundary === "creator nonce" ? "registration_sponsor_creator_busy" : "registration_sponsor_limit";
    expect(outcomes.filter(value => value.code === refusedCode && value.status === 409)).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) n FROM sync_state WHERE key LIKE ?").get(prefix + "row:%")?.n).toBe(1);
  }, 20_000);
});
