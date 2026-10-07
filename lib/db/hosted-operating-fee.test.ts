import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { canonicalJson } from "../canonical-json";
import { STORAGE_MAINNET_PROFILE_DIGEST, storageIdentityDigest, type StorageIdentity } from "./storage-identity";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { admitSqliteHostedAuthorization, admitSqliteHostedPolicy, confirmSqliteHostedAuthorization,
  sqliteHostedAccounting, submitSqliteHostedAuthorization, terminalSqliteHostedAuthorization,
  hostedPaymentContextSchema, type HostedAuthorizationAdmission } from "./hosted-treasury-journal";
import { hostedTreasuryPolicyDigest, type HostedTreasuryPolicy } from "../payments/hosted-treasury-policy";
import { operatingFeePolicyDigest, OPERATING_FEE_SOURCE_ID, type OperatingFeePolicy } from "../payments/operating-fee-policy";
import type { TypedDataPayload } from "../session/session-signer-protocol";
import { admitSqliteSourceClaimPurchasePolicy, issueSqliteSourceClaimChallenge, verifySqliteSourceClaim } from "./public-source-claims";
import { sqliteJournalTransaction } from "./sqlite-browser-journal";
import { operatingFeeRequestHash, OPERATING_FEE_POLICY_KEY_PREFIX } from "../payments/operating-fee-policy";
import { config } from "../config";

const signer = `0x${"11".repeat(20)}`, beneficiary = `0x${"22".repeat(20)}`;
const fixtures: DatabaseSync[] = [];
afterEach(() => { for (const db of fixtures.splice(0)) db.close(); vi.unstubAllEnvs(); vi.useRealTimers(); });
function fixture(role: "public" | "private" = "public") {
  const db = new DatabaseSync(":memory:"); fixtures.push(db); installMainnetApplicationSchema(db);
  const identity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real",
    network: ARC_MAINNET_PROFILE.networkId, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST,
    deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(),
    enrolledAt: new Date().toISOString(), provenanceDigest: "aa".repeat(32) };
  const policy: HostedTreasuryPolicy = { format: "keryx-hosted-treasury-policy-v1", network: "eip155:5042",
    storageIdentityDigest: storageIdentityDigest(identity), origin: "https://keryx.cc", signer,
    lifetimeCapMicroUsdc: "100000", queryCapMicroUsdc: "50000", expiresAtSeconds: Math.floor(Date.now() / 1000) + 3600 };
  const feePolicy: OperatingFeePolicy = { format: "keryx-operating-fee-policy-v1", network: "eip155:5042",
    storageIdentityDigest: storageIdentityDigest(identity), origin: policy.origin, beneficiary, expiresAtSeconds: policy.expiresAtSeconds };
  selectFeePolicy(feePolicy); admitSqliteHostedPolicy(db, policy, identity, role);
  return { db, identity, policy, feePolicy };
}
function selectFeePolicy(policy: OperatingFeePolicy) {
  vi.stubEnv("KERYX_OPERATING_FEE_POLICY_JSON", canonicalJson(policy));
  vi.stubEnv("KERYX_OPERATING_FEE_POLICY_DIGEST", operatingFeePolicyDigest(policy));
}
function admission(value: ReturnType<typeof fixture>, amount = "25000", queryId: string = randomUUID()): HostedAuthorizationAdmission {
  const now = Math.floor(Date.now() / 1000);
  const payload: TypedDataPayload = { domain: { name: "GatewayWalletBatched", version: "1", chainId: ARC_MAINNET_PROFILE.chainId,
    verifyingContract: ARC_MAINNET_PROFILE.gatewayWallet }, primaryType: "TransferWithAuthorization", types: { TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    ] }, message: { from: value.policy.signer, to: value.feePolicy.beneficiary, value: amount,
      validAfter: String(now - 600), validBefore: String(now + 604900), nonce: "0x" + randomBytes(32).toString("hex") } };
  return { policy: value.policy, context: { queryId, kind: "operating-fee", sourceId: OPERATING_FEE_SOURCE_ID,
    itemId: null, privateJob: null, queryBudgetMicroUsdc: "50000", operatingFee: {
      policyDigest: operatingFeePolicyDigest(value.feePolicy), allocationDigest: "bb".repeat(32), amountMicroUsdc: amount,
      sourceUrls: ["https://publisher.example/article"] } },
    payload, accounting: sqliteHostedAccounting(value.db, value.policy.signer), availableMicroUsdc: "1000000" };
}
function count(db: DatabaseSync) { return db.prepare("SELECT COUNT(*) n FROM hosted_treasury_authorizations").get()?.n; }
function submit(value: ReturnType<typeof fixture>, input: HostedAuthorizationAdmission, nonce: string) {
  submitSqliteHostedAuthorization(value.db, value.policy.signer, { authorizationId: nonce,
    authorizationExpiresAt: new Date(Number(input.payload.message.validBefore) * 1000).toISOString(), payer: value.policy.signer,
    payee: value.feePolicy.beneficiary, amountMicros: String(input.payload.message.value), network: ARC_MAINNET_PROFILE.networkId,
    asset: ARC_MAINNET_PROFILE.usdcAddress.toLowerCase() }, "0x" + "cc".repeat(32));
}

