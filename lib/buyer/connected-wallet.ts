import type { WalletClient } from "viem";
import { readGatewayCredit } from "../gateway/read-credit";
import { addressSchema, buyerTypedData, type BuyerAuthorization } from "./protocol";
import type { BrowserBuyerWallet } from "./browser-client";

/** Read provider state, not the account/chain captured when a React hook last rendered. */
export function connectedBuyerWallet(wallet: WalletClient, expectedAddress: string, signal?: AbortSignal) {
  const payer = addressSchema.parse(expectedAddress);
  async function checkIdentity() {
    signal?.throwIfAborted();
    const [addresses, chainId] = await Promise.all([wallet.getAddresses(), wallet.getChainId()]);
    signal?.throwIfAborted();
    if (addresses[0]?.toLowerCase() !== payer.toLowerCase() || chainId !== 5042002) {
      throw new Error("Choose the reviewed wallet on Arc testnet before buying");
    }
  }
  return {
    async readWallet(): Promise<BrowserBuyerWallet> {
      await checkIdentity();
      const available = await readGatewayCredit(payer, signal);
      await checkIdentity();
      return { address: payer, chainId: 5042002, gatewayBalanceMicros: available.toString() };
    },
    async sign(authorization: BuyerAuthorization) {
      await checkIdentity();
      if (authorization.from.toLowerCase() !== payer.toLowerCase()) throw new Error("Wrong buyer authorization");
      return wallet.signTypedData({ ...buyerTypedData(authorization), account: payer as `0x${string}` });
    },
  };
}
