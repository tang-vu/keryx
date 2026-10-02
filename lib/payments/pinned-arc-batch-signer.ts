import { BatchEvmScheme } from "@circle-fin/x402-batching/client";
import type { PrivateKeyAccount } from "viem";
import { assertArcRpcChain } from "../arc-rpc-attestation";
import { config } from "../config";
import { validateSessionPayment } from "../session/session-signing-policy";
import type { TypedDataPayload } from "../session/session-signer-protocol";
import type { BatchPayloadSigner } from "./server-x402-client";
import { sameAddress } from "./x402-payment-evidence";

/** The SDK receives only one bounded typed-data signing callback, never a private key/account.
 * Server transport must independently match the challenge to its authorized creator and amount. */
export function createPinnedArcBatchSigner(account: PrivateKeyAccount, rpcUrl: string): BatchPayloadSigner {
  const payer = account.address;
  const sign = account.signTypedData.bind(account);
  return {
    async createPaymentPayload(version, requirements) {
      try {
        const expected = Object.freeze({ ...requirements, extra: Object.freeze({ ...requirements.extra }) });
        const preparedAt = Math.floor(Date.now() / 1000);
        if (version !== 2 || expected.scheme !== "exact" || expected.network !== "eip155:5042002"
          || !sameAddress(expected.asset, "0x3600000000000000000000000000000000000000")
          || typeof expected.amount !== "string" || !/^[1-9]\d{0,77}$/.test(expected.amount)
          || BigInt(expected.amount) >= BigInt(2) ** BigInt(256)
          || expected.maxTimeoutSeconds !== config.maxTimeoutSeconds
          || expected.extra.name !== "GatewayWalletBatched" || expected.extra.version !== "1"
          || !sameAddress(expected.extra.verifyingContract, "0x0077777d7EBA4688BDeF3E311b846F25870A19B9")) throw new Error();
        const sdk = new BatchEvmScheme({
          address: payer,
          async signTypedData(payload) {
            // SDK-owned objects may change while RPC preflight awaits. Validate
            // and sign the same detached domain, type arrays and bigint message.
            const snapshot = structuredClone(payload);
            validateSessionPayment(snapshot as unknown as TypedDataPayload, payer);
            const message = snapshot.message;
            if (!sameAddress(message.to, expected.payTo) || message.value !== BigInt(expected.amount)
              || typeof message.validAfter !== "bigint" || typeof message.validBefore !== "bigint"
              || message.validAfter < BigInt(preparedAt - 600)
              || message.validAfter > BigInt(Math.floor(Date.now() / 1000) - 600)
              || message.validBefore - message.validAfter !== BigInt(Math.max(expected.maxTimeoutSeconds, 604800) + 600)) throw new Error();
            await assertArcRpcChain(rpcUrl);
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