it("retains sponsored operating fees in the existing public journal and confirms only the same submitted original", () => {
  const value = fixture(), input = admission(value), nonce = admitSqliteHostedAuthorization(value.db, input, value.identity);
  expect(value.db.prepare("SELECT kind,source_id,settled,authorization_phase FROM payment_events WHERE authorization_id=?").get(nonce))
    .toEqual({ kind: "operating-fee", source_id: OPERATING_FEE_SOURCE_ID, settled: 0, authorization_phase: "prepared" });
  expect(sqliteHostedAccounting(value.db, signer)).toEqual({ retainedMicroUsdc: "25000", confirmedMicroUsdc: "0" });
  expect(() => confirmSqliteHostedAuthorization(value.db, signer, nonce, "synthetic-settlement")).toThrow();
  submit(value, input, nonce); confirmSqliteHostedAuthorization(value.db, signer, nonce, "synthetic-settlement");
  expect(sqliteHostedAccounting(value.db, signer)).toEqual({ retainedMicroUsdc: "25000", confirmedMicroUsdc: "25000" });
  expect(() => confirmSqliteHostedAuthorization(value.db, signer, nonce, "different-settlement")).toThrow();
  expect(count(value.db)).toBe(1);
});

it.each(["prepared", "pending", "settled", "failed"])("refuses a second fee for an existing %s original and keeps its lifetime exposure", state => {
  const value = fixture(), input = admission(value), nonce = admitSqliteHostedAuthorization(value.db, input, value.identity);
  if (state !== "prepared") submit(value, input, nonce);
  if (state === "settled") confirmSqliteHostedAuthorization(value.db, signer, nonce, "synthetic-settlement");
  if (state === "failed") terminalSqliteHostedAuthorization(value.db, "x402:" + nonce, nonce, "synthetic-failure", true);
  const renewed = { ...value.policy, expiresAtSeconds: value.policy.expiresAtSeconds + 100 };
  admitSqliteHostedPolicy(value.db, renewed, value.identity, "public");
  const next = admission({ ...value, policy: renewed }, "25000", input.context.queryId);
  expect(() => admitSqliteHostedAuthorization(value.db, next, value.identity)).toThrow("already admitted");
  const replacement = { ...renewed, signer: `0x${"44".repeat(20)}` };
  admitSqliteHostedPolicy(value.db, replacement, value.identity, "public");
  const replaced = admission({ ...value, policy: replacement }, "25000", input.context.queryId);
  expect(() => admitSqliteHostedAuthorization(value.db, replaced, value.identity)).toThrow("already admitted");
  expect(count(value.db)).toBe(1); expect(sqliteHostedAccounting(value.db, signer).retainedMicroUsdc).toBe("25000");
});

it("refuses a changed beneficiary or expiry policy between allocation and financial admission", () => {
  const value = fixture(), input = admission(value);
  selectFeePolicy({ ...value.feePolicy, beneficiary: `0x${"33".repeat(20)}` });
  expect(() => admitSqliteHostedAuthorization(value.db, input, value.identity)).toThrow("terms refused");
  selectFeePolicy({ ...value.feePolicy, expiresAtSeconds: value.feePolicy.expiresAtSeconds + 1 });
  expect(() => admitSqliteHostedAuthorization(value.db, input, value.identity)).toThrow("terms refused");
  expect(count(value.db)).toBe(0);
});

