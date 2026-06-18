"use client";

/**
 * connect-steps.tsx — step indicator and per-step panels for the /connect page.
 *
 * Extracted from app/connect/page.tsx to keep that file under ~200 lines.
 * Styled as The Mint (Bodoni display, banknote borders, vermillion seal accent).
 */

import { Loader2, ShieldCheck, LogOut, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { WalletPicker } from "@/components/keryx/wallet-picker";
import type { ArcChainGuard } from "@/lib/hooks/use-arc-chain-guard";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AuthState = "idle" | "signing" | "verifying";

// ── StepDot ───────────────────────────────────────────────────────────────────

export function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div
      className={[
        "flex h-7 w-7 items-center justify-center border font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors",
        done
          ? "border-paid bg-paid/10 text-paid"
          : active
          ? "border-ink bg-paper text-ink"
          : "border-line bg-paper-2 text-ink-3",
      ].join(" ")}
    >
      {done ? "✓" : label}
    </div>
  );
}

// ── ChainBanner — shown whenever connected wallet is on the wrong chain ────────

export function ChainBanner({ guard }: { guard: ArcChainGuard }) {
  if (guard.isOnArc) return null;
  return (
    <div className="flex items-start gap-3 border border-amber-500/40 bg-amber-500/[0.08] px-3 py-2.5">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="flex-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-amber-700">
          Wrong network
        </p>
        <p className="mt-0.5 text-[12px] leading-snug text-ink-2">
          Keryx runs on Arc Testnet (chainId 5042002). Switch to continue.
        </p>
      </div>
      <button
        type="button"
        onClick={guard.switchToArc}
        disabled={guard.isSwitching}
        className="shrink-0 border border-amber-600 bg-amber-600 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-white transition-all hover:bg-amber-700 disabled:cursor-wait disabled:opacity-60"
      >
        {guard.isSwitching ? <Loader2 className="h-3 w-3 animate-spin" /> : "Switch ▸"}
      </button>
    </div>
  );
}

// ── ConnectStep ───────────────────────────────────────────────────────────────

export function ConnectStep({ isBusy }: { isBusy: boolean }) {
  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">Step 1</p>
        <p className="mt-1 font-display text-xl font-medium text-ink">Connect wallet</p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
          Choose your browser wallet. Arc Testnet will be added automatically
          if not already configured.
        </p>
      </div>
      {/* EIP-6963 multi-wallet picker — lists all discovered injected wallets */}
      <WalletPicker isBusy={isBusy} onConnected={() => {}} />
    </div>
  );
}

// ── SignInStep ────────────────────────────────────────────────────────────────

export function SignInStep({
  address,
  onSignIn,
  onDisconnect,
  authState,
  chainGuard,
}: {
  address: string;
  onSignIn: () => void;
  onDisconnect: () => void;
  authState: AuthState;
  chainGuard: ArcChainGuard;
}) {
  const label =
    authState === "signing"
      ? "Waiting for signature…"
      : authState === "verifying"
      ? "Verifying…"
      : "Sign in with Ethereum ▸";

  // Block sign-in when on the wrong chain — the SIWE message embeds chainId 5042002
  // and the server rejects messages with a mismatched chainId.
  const wrongChain = !chainGuard.isOnArc;

  return (
    <div className="space-y-5">
      <ChainBanner guard={chainGuard} />
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">Step 2</p>
        <p className="mt-1 font-display text-xl font-medium text-ink">Sign in</p>
        <p className="mt-0.5 break-all font-mono text-[11px] text-ink-3">{address}</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          Sign a message in your wallet to prove ownership. No gas required —
          this is a signature, not a transaction.
        </p>
      </div>
      <button
        type="button"
        onClick={onSignIn}
        disabled={authState !== "idle" || wrongChain}
        title={wrongChain ? "Switch to Arc Testnet first" : undefined}
        className="flex w-full items-center justify-center gap-2 border border-ink bg-seal px-4 py-3.5 font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-cream transition-all hover:-translate-y-0.5 hover:shadow-[0_5px_0_var(--ink)] active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        {authState !== "idle" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ShieldCheck className="h-4 w-4" />
        )}
        {label}
      </button>
      <button
        type="button"
        onClick={onDisconnect}
        className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3 hover:text-seal hover:underline"
      >
        ← Use a different wallet
      </button>
    </div>
  );
}

// ── SignedInStep ──────────────────────────────────────────────────────────────

export function SignedInStep({
  session,
  onSignOut,
}: {
  session: { address: string; role: string };
  onSignOut: () => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">Step 3</p>
        <p className="mt-1 font-display text-xl font-medium text-ink">Authenticated</p>
        <p className="mt-0.5 break-all font-mono text-[11px] text-ink-3">{session.address}</p>
        <div className="mt-3 inline-flex items-center gap-1.5 border border-paid/30 bg-paid/[0.08] px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-paid">
          <ShieldCheck className="h-3 w-3" />
          {session.role}
        </div>
      </div>

      {session.role === "creator" || session.role === "dev" ? (
        <Link
          href="/register"
          className="flex w-full items-center justify-center gap-2 border border-ink bg-seal px-4 py-3.5 font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-cream transition-all hover:-translate-y-0.5 hover:shadow-[0_5px_0_var(--ink)] active:translate-y-0 active:shadow-none"
        >
          Issue a toll ▸
        </Link>
      ) : (
        <Link
          href="/"
          className="flex w-full items-center justify-center gap-2 border border-ink bg-seal px-4 py-3.5 font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-cream transition-all hover:-translate-y-0.5 hover:shadow-[0_5px_0_var(--ink)] active:translate-y-0 active:shadow-none"
        >
          Ask a question ▸
        </Link>
      )}

      <button
        type="button"
        onClick={onSignOut}
        className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3 hover:text-seal hover:underline"
      >
        <LogOut className="h-3.5 w-3.5" />
        Sign out
      </button>
    </div>
  );
}
