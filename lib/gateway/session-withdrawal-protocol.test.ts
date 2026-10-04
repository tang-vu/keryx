import { expect, it } from "vitest";
import { maxUint256 } from "viem";
import { ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { verifySessionWithdrawalPreparation, type SessionWithdrawalPreparation } from "./session-withdrawal-protocol";
import { sessionWithdrawalFixture } from "./session-withdrawal-test-fixture";

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
