/**
 * Shared wagmi config factory. Exported as a function (makeConfig) so it can be
 * called in both the Server Component layout (for SSR cookie hydration) and the
 * client Providers component (which memoises the instance with useState).
 *
 * WalletConnect is included only when NEXT_PUBLIC_WC_PROJECT_ID is set; offline
 * dev works with injected wallets only (MetaMask, Rabby, etc.).
 */

import { createConfig, http, cookieStorage, createStorage } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { arcTestnet } from "./chains";

export function makeConfig() {
  const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "";

  // Build connector list: always include injected; add WalletConnect only when
  // a Reown Cloud project ID is available to avoid a runtime error on init.
  const connectors = projectId
    ? [injected(), walletConnect({ projectId })]
    : [injected()];

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
