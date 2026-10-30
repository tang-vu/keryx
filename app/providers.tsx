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
import { WagmiProvider, useAccount } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { makeConfig } from "@/lib/wagmi-config";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { UiCopyProvider } from "@/lib/i18n/ui-copy-provider";
import { loadUiPreview } from "@/lib/i18n/ui-preview-catalogues";

// Explicit machine-draft interface previews. Critical payment, consent and
// legal copy retains its English authority and existing review requirements.
const shellPreviewLocales = ["en", "vi", "zh-Hans", "es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id", "ru", "ar"] as const;

function LocaleBoundary({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();
  return <LocaleProvider enabledLocales={shellPreviewLocales} prepareLocale={loadUiPreview} connectedWallet={isConnected ? address ?? null : null}><UiCopyProvider>{children}</UiCopyProvider></LocaleProvider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  // Memoised per-component-tree instances — avoids re-creating on re-render.
  const [config] = useState(makeConfig);
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}><LocaleBoundary>{children}</LocaleBoundary></QueryClientProvider>
    </WagmiProvider>
  );
}
