"use client";

/**
 * Client-side provider tree. Wraps all pages in WagmiProvider (wallet state)
 * and TanStack QueryClientProvider (async data fetching for wagmi hooks).
 *
 * No server-seeded initialState: reading the request's cookies to pre-fill wallet state forced
 * every page in the app to render per-request. wagmi reconnects from its own cookie storage after
 * mount instead, so the server HTML is identical for everyone and can be cached.
 */

import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { makeConfig } from "@/lib/wagmi-config";

export function Providers({ children }: { children: React.ReactNode }) {
  // Memoised per-component-tree instances — avoids re-creating on re-render.
  const [config] = useState(makeConfig);
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
