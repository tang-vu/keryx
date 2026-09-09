import { afterEach, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { BUYER_GATEWAY, BUYER_NETWORK, BUYER_USDC, buyerTypedData } from "../buyer/protocol";
import { createPrivateAuthorization, privateRequestNonce } from "../buyer/private-request-commitment";
import { verifyPrivateResearchSubmission } from "./private-request-verification";

const now = 1788912000000;
const privatePayee = `0x${"ab".repeat(20)}`;
const publicResearchPayee = `0x${"cd".repeat(20)}`;
const merchants = { privatePayee, publicResearchPayee };
const requirement = {
  scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC,
  amount: "50000", payTo: privatePayee, maxTimeoutSeconds: 604860,
  extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY },
};
const request = {
  question: "What evidence supports this claim?", budget: 0.03, researchMode: "quick",
  packageVersion: "1.0.0", responseMode: "async", access: "payer-private-v1", model: null,
};

async function signedFixture() {
  // Disposable in-memory key; no wallet file, network, funds or reusable authorization.
  const account = privateKeyToAccount(generatePrivateKey());
  const intent = await createPrivateAuthorization(request, requirement, account.address, merchants, now);
  const signature = await account.signTypedData(buyerTypedData(intent.authorization));
  const submission = { request: intent.request, salt: intent.salt, payment: { authorization: intent.authorization, signature } };
  return { account, submission };
}
afterEach(() => vi.unstubAllGlobals());

it("verifies the signed payer locally without consulting a wallet, RPC or facilitator", async () => {
  const fetch = vi.fn(() => { throw new Error("Network forbidden"); });
  vi.stubGlobal("fetch", fetch);
  const { account, submission } = await signedFixture();
  const verified = await verifyPrivateResearchSubmission(submission, requirement, merchants);
  expect(verified).toEqual({ ...submission, payer: account.address.toLowerCase() });
  expect(fetch).not.toHaveBeenCalled();
  // Case aliases are canonical, including addresses that actually contain letters.
  expect(await verifyPrivateResearchSubmission(submission, {
    ...requirement, payTo: `0x${"AB".repeat(20)}`,
  }, merchants)).not.toBeNull();
});

it("rejects untrusted request changes even if the attacker recomputes the commitment", async () => {
  const { submission } = await signedFixture();
  for (const altered of [
    { ...submission.request, question: "Replace the requested research" },
    { ...submission.request, budget: 0.02 },
    { ...submission.request, researchMode: "deep" },
    { ...submission.request, model: "other/model" },
  ]) {
    expect(await verifyPrivateResearchSubmission({ ...submission, request: altered }, requirement, merchants)).toBeNull();
    const { nonce: _old, ...terms } = submission.payment.authorization;
    const nonce = await privateRequestNonce(altered, requirement, terms, submission.salt);
    const forged = { ...submission, request: altered, payment: { ...submission.payment, authorization: { ...terms, nonce } } };
    expect(await verifyPrivateResearchSubmission(forged, requirement, merchants)).toBeNull();
  }
});

it("rejects substituted payer identity and a different EOA signature", async () => {
  const { submission } = await signedFixture();
  const attacker = privateKeyToAccount(generatePrivateKey());
  const signature = await attacker.signTypedData(buyerTypedData(submission.payment.authorization));
  expect(await verifyPrivateResearchSubmission({ ...submission, payment: { ...submission.payment, signature } }, requirement, merchants)).toBeNull();
  const { nonce: _old, ...originalTerms } = submission.payment.authorization;
  const terms = { ...originalTerms, from: attacker.address };
  const nonce = await privateRequestNonce(request, requirement, terms, submission.salt);
  expect(await verifyPrivateResearchSubmission({ ...submission, payment: {
    ...submission.payment, authorization: { ...terms, nonce },
  } }, requirement, merchants)).toBeNull();
});

it("rejects a valid signature for another chain or domain", async () => {
  const { account, submission } = await signedFixture();
  const typed = buyerTypedData(submission.payment.authorization);
  for (const domain of [{ ...typed.domain, chainId: 1 }, { ...typed.domain, name: "OtherGateway" }]) {
    const signature = await account.signTypedData({ ...typed, domain });
    expect(await verifyPrivateResearchSubmission({ ...submission, payment: { ...submission.payment, signature } }, requirement, merchants)).toBeNull();
  }
});

it("uses authoritative quote terms and refuses client-supplied replacements", async () => {
  const { submission } = await signedFixture();
  for (const expected of [
    { ...requirement, amount: "60000" },
    { ...requirement, maxTimeoutSeconds: 691200 },
    { ...requirement, network: "eip155:1" },
    { ...requirement, payTo: publicResearchPayee },
  ]) expect(await verifyPrivateResearchSubmission(submission, expected, merchants)).toBeNull();
  for (const extra of [{ requirement }, { accepted: requirement }, { payer: publicResearchPayee }, { resource: "/api/agent/ask" }]) {
    expect(await verifyPrivateResearchSubmission({ ...submission, ...extra }, requirement, merchants)).toBeNull();
  }
});

it("fails closed for absent, malformed, zero or colliding trusted merchants", async () => {
  const { submission } = await signedFixture();
  for (const policy of [undefined, {}, { ...merchants, privatePayee: "invalid" },
    { ...merchants, privatePayee: `0x${"0".repeat(40)}` },
    { ...merchants, publicResearchPayee: `0x${"AB".repeat(20)}` },
    { ...merchants, unexpected: true },
  ]) expect(await verifyPrivateResearchSubmission(submission, requirement, policy)).toBeNull();
  await expect(createPrivateAuthorization(request, requirement, submission.payment.authorization.from, {
    ...merchants, publicResearchPayee: `0x${"AB".repeat(20)}`,
  }, now)).rejects.toThrow("distinct merchants");
});

it("rejects stripped privacy policy, malformed signatures, altered salts and unsupported shapes", async () => {
  const { submission } = await signedFixture();
  const { access: _access, ...legacy } = submission.request;
  for (const value of [null, [], {}, { ...submission, request: legacy },
    { ...submission, request: { ...submission.request, access: "public" } },
    { ...submission, salt: `0x${"4".repeat(64)}` },
    { ...submission, payment: { ...submission.payment, signature: "0x" } },
    { ...submission, payment: { ...submission.payment, signature: `0x${"0".repeat(130)}` } },
    { ...submission, payment: { ...submission.payment, accepted: requirement } },
  ]) expect(await verifyPrivateResearchSubmission(value, requirement, merchants)).toBeNull();
});

it("preserves original signature evidence after expiry without claiming payment or access", async () => {
  const { submission } = await signedFixture();
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2040-01-01T00:00:00Z"));
    const result = await verifyPrivateResearchSubmission(submission, requirement, merchants);
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("settled");
    expect(result).not.toHaveProperty("admitted");
  } finally { vi.useRealTimers(); }
});
