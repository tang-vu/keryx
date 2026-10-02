import { expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { hashTypedData, maxUint256 } from "viem";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { createSessionGrantConsentMessage, createSessionGrantSignerProofMessage, parseSessionGrantConsent } from "../payments/session-grant-consent";
import { prepareWithdrawIntentForProfile } from "./withdraw-intent-core";
import { withdrawPolicySchema, withdrawTypedData } from "./withdraw-protocol";
import { verifySessionWithdrawalPreparation, type SessionWithdrawalPreparation } from "./session-withdrawal-protocol";

export async function sessionWithdrawalFixture(): Promise<SessionWithdrawalPreparation> {
  const owner = privateKeyToAccount(`0x${"11".repeat(32)}`), session = privateKeyToAccount(`0x${"22".repeat(32)}`);
  const profile = ARC_MAINNET_PROFILE;
  const consent = parseSessionGrantConsent({ format: "keryx-session-grant-consent-v1", network: profile.networkId,
    origin: "https://keryx.cc", ownerAddr: owner.address.toLowerCase(), sessAddr: session.address.toLowerCase(),
    grantEpoch: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", capMicroUsdc: "1000000", expirySeconds: "1" }, profile);
  const burnIntent = { ...prepareWithdrawIntentForProfile(profile, consent.sessAddr, "500000", consent.ownerAddr, "1000"), maxBlockHeight: "1100" };
  return { format: "keryx-session-withdrawal-preparation-v1", network: profile.networkId,
    requestId: hashTypedData(withdrawTypedData(burnIntent)), ownerAddr: consent.ownerAddr, sessAddr: consent.sessAddr,
    grantEpoch: consent.grantEpoch, authorization: { consent,
      ownerSignature: await owner.signMessage({ message: createSessionGrantConsentMessage(consent, profile) }),
      sessionSignature: await session.signMessage({ message: createSessionGrantSignerProofMessage(consent, profile) }) },
    burnIntent, policy: withdrawPolicySchema.parse({ owner: consent.sessAddr, recipient: consent.ownerAddr,
      domain: profile.cctpDomain, gatewayWallet: profile.gatewayWallet, gatewayMinter: profile.gatewayMinter,
      asset: profile.usdcAddress, maxValueMicros: "500000", maxFeeMicros: "1000" }),
    balance: { availableMicroUsdc: "1000000", heldPaymentMicroUsdc: "100000", heldWithdrawalMicroUsdc: "0", confirmedSpentMicroUsdc: "0", maxFeeMicroUsdc: "1000" },
    height: { minimumBlockHeight: "1100", maximumBlockHeight: "1200", observedBlockNumber: "1000",
      observedBlockHash: `0x${"55".repeat(32)}`, observedAt: new Date().toISOString() } };
}

it("verifies the original owner and session proofs for withdrawal after payment expiry", async () => {
  const p = await sessionWithdrawalFixture();
  expect((await verifySessionWithdrawalPreparation(p)).authorization.consent.expirySeconds).toBe("1");
});
it("refuses altered recipient, network, original proof, finite height, fee and pending-liability capacity", async () => {
  const original = await sessionWithdrawalFixture();
  const mutations: ((p: SessionWithdrawalPreparation) => void)[] = [
    p => { p.policy.recipient = p.sessAddr as `0x${string}`; },
    p => { p.policy.gatewayWallet = ARC_TESTNET_PROFILE.gatewayWallet; },
    p => { p.authorization.consent = { ...p.authorization.consent, capMicroUsdc: "1000001" }; },
    p => { p.authorization.sessionSignature = p.authorization.ownerSignature; },
    p => { p.burnIntent.maxBlockHeight = maxUint256.toString(); },
    p => { p.height.minimumBlockHeight = "999"; },
    p => { p.balance.maxFeeMicroUsdc = "999"; },
    p => { p.balance.heldPaymentMicroUsdc = "500000"; },
    p => { p.balance.heldWithdrawalMicroUsdc = "500000"; },
    p => { p.requestId = `0x${"00".repeat(32)}`; },
  ];
  for (const mutate of mutations) { const p = structuredClone(original); mutate(p); await expect(verifySessionWithdrawalPreparation(p)).rejects.toThrow(); }
});
