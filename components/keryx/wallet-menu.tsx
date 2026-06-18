"use client";

/**
 * WalletMenu — header wallet control. Three states:
 *   1. Disconnected      → "Connect Wallet" dropdown listing browser wallets.
 *   2. Connected, no auth → "Sign in" chip (auto-fires after a user-initiated
 *      connect, so connecting a wallet creates the account in one flow).
 *   3. Signed in          → account chip (role + handle) with a dropdown menu.
 *
 * Connecting a wallet the user just picked auto-runs SIWE sign-in, which creates
 * the account server-side. A page-load rehydrated connection does NOT auto-sign
 * — only a fresh, user-initiated connect does (guarded by intentRef).
 *
 * Styled as "The Mint": mono labels, banknote borders, vermillion seal accent.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useDisconnect } from "wagmi";
import { toast } from "sonner";
import { Wallet, ChevronDown, LogOut, Copy, ShieldCheck, Loader2, BookOpen, Stamp } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { WalletPicker } from "./wallet-picker";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { shortAddress } from "@/lib/utils";

const CHIP =
  "flex items-center gap-2 border border-ink bg-paper px-3.5 py-2.5 font-mono text-[11.5px] font-semibold uppercase tracking-[0.12em] text-ink transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)] active:translate-y-0 active:shadow-none disabled:cursor-wait disabled:opacity-70";

export function WalletMenu() {
  const { address, isConnected, session, authState, signIn, signOut } = useSiweAuth();
  const { disconnect } = useDisconnect();
  const [pickerOpen, setPickerOpen] = useState(false);
  // Set true only when the user picks a wallet here — gates auto-sign-in so a
  // rehydrated connection on page load never pops an unsolicited signature.
  const intentRef = useRef(false);
  const busy = authState !== "idle";

  const doSignIn = useCallback(async () => {
    try {
      const res = await signIn();
      if (res.ok) {
        toast.success(res.created ? "Account created" : "Welcome back", {
          description: `Signed in${res.role ? ` as ${res.role}` : ""}`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-in failed";
      // Don't surface user-cancelled signature prompts as errors.
      if (!/reject|denied|cancel/i.test(msg)) toast.error(msg);
    }
  }, [signIn]);

  // Auto-flow: once the wallet the user just picked here is connected, run SIWE
  // sign-in once (creates the account). Fires only for a user-initiated connect
  // with no existing session — a page-load rehydration never auto-signs. The
  // SIWE message carries chainId Arc regardless of the wallet's current network,
  // so no chain switch is needed here; funding/faucet flows enforce Arc later.
  useEffect(() => {
    if (!intentRef.current || !isConnected || !address || busy) return;
    if (session === undefined) return; // session check still in flight
    intentRef.current = false;
    if (session === null) void doSignIn(); // null = signed out → sign in
  }, [isConnected, address, session, busy, doSignIn]);

  // ── Signed in: account chip + menu ──
  if (session) {
    const isCreator = session.role === "creator" || session.role === "dev";
    return (
      <DropdownMenu>
        <DropdownMenuTrigger className={CHIP}>
          <span className="h-1.5 w-1.5 rounded-full bg-seal" aria-hidden />
          <span className="text-ink-3">{session.role}</span>
          <span className="text-ink">{shortAddress(session.address)}</span>
          <ChevronDown className="h-3.5 w-3.5 text-ink-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-[200px] rounded-none border-ink bg-paper p-1 font-mono text-[11px] uppercase tracking-[0.1em]"
        >
          <DropdownMenuItem
            className="cursor-pointer rounded-none text-ink-2 focus:bg-paper-2 focus:text-ink"
            onClick={() => {
              void navigator.clipboard?.writeText(session.address);
              toast("Address copied");
            }}
          >
            <Copy className="h-3.5 w-3.5" /> Copy address
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="cursor-pointer rounded-none text-ink-2 focus:bg-paper-2 focus:text-ink">
            <Link href="/dashboard">
              <BookOpen className="h-3.5 w-3.5" /> Ledger
            </Link>
          </DropdownMenuItem>
          {isCreator && (
            <DropdownMenuItem asChild className="cursor-pointer rounded-none text-ink-2 focus:bg-paper-2 focus:text-ink">
              <Link href="/register">
                <Stamp className="h-3.5 w-3.5" /> Issue a toll
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator className="bg-line" />
          <DropdownMenuItem
            className="cursor-pointer rounded-none text-seal focus:bg-seal/10 focus:text-seal"
            onClick={async () => {
              await signOut();
              disconnect();
              toast("Signed out");
            }}
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // ── Connected but not signed in: sign-in chip (fallback if auto-flow stalled) ──
  if (isConnected && address) {
    // session === undefined → the mount session check is still resolving; show a
    // neutral loading chip so already-signed-in users don't flash "Sign in".
    const loading = session === undefined;
    return (
      <button type="button" onClick={doSignIn} disabled={busy || loading} className={CHIP}>
        {busy || loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ShieldCheck className="h-3.5 w-3.5" />
        )}
        {loading ? "…" : authState === "verifying" ? "Verifying…" : busy ? "Sign…" : "Sign in"}
        <span className="text-ink-3">{shortAddress(address)}</span>
      </button>
    );
  }

  // ── Disconnected: connect wallet dropdown ──
  return (
    <DropdownMenu open={pickerOpen} onOpenChange={setPickerOpen}>
      <DropdownMenuTrigger className={CHIP}>
        <Wallet className="h-3.5 w-3.5" />
        Connect Wallet
        <ChevronDown className="h-3.5 w-3.5 text-ink-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[260px] rounded-none border-ink bg-paper p-3"
      >
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
          Choose a wallet
        </p>
        <WalletPicker
          isBusy={busy}
          onConnected={() => {}}
          onSelect={() => {
            // Flag user intent (auto-sign-in) and close the picker; the connected
            // render branch replaces the picker once the connection lands.
            intentRef.current = true;
            setPickerOpen(false);
          }}
        />
        <p className="mt-2.5 font-mono text-[9.5px] leading-relaxed text-faint">
          Connecting creates your account &amp; signs you in.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
