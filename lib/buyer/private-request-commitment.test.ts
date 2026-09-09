import { createHash, randomBytes } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { verifyTypedData } from "viem";
import { BUYER_GATEWAY, BUYER_NETWORK, BUYER_USDC, buyerRequestSchema, buyerTypedData } from "./protocol";
import { createPrivateAuthorization, matchesPrivateRequestCommitment, privateRequestCommitmentInput, privateRequestNonce } from "./private-request-commitment";

export const request = { question: "What evidence supports this claim?", budget: 0.03, researchMode: "deep", packageVersion: "1.0.0", responseMode: "async", access: "payer-private-v1", model: null };
export const payer = `0x${"1".repeat(40)}`, payee = `0x${"2".repeat(40)}`;
export const requirement = { scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC, amount: "50000", payTo: payee, maxTimeoutSeconds: 604860, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } };
export const terms = { from: payer, to: payee, value: "50000", validAfter: "1788911400", validBefore: "1789516860" };
export const salt = `0x${"3".repeat(64)}`;
afterEach(() => vi.unstubAllGlobals());

it("matches independent Node hashing and normalizes only declared aliases", async () => {
  const canonical = privateRequestCommitmentInput(request, requirement, terms, salt);
  const nonce = await privateRequestNonce(request, requirement, terms, salt);
  expect(nonce).toBe("0x4f81a6cb31fd90eb1584353253aa81f135a3cd553f9c0402d4aafa8db4ef6421");
  expect(nonce).toBe(`0x${createHash("sha256").update(canonical).digest("hex")}`);
  expect(await privateRequestNonce({ ...request, question: `  ${request.question}  ` }, requirement, terms, salt)).toBe(nonce);
  expect(await privateRequestNonce(request, { ...requirement, payTo: payee.toUpperCase().replace("0X", "0x") }, terms, salt)).toBe(nonce);
  expect(buyerRequestSchema.safeParse(request).success).toBe(false); // Legacy clients cannot silently send private requests.
});

it("binds question, model, budget, package, payer, merchant, price, time and salt", async () => {
  const nonce = await privateRequestNonce(request, requirement, terms, salt);
  const auth = { ...terms, nonce };
  expect(await matchesPrivateRequestCommitment(request, requirement, auth, salt)).toBe(true);
  for (const changed of [{ ...request, question: "Different question" }, { ...request, model: "other/model" }, { ...request, budget: 0.02 }, { ...request, researchMode: "quick" }]) {
    expect(await matchesPrivateRequestCommitment(changed, requirement, auth, salt)).toBe(false);
  }
  expect(await matchesPrivateRequestCommitment({ ...request, access: "public" }, requirement, auth, salt)).toBe(false);
  expect(await matchesPrivateRequestCommitment({ ...request, extra: "ignored fields are forbidden" }, requirement, auth, salt)).toBe(false);
  expect(await matchesPrivateRequestCommitment(request, requirement, { ...auth, from: payee }, salt)).toBe(false);
  expect(await matchesPrivateRequestCommitment(request, { ...requirement, payTo: payer }, { ...auth, to: payer }, salt)).toBe(false);
  expect(await matchesPrivateRequestCommitment(request, { ...requirement, amount: "60000" }, { ...auth, value: "60000" }, salt)).toBe(false);
  expect(await matchesPrivateRequestCommitment(request, requirement, { ...auth, validAfter: "1788911401", validBefore: "1789516861" }, salt)).toBe(false);
  expect(await matchesPrivateRequestCommitment(request, requirement, auth, `0x${"4".repeat(64)}`)).toBe(false);
  expect(await matchesPrivateRequestCommitment(request, { ...requirement, network: "eip155:5042" }, auth, salt)).toBe(false);
  expect(await matchesPrivateRequestCommitment(request, requirement, { ...auth, validAfter: "01788911400" }, salt)).toBe(false);
});

it("creates fresh nonces, refuses a wrong merchant and refuses unavailable secure randomness", async () => {
  const first = await createPrivateAuthorization(request, requirement, payer, payee, 1788912000000);
  const second = await createPrivateAuthorization(request, requirement, payer, payee, 1788912000000);
  expect(first.salt).not.toBe(second.salt); expect(first.authorization.nonce).not.toBe(second.authorization.nonce);
  expect(await matchesPrivateRequestCommitment(first.request, requirement, first.authorization, first.salt)).toBe(true);
  await expect(createPrivateAuthorization(request, requirement, payer, payer)).rejects.toThrow("trusted merchant");
  vi.stubGlobal("crypto", undefined);
  await expect(createPrivateAuthorization(request, requirement, payer, payee)).rejects.toThrow();
  expect(await matchesPrivateRequestCommitment(first.request, requirement, first.authorization, first.salt)).toBe(false);
});

it("requires a new EIP-712 signature if a caller recomputes the nonce for changed research", async () => {
  // Disposable key remains in memory, never persisted, funded or sent to any network.
  const account = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}`);
  const original = await createPrivateAuthorization(request, requirement, account.address, payee, 1788912000000);
  const typed = buyerTypedData(original.authorization);
  const signature = await account.signTypedData(typed);
  expect(await verifyTypedData({ ...typed, address: account.address, signature })).toBe(true);
  const { nonce: _old, ...originalTerms } = original.authorization;
  const changedNonce = await privateRequestNonce({ ...request, question: "Altered research" }, requirement, originalTerms, original.salt);
  expect(await verifyTypedData({ ...buyerTypedData({ ...original.authorization, nonce: changedNonce }), address: account.address, signature })).toBe(false);
});
