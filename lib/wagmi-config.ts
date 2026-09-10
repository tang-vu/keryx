/**
 * Shared wagmi config factory for the server/client provider tree. Providers
 * memoises the instance; browser hydration restores persisted connection state.
 *
 * Connector strategy:
 *   - injected()     — desktop extensions + in-wallet dApp browsers (EIP-6963).
 *   - metaMask()     — MetaMask SDK: deep-links/QR to the MetaMask mobile app from
 *                      a plain mobile browser. NO WalletConnect project ID needed.
 *   - walletConnect()— universal mobile support for ALL wallets, but only when a
 *                      Reown Cloud project ID (NEXT_PUBLIC_WC_PROJECT_ID) is set.
 */

import { createConfig, http, cookieStorage, createStorage } from "wagmi";
import { injected, metaMask, walletConnect } from "wagmi/connectors";
import { arcTestnet } from "./chains";
import { deferredWalletConnector } from "./deferred-wallet-connector";

export function makeConfig() {
  const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "";

  // injected + MetaMask SDK are always available (MetaMask SDK gives mobile-browser
  // support with zero registration). WalletConnect is added only when a project ID
  // is configured — initialising it without one throws at runtime.
  const connectors = [
    injected(),
    deferredWalletConnector(metaMask({ dapp: { name: "Keryx", url: "https://keryx.cc" } })),
    // Browser-only: WalletConnect Core is a process-wide singleton, so building
    // this connector during SSR re-inits it on every request and floods the server
    // log with "already initialized" warnings. The browser includes it for wallet
    // selection; the deferred wrapper preserves remembered-connection startup.
    // showQrModal: true makes the WalletConnect connector open its own QR / mobile
    // wallet-list modal on connect — without it, clicking does nothing visible.
    ...(projectId && typeof window !== "undefined"
      ? [deferredWalletConnector(walletConnect({ projectId, showQrModal: true }))]
      : []),
  ];

  return createConfig({
    chains: [arcTestnet],
    ssr: true,
    // cookieStorage is required for wagmi SSR hydration on Next.js App Router —
    // it serialises wallet connection state into cookies so the server can render
    // the connected state without a client-side flash.
    storage: createStorage({ storage: cookieStorage }),
    connectors,
    transports: { [arcTestnet.id]: http() },
  });
}
