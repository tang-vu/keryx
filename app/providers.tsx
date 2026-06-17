"use client";

/**
 * Client-side provider tree. Wraps all pages in WagmiProvider (wallet state)
 * and TanStack QueryClientProvider (async data fetching for wagmi hooks).
 *
 * initialState is populated server-side from cookies by layout.tsx, enabling
 * SSR hydration without a client-side flash of disconnected state.
 */

import { useState } from "react";
import { WagmiProvider, type State } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { makeConfig } from "@/lib/wagmi-config";

export function Providers({
  children,
  initialState,
}: {
  children: React.ReactNode;
  initialState?: State;
}) {
  // Memoised per-component-tree instances — avoids re-creating on re-render.
  const [config] = useState(makeConfig);
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
