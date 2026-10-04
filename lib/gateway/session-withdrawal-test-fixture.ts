import { privateKeyToAccount } from "viem/accounts";
import { hashTypedData } from "viem";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { createSessionGrantConsentMessage, createSessionGrantSignerProofMessage, parseSessionGrantConsent } from "../payments/session-grant-consent";
import { prepareWithdrawIntentForProfile } from "./withdraw-intent-core";
import { withdrawPolicySchema, withdrawTypedData } from "./withdraw-protocol";
import type { SessionWithdrawalPreparation } from "./session-withdrawal-protocol";

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