it.each(["private", "missing-policy", "self-payee", "wrong-payee", "amount-mismatch", "over-pool", "private-context", "creator-claim", "wrong-source"])("refuses %s fee admission without retaining a nonce or payment", failure => {
  const value = fixture(failure === "private" ? "private" : "public"), input = admission(value);
  if (failure === "missing-policy") vi.stubEnv("KERYX_OPERATING_FEE_POLICY_JSON", "");
  if (failure === "self-payee") selectFeePolicy({ ...value.feePolicy, beneficiary: value.policy.signer });
  if (failure === "wrong-payee") input.payload.message.to = `0x${"33".repeat(20)}`;
  if (failure === "amount-mismatch") input.payload.message.value = "1";
  if (failure === "over-pool") { input.payload.message.value = "25001"; if (input.context.kind === "operating-fee") input.context.operatingFee = { ...input.context.operatingFee, amountMicroUsdc: "25001" }; }
  if (failure === "private-context") Object.assign(input.context, { privateJob: { id: "job", owner: beneficiary, workerId: "worker" } });
  if (failure === "creator-claim") Object.assign(input.context, { sourceClaim: { id: "dd".repeat(32), revision: 1, mode: "paid", effectiveAt: new Date().toISOString(), verifiedAt: new Date().toISOString() } });
  if (failure === "wrong-source") Object.assign(input.context, { sourceId: "public:publisher" });
  expect(() => admitSqliteHostedAuthorization(value.db, input, value.identity)).toThrow();
  expect(count(value.db)).toBe(0); expect(value.db.prepare("SELECT COUNT(*) n FROM payment_events").get()?.n).toBe(0);
});

it("preserves query, lifetime and observed prefunding bounds for service admission", () => {
  const value = fixture();
  const insufficient = admission(value); insufficient.availableMicroUsdc = "24999";
  expect(() => admitSqliteHostedAuthorization(value.db, insufficient, value.identity)).toThrow("capacity refused");
  const oversized = admission(value); oversized.context.queryBudgetMicroUsdc = "50001";
  expect(() => admitSqliteHostedAuthorization(value.db, oversized, value.identity)).toThrow("Hosted authority refused");
  for (let i = 0; i < 4; i++) admitSqliteHostedAuthorization(value.db, admission(value), value.identity);
  expect(() => admitSqliteHostedAuthorization(value.db, admission(value), value.identity)).toThrow("capacity refused");
  expect(sqliteHostedAccounting(value.db, signer)).toEqual({ retainedMicroUsdc: "100000", confirmedMicroUsdc: "0" });
});

it("keeps creator admission independent of fee configuration and preserves its exact context", () => {
  const value = fixture(), input = admission(value, "50000"); vi.stubEnv("KERYX_OPERATING_FEE_POLICY_JSON", "");
  input.context = { queryId: input.context.queryId, kind: "citation", sourceId: "legacy-creator", itemId: null,
    privateJob: null, queryBudgetMicroUsdc: "50000" };
  const parsed = hostedPaymentContextSchema.parse(input.context);
  expect(parsed).toEqual(input.context);
  const nonce = admitSqliteHostedAuthorization(value.db, input, value.identity);
  const retained = JSON.parse(String(value.db.prepare("SELECT original FROM hosted_treasury_authorizations WHERE nonce=?").get(nonce)?.original));
  expect(retained.context).toEqual(input.context);
  expect(value.db.prepare("SELECT policy_digest FROM hosted_treasury_authorizations WHERE nonce=?").get(nonce)?.policy_digest).toBe(hostedTreasuryPolicyDigest(value.policy));
});

it.each(["current", "missing-current", "corrupt-current"])("checks a %s owner claim in the same writer transaction before fee reservation", state => {
  const value = fixture(), input = admission(value), challenge = issueSqliteSourceClaimChallenge(value.db, { canonicalUrl: "https://publisher.example/article",
    wallet: beneficiary, deploymentOrigin: value.policy.origin, network: value.policy.network });
  const claim = verifySqliteSourceClaim(value.db, { challengeId: challenge.id, wallet: beneficiary, proofDigest: "ee".repeat(32) });
  if (state === "missing-current") value.db.prepare("DELETE FROM sync_state WHERE key=?").run("keryx:source-claims:v1:claim:" + claim.id);
  if (state === "corrupt-current") value.db.prepare("UPDATE sync_state SET value=? WHERE key=?").run("{}", "keryx:source-claims:v1:claim:" + claim.id);
  expect(() => admitSqliteHostedAuthorization(value.db, input, value.identity)).toThrow();
  expect(count(value.db)).toBe(0);
  expect(value.db.prepare("SELECT COUNT(*) n FROM sync_state WHERE key LIKE ?").get(OPERATING_FEE_POLICY_KEY_PREFIX + "%")?.n).toBe(0);
});

