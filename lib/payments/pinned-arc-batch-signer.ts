import { BatchEvmScheme } from "@circle-fin/x402-batching/client";
import type { PrivateKeyAccount } from "viem";
import { assertArcRpcChain } from "../arc-rpc-attestation";
import { paymentRuntimeConfig } from "../payment-runtime-config";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";
import { createSessionSigningPolicy } from "../session/session-signing-policy";
import type { TypedDataPayload } from "../session/session-signer-protocol";
import type { BatchPayloadSigner } from "./server-x402-client";
import { sameAddress } from "./x402-payment-evidence";

/** The SDK receives only one bounded typed-data signing callback, never a private key/account.
 * Server transport must independently match the challenge to its authorized creator and amount. */
export function createPinnedArcBatchSigner(account: PrivateKeyAccount, rpcUrl: string,
  profile: ArcNetworkProfile = paymentRuntimeConfig().profile, maxTimeoutSeconds = paymentRuntimeConfig().maxTimeoutSeconds): BatchPayloadSigner {
  if (profile !== ARC_MAINNET_PROFILE && profile !== ARC_TESTNET_PROFILE || !Number.isSafeInteger(maxTimeoutSeconds) ||
    maxTimeoutSeconds < 604900 || maxTimeoutSeconds > 691200) throw new Error("Arc payment policy unavailable");
  const policy = createSessionSigningPolicy(profile);
  const payer = account.address;
  const sign = account.signTypedData.bind(account);
  return {
    async createPaymentPayload(version, requirements) {
      try {
        const expected = Object.freeze({ ...requirements, extra: Object.freeze({ ...requirements.extra }) });
        const preparedAt = Math.floor(Date.now() / 1000);
        if (version !== 2 || expected.scheme !== "exact" || expected.network !== profile.networkId
          || !sameAddress(expected.asset, profile.usdcAddress)
          || typeof expected.amount !== "string" || !/^[1-9]\d{0,77}$/.test(expected.amount)
          || BigInt(expected.amount) >= BigInt(2) ** BigInt(256)
          || expected.maxTimeoutSeconds !== maxTimeoutSeconds
          || expected.extra.name !== "GatewayWalletBatched" || expected.extra.version !== "1"
          || !sameAddress(expected.extra.verifyingContract, profile.gatewayWallet)) throw new Error();
        const sdk = new BatchEvmScheme({
          address: payer,
          async signTypedData(payload) {
            // SDK-owned objects may change while RPC preflight awaits. Validate
            // and sign the same detached domain, type arrays and bigint message.
            const snapshot = structuredClone(payload);
            policy.validatePayment(snapshot as unknown as TypedDataPayload, payer);
            const message = snapshot.message;
            if (!sameAddress(message.to, expected.payTo) || message.value !== BigInt(expected.amount)
              || typeof message.validAfter !== "bigint" || typeof message.validBefore !== "bigint"
              || message.validAfter < BigInt(preparedAt - 600)
              || message.validAfter > BigInt(Math.floor(Date.now() / 1000) - 600)
              || message.validBefore - message.validAfter !== BigInt(Math.max(expected.maxTimeoutSeconds, 604800) + 600)) throw new Error();
            await assertArcRpcChain(rpcUrl, profile);
            return sign(snapshot as Parameters<PrivateKeyAccount["signTypedData"]>[0]);
          },
        });
        return await sdk.createPaymentPayload(version, expected);
      } catch {
        // RPC/library diagnostics can contain credential URLs or payment bearer material.
        throw new Error("Arc payment signing refused by the local signing policy");
      }
    },
  };
}
