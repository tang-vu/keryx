"use client";

/**
 * WalletPicker — lists connect options for the user.
 *
 * Option groups:
 *   1. Injected wallets — EIP-6963 discovered providers (MetaMask, Rabby, …),
 *      present on desktop with an extension or inside a wallet's in-app browser.
 *   2. MetaMask (SDK) — deep-links/QR to the MetaMask mobile app from a plain
 *      mobile browser, no registration. Hidden when MetaMask is already present
 *      as an injected wallet (desktop extension) to avoid a duplicate row.
 *   3. WalletConnect — QR / mobile deep-link for ALL wallets. Shown only when
 *      NEXT_PUBLIC_WC_PROJECT_ID is set (wagmi-config adds the connector).
 *
 * The bare injected() fallback connector is never rendered as its own button: it
 * fails to connect when no provider exists (the dead-button-on-mobile problem).
 * When nothing is available we show actionable guidance.
 *
 * Styled as The Mint: Bodoni headers, banknote borders, vermillion accent.
 */

import { Loader2, Wallet, QrCode, Smartphone } from "lucide-react";
import { useConnect, type Connector } from "wagmi";
import Image from "next/image";

// Connector ids/types that get their own dedicated button, so they are excluded
// from the EIP-6963 injected-wallet list.
const SPECIAL_IDS = new Set(["injected", "walletConnect", "metaMaskSDK", "metaMask", "coinbaseWalletSDK"]);

interface Props {
  isBusy: boolean;
  onConnected: () => void;
  /** Fired the instant a wallet is chosen, before connect() runs. Lets callers
   *  flag user intent (e.g. to auto-trigger sign-in once connected). */
  onSelect?: () => void;
}

const ROW =
  "flex w-full items-center gap-3 border border-ink bg-paper px-4 py-3 font-mono text-[12px] font-semibold uppercase tracking-[0.1em] text-ink transition-all hover:-translate-y-0.5 hover:bg-seal hover:text-cream hover:shadow-[0_5px_0_var(--ink)] active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none";

export function WalletPicker({ isBusy, onConnected: _onConnected, onSelect }: Props) {
  const { connect, connectors, isPending } = useConnect();
  const busy = isBusy || isPending;

  // EIP-6963 discovered wallets: type "injected" with a real, unique id (the
  // provider rdns). The bare injected() fallback (id "injected") and the special
  // SDK connectors are excluded — they get their own buttons / never render.
  const seen = new Set<string>();
  const injectedWallets = connectors.filter((c) => {
    if (c.type !== "injected" || SPECIAL_IDS.has(c.id)) return false;
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  // MetaMask SDK connector — only surface it when MetaMask isn't already an
  // injected wallet (avoids a duplicate "MetaMask" row on desktop with the extension).
  const metaMaskConn = connectors.find(
    (c) => c.id === "metaMaskSDK" || c.id === "metaMask" || c.type === "metaMask",
  );
  const hasInjectedMetaMask = injectedWallets.some(
    (c) => /metamask/i.test(c.id) || /metamask/i.test(c.name),
  );
  const showMetaMask = metaMaskConn && !hasInjectedMetaMask;

  const walletConnectConn = connectors.find((c) => c.id === "walletConnect");

  const choose = (connector: Connector) => {
    onSelect?.();
    connect({ connector });
  };

  // Nothing usable: no injected wallet, no MetaMask SDK, no WalletConnect.
  // Guide the user to a path that works.
  if (injectedWallets.length === 0 && !showMetaMask && !walletConnectConn) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 border border-ink/40 bg-paper-2 px-4 py-3.5">
          <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
          <p className="font-mono text-[11px] leading-relaxed text-ink-2">
            No browser wallet detected.
          </p>
        </div>
        <p className="font-mono text-[10px] leading-relaxed text-faint">
          On mobile: open keryx.cc inside your wallet app&apos;s browser
          (MetaMask, Rabby…). On desktop: install MetaMask or Rabby, then refresh.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {injectedWallets.map((connector) => (
        <button
          key={connector.id}
          type="button"
          onClick={() => choose(connector)}
          disabled={busy}
          className={ROW}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          ) : connector.icon ? (
            // EIP-6963 icon is always a data-URI or https URL — safe to render.
            <Image
              src={connector.icon}
              alt=""
              width={16}
              height={16}
              className="h-4 w-4 shrink-0 rounded-sm object-contain"
              unoptimized
            />
          ) : (
            <Wallet className="h-4 w-4 shrink-0" />
          )}
          <span className="flex-1 text-left">{connector.name}</span>
        </button>
      ))}

      {showMetaMask && metaMaskConn && (
        <button
          type="button"
          onClick={() => choose(metaMaskConn)}
          disabled={busy}
          className={ROW}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          ) : metaMaskConn.icon ? (
            <Image
              src={metaMaskConn.icon}
              alt=""
              width={16}
              height={16}
              className="h-4 w-4 shrink-0 rounded-sm object-contain"
              unoptimized
            />
          ) : (
            <Wallet className="h-4 w-4 shrink-0" />
          )}
          <span className="flex-1 text-left">
            MetaMask
            <span className="ml-2 normal-case tracking-normal text-current/70">
              mobile · QR
            </span>
          </span>
        </button>
      )}

      {walletConnectConn && (
        <button
          type="button"
          onClick={() => choose(walletConnectConn)}
          disabled={busy}
          className={ROW}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <QrCode className="h-4 w-4 shrink-0" />
          )}
          <span className="flex-1 text-left">
            WalletConnect
            <span className="ml-2 normal-case tracking-normal text-current/70">
              QR · mobile
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