function sellerInput(input: HostedAuthorizationAdmission, nonce: string) {
  if (input.context.kind !== "operating-fee") throw new Error("Expected fee fixture");
  return { identity: { network: input.policy.network, payer: input.policy.signer, authorizationId: nonce }, existing: false,
    sourceId: OPERATING_FEE_SOURCE_ID, kind: "operating-fee" as const, payee: String(input.payload.message.to).toLowerCase(),
    amountMicros: Number(input.payload.message.value), requestHash: operatingFeeRequestHash(input.context.queryId, input.context.operatingFee) };
}

it("admits only the exact fee seller resource and retains its original policy across configuration and claim changes", () => {
  const value = fixture(), input = admission(value), nonce = admitSqliteHostedAuthorization(value.db, input, value.identity), seller = sellerInput(input, nonce);
  const originalBaseUrl = config.baseUrl;
  try {
    Object.assign(config, { baseUrl: value.policy.origin });
    expect(() => sqliteJournalTransaction(value.db, () => admitSqliteSourceClaimPurchasePolicy(value.db, seller))).toThrow();
    submit(value, input, nonce);
    sqliteJournalTransaction(value.db, () => admitSqliteSourceClaimPurchasePolicy(value.db, seller));
    selectFeePolicy({ ...value.feePolicy, beneficiary: `0x${"33".repeat(20)}` });
    const challenge = issueSqliteSourceClaimChallenge(value.db, { canonicalUrl: "https://publisher.example/article", wallet: beneficiary,
      deploymentOrigin: value.policy.origin, network: value.policy.network });
    verifySqliteSourceClaim(value.db, { challengeId: challenge.id, wallet: beneficiary, proofDigest: "ee".repeat(32) });
    expect(() => sqliteJournalTransaction(value.db, () => admitSqliteSourceClaimPurchasePolicy(value.db, { ...seller, existing: true }))).not.toThrow();
    expect(count(value.db)).toBe(1);
  } finally { Object.assign(config, { baseUrl: originalBaseUrl }); }
});

it.each(["absent-original", "wrong-amount", "wrong-payee", "wrong-resource", "wrong-request-hash", "missing-request-hash", "missing-policy", "changed-retained-policy", "foreign-origin"])("refuses %s operating seller admission before retaining purchase policy", failure => {
  const value = fixture(), input = admission(value), nonce = admitSqliteHostedAuthorization(value.db, input, value.identity), seller = sellerInput(input, nonce);
  submit(value, input, nonce); const originalBaseUrl = config.baseUrl;
  try {
    Object.assign(config, { baseUrl: failure === "foreign-origin" ? "https://foreign.example" : value.policy.origin });
    if (failure === "absent-original") seller.identity.authorizationId = "0x" + "ff".repeat(32);
    if (failure === "wrong-amount") seller.amountMicros = 1;
    if (failure === "wrong-payee") seller.payee = `0x${"33".repeat(20)}`;
    if (failure === "wrong-resource") seller.sourceId = "public:publisher";
    if (failure === "wrong-request-hash") seller.requestHash = "ff".repeat(32);
    if (failure === "missing-request-hash") Object.assign(seller, { requestHash: undefined });
    if (failure === "missing-policy") value.db.prepare("DELETE FROM sync_state WHERE key LIKE ?").run(OPERATING_FEE_POLICY_KEY_PREFIX + "%");
    if (failure === "changed-retained-policy") value.db.prepare("UPDATE sync_state SET value=? WHERE key LIKE ?")
      .run(canonicalJson({ ...value.feePolicy, beneficiary: `0x${"33".repeat(20)}` }), OPERATING_FEE_POLICY_KEY_PREFIX + "%");
    expect(() => sqliteJournalTransaction(value.db, () => admitSqliteSourceClaimPurchasePolicy(value.db, seller))).toThrow();
    expect(value.db.prepare("SELECT COUNT(*) n FROM sync_state WHERE key LIKE '%purchase-policy:%'").get()?.n).toBe(0);
    expect(count(value.db)).toBe(1);
  } finally { Object.assign(config, { baseUrl: originalBaseUrl }); }
});
