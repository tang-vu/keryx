"use client";
import { createConnector } from "wagmi";
import { createPublicClient } from "viem";
import { arcChain } from "./chains";
import { browserPaymentProfile } from "./browser-payment-profile";
import { attestedArcHttp } from "./arc-rpc-attestation";
import { circleWalletIdentity, restoreCircleWalletIdentity, clearCircleWalletIdentity, startGoogleWalletLogin, signCircleWallet } from "./circle-wallet-browser";
import { createCircleWalletProvider } from "./circle-wallet-provider";
import { CIRCLE_GOOGLE_CONNECTOR_ID } from "./circle-wallet-config";

export { CIRCLE_GOOGLE_CONNECTOR_ID } from "./circle-wallet-config";
export function circleGoogleWallet() {
  return createConnector(config => {
    let provider: ReturnType<typeof createCircleWalletProvider> | undefined;
    const rpc = createPublicClient({ chain: arcChain, transport: attestedArcHttp(arcChain.rpcUrls.default.http[0], { retryCount: 0 }, browserPaymentProfile()) });
    return {
      id: CIRCLE_GOOGLE_CONNECTOR_ID, name: "Google", type: "circleGoogle",
      async connect({ chainId, isReconnecting, withCapabilities } = {}) {
        if (chainId !== undefined && chainId !== arcChain.id) throw new Error("Google wallet requires the selected Arc network");
        const current = circleWalletIdentity() ?? await restoreCircleWalletIdentity();
        if (!current) {
          if (isReconnecting) throw new Error("Reconnect your Google wallet to continue");
          await startGoogleWalletLogin();
          // OAuth leaves this page; no in-memory wallet is published before server verification.
          return new Promise<never>(() => {});
        }
        return { accounts: (withCapabilities ? [{ address: current.address, capabilities: {} }] : [current.address]) as never, chainId: arcChain.id };
      },
      async disconnect() { provider = undefined; clearCircleWalletIdentity(); },
      async getAccounts() { const current = circleWalletIdentity(); return current ? [current.address] : []; },
      async getChainId() { return arcChain.id; },
      async getProvider() {
        const current = circleWalletIdentity(); if (!current) throw new Error("Reconnect your Google wallet to continue");
        provider ??= createCircleWalletProvider({ address: current.address, chainId: arcChain.id,
          assertCurrent() { if (circleWalletIdentity() !== current) throw new Error("Google wallet connection changed or expired"); },
          sign: signCircleWallet,
          rpc: request => rpc.request(request as Parameters<typeof rpc.request>[0]),
        });
        return provider;
      },
      async isAuthorized() { return !!(circleWalletIdentity() ?? await restoreCircleWalletIdentity()); },
      async switchChain({ chainId }) {
        if (chainId !== arcChain.id) throw new Error("Google wallet supports the selected Arc network only");
        return arcChain;
      },
      onAccountsChanged(accounts) { if (!accounts.length) config.emitter.emit("disconnect"); else config.emitter.emit("change", { accounts: accounts as `0x${string}`[] }); },
      onChainChanged(chainId) { if (Number(chainId) !== arcChain.id) config.emitter.emit("disconnect"); },
      onDisconnect() { provider = undefined; clearCircleWalletIdentity(); config.emitter.emit("disconnect"); },
    };
  });
}
