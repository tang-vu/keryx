"use client";

/**
 * WalletPicker — lists EIP-6963 discovered wallets for user selection.
 *
 * wagmi v2 announces all injected providers via EIP-6963 window events when
 * multiInjectedProviderDiscovery is enabled (default true). useConnect().connectors
 * reflects all discovered + configured connectors (injected, walletConnect, etc.).
 *
 * Falls back to a single "Connect wallet" button when no connectors are ready.
 * Styled as The Mint: Bodoni headers, banknote borders, vermillion accent.
 */

import { Loader2, Wallet } from "lucide-react";
import { useConnect } from "wagmi";
import Image from "next/image";

interface Props {
  isBusy: boolean;
  onConnected: () => void;
}

export function WalletPicker({ isBusy, onConnected: _onConnected }: Props) {
  const { connect, connectors, isPending } = useConnect();

  const busy = isBusy || isPending;

  // Filter out duplicate connector names (wagmi may list both the EIP-6963
  // discovered connector and the legacy injected() fallback for the same wallet).
  const seen = new Set<string>();
  const unique = connectors.filter((c) => {
    const key = c.id ?? c.name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (unique.length === 0) {
    // No injected wallets detected — show a hint instead of a broken button.
    return (
      <div className="space-y-3">
        <button
          type="button"
          disabled
          className="flex w-full items-center justify-center gap-2 border border-ink/40 bg-paper-2 px-4 py-3.5 font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-3 cursor-not-allowed"
        >
          <Wallet className="h-4 w-4" />
          No wallet detected
        </button>
        <p className="font-mono text-[10px] leading-relaxed text-faint">
          Install MetaMask or Rabby, then refresh this page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {unique.map((connector) => {
        const icon = connector.icon; // data-uri from EIP-6963 rdns discovery
        const name = connector.name;
        return (
          <button
            key={connector.id}
            type="button"
            onClick={() => connect({ connector })}
            disabled={busy}
            className="flex w-full items-center gap-3 border border-ink bg-paper px-4 py-3 font-mono text-[12px] font-semibold uppercase tracking-[0.1em] text-ink transition-all hover:-translate-y-0.5 hover:bg-seal hover:text-cream hover:shadow-[0_5px_0_var(--ink)] active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            ) : icon ? (
              // EIP-6963 icon is always a data-URI or https URL — safe to render.
              <Image
                src={icon}
                alt=""
                width={16}
                height={16}
                className="h-4 w-4 shrink-0 rounded-sm object-contain"
                unoptimized
              />
            ) : (
              <Wallet className="h-4 w-4 shrink-0" />
            )}
            <span className="flex-1 text-left">{name}</span>
          </button>
        );
      })}
    </div>
  );
}
