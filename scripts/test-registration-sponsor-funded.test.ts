import { expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { execFileSync, spawnSync } from "node:child_process";
import { keccak256 } from "viem";
import { fundedFixturePolicySchema, fundedFixtureOriginal, fundedFixtureClaim, fundedCanonicalUrl, initializeFundedFixture,
  acquireFundedFixtureLock, captureFundedSourceBinding, verifyFundedSourceBinding, fundedRegistryAuthority,
  TESTNET_CREATOR, TESTNET_SPONSOR, type FundedFixturePolicy } from "./test-registration-sponsor-funded.mjs";
import { admitSqliteRegistrationSponsor, getSqliteRegistrationSponsor, transitionSqliteRegistrationSponsor } from "../lib/db/registration-sponsor";

const now = 1_800_000_000_000;
function fixture(): FundedFixturePolicy {
  return { format: "keryx-registration-sponsor-funded-acceptance-v1", sourceCommit: "a".repeat(40), runId: "b697b2ee-af3b-4d5b-9566-aa2909f965c7",
    creator: TESTNET_CREATOR, claimEvidence: "controlled-testnet-fixture", sponsorKeyField: "AGENT_FUNDER_PRIVATE_KEY", creatorKeyField: "SELLER_PRIVATE_KEY",
    policy: { protocol: "keryx-registration-sponsor-v1", network: "eip155:5042002", deploymentOrigin: "https://registration-sponsor-funded.test.invalid",
      registryAddress: "0x75403cf34cedf107735209abdd1ecd111d5e10b3", registryCodeHash: keccak256("0x6000"), sponsorAddress: TESTNET_SPONSOR,
      expiresAt: now + 86400000, maxTransactionWei: "40000000000000000", maxDailyWei: "160000000000000000", maxLifetimeWei: "160000000000000000",
      maxGas: 1000000, maxFeePerGasWei: "40000000000", maxRegistrationsPerWallet: 5, maxRegistrationsPerDay: 5, maxRegistrationsTotal: 5,
      allowlistedCreators: [TESTNET_CREATOR] } };
}
it("refuses mainnet, swapped existing custody, unlabelled publisher claims and enlarged caps", () => {
  const value = fixture(); expect(fundedFixturePolicySchema.parse(value)).toEqual(value);
  for (const mutate of [(copy: FundedFixturePolicy) => { copy.policy.network = "eip155:5042"; },
    (copy: FundedFixturePolicy) => { copy.policy.sponsorAddress = TESTNET_CREATOR; },
    (copy: FundedFixturePolicy) => { copy.policy.maxLifetimeWei = "200000000000000000"; },
    (copy: FundedFixturePolicy) => { copy.policy.allowlistedCreators = [TESTNET_SPONSOR]; },
    (copy: FundedFixturePolicy) => { copy.policy.maxRegistrationsTotal = 6; }]) {
    const copy = structuredClone(value); mutate(copy); expect(() => fundedFixturePolicySchema.parse(copy)).toThrow();
  }
  expect(() => fundedFixturePolicySchema.parse({ ...value, claimEvidence: "real-publisher" })).toThrow();
});
it("binds fixture canonical URL, creator/payTo, exact policy and deterministic original digest", () => {
  const manifest = fixture(), row = fundedFixtureOriginal(manifest, "normal", BigInt(2), now), claim = fundedFixtureClaim(row, now);
  expect(row).toMatchObject({ creator: TESTNET_CREATOR, relayer: TESTNET_SPONSOR, chainId: 5042002, nonce: "2", params: { payoutWallet: TESTNET_CREATOR, authors: [{ wallet: TESTNET_CREATOR, basisPoints: 10000 }] } });
  expect(row.canonicalUrl).toBe(fundedCanonicalUrl(manifest, "normal")); expect(new URL(row.canonicalUrl).hostname).toMatch(/\.invalid$/);
  expect(claim).toMatchObject({ ownerWallet: TESTNET_CREATOR, linkedSourceId: row.sourceId, onchainId: row.onchainId, registryAddress: manifest.policy.registryAddress, distributionPermission: false });
  expect(fundedFixtureOriginal(manifest, "normal", BigInt(2), now).id).toBe(row.id);
  expect(fundedFixtureOriginal(manifest, "raw-interrupt", BigInt(2), now).id).not.toBe(row.id);
  expect(fundedFixtureOriginal(manifest, "expired-original", BigInt(2), now).deadline).toBe(Math.floor(now / 1000) + 60);
});
it("allows stale process-lock recovery only through explicit same-scenario resume", () => {
  const db = new DatabaseSync(":memory:");
  try {
    initializeFundedFixture(db, fixture(), captureFundedSourceBinding()); acquireFundedFixtureLock(db, "raw-interrupt", false, 111, "fixture-host", () => false);
    expect(() => acquireFundedFixtureLock(db, "raw-interrupt", false, 222, "fixture-host", () => false)).toThrow();
    expect(() => acquireFundedFixtureLock(db, "normal", true, 222, "fixture-host", () => false)).toThrow();
    expect(() => acquireFundedFixtureLock(db, "raw-interrupt", true, 222, "foreign-host", () => false)).toThrow();
    expect(() => acquireFundedFixtureLock(db, "raw-interrupt", true, 222, "fixture-host", () => true)).toThrow();
    acquireFundedFixtureLock(db, "raw-interrupt", true, 222, "fixture-host", () => false);
    expect(db.prepare("SELECT pid FROM fixture_lock").get()?.pid).toBe(222);
    expect(() => db.exec("UPDATE fixture_manifest SET value='changed'")).toThrow();
  } finally { db.close(); }
});
it("keeps the fifth-attempt money gate at 0.16 while allowing actual receipts to release maximum holds", () => {
  const db = new DatabaseSync(":memory:"), manifest = fixture();
  try {
    initializeFundedFixture(db, manifest, captureFundedSourceBinding());
    let row = fundedFixtureOriginal(manifest, "normal", BigInt(0), now);
    admitSqliteRegistrationSponsor(db, manifest.policy, row, now);
    db.prepare("INSERT INTO sync_state VALUES(?,?,?)").run("keryx:source-claims:v1:claim:" + row.claimId, JSON.stringify(fundedFixtureClaim(row, now)), new Date(now).toISOString());
    // Journal transition evidence is synthetic in this unit test, never financial acceptance.
    row = transitionSqliteRegistrationSponsor(db, { wallet: TESTNET_CREATOR, id: row.id, expectedState: "prepared", nextState: "signing", transactionNonce: 132, now });
    row = transitionSqliteRegistrationSponsor(db, { wallet: TESTNET_CREATOR, id: row.id, expectedState: "signing", nextState: "submitted", transactionHash: `0x${"a".repeat(64)}`, now });
    row = transitionSqliteRegistrationSponsor(db, { wallet: TESTNET_CREATOR, id: row.id, expectedState: "submitted", nextState: "confirmed", actualGasWei: "1000", now });
    expect(getSqliteRegistrationSponsor(db, { wallet: TESTNET_CREATOR, id: row.id })?.actualGasWei).toBe("1000");
    expect(getSqliteRegistrationSponsor(db, { wallet: TESTNET_SPONSOR, id: row.id })).toBeNull();
    const later = fundedFixtureOriginal(manifest, "authorization-interrupt", BigInt(1), now + 1);
    expect(admitSqliteRegistrationSponsor(db, manifest.policy, later, now + 1).reservedWei).toBe("40000000000000000");
    expect(() => admitSqliteRegistrationSponsor(db, { ...manifest.policy, maxLifetimeWei: "200000000000000000" }, later, now + 1)).toThrow();
  } finally { db.close(); }
});
it("pins actual source closure, runtime, tree/commit and every retained file before resumed work", () => {
  const original = captureFundedSourceBinding(); expect(verifyFundedSourceBinding(original, original).acceptedCiClaimed).toBe(false);
  expect(Object.keys(original.files)).toContain("scripts/test-registration-sponsor-funded.mts");
  expect(Object.keys(original.files)).toContain("lib/db/indexer.ts");
  expect(Object.keys(original.files)).toContain("package-lock.json");
  const edited = structuredClone(original); edited.files["scripts/test-registration-sponsor-funded.mts"] = "f".repeat(64);
  expect(() => verifyFundedSourceBinding(original, edited)).toThrow();
  expect(() => verifyFundedSourceBinding(original, { ...original, headCommit: "f".repeat(40) })).toThrow();
  expect(() => verifyFundedSourceBinding(original, { ...original, runtimeNode: "changed-runtime" })).toThrow();
  expect(fundedRegistryAuthority(fixture())).toEqual({ network: "eip155:5042002", address: fixture().policy.registryAddress,
    version: 3, codeHash: fixture().policy.registryCodeHash, deployBlock: "66758711" });
});
it("help is keyless and unknown credentials/flags cannot become an execution path", () => {
  const help = execFileSync(process.execPath, ["--import", "tsx", "scripts/test-registration-sponsor-funded.mts", "--help"], { encoding: "utf8" });
  expect(help).toContain("never mainnet"); expect(help).toContain("report is keyless/read-only");
  const denied = spawnSync(process.execPath, ["--import", "tsx", "scripts/test-registration-sponsor-funded.mts", "mainnet", "--private-key", "private-marker"], { encoding: "utf8" });
  expect(denied.status).toBe(2); expect(denied.stdout).toBe(""); expect(denied.stderr).not.toContain("private-marker");
});
