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

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useAccount, useDisconnect } from "wagmi";
import { toast } from "sonner";
import { Wallet, ChevronDown, LogOut, Copy, ShieldCheck, Loader2, BookOpen, Stamp, Library, Receipt } from "lucide-react";
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
import { createMessages } from "@/lib/i18n/messages";
import { webHeaderMessages } from "@/locales/en/web-header";
import { chatAccountMessages } from "@/locales/en/chat-accounts";
import { ownerRunAssignmentMessages } from "@/locales/en/owner-run-assignments";

const copy = createMessages("en");


const CHIP =
  "flex items-center gap-2 border border-ink bg-paper px-3.5 py-2.5 font-mono text-[11.5px] font-semibold uppercase tracking-[0.12em] text-ink transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)] active:translate-y-0 active:shadow-none disabled:cursor-wait disabled:opacity-70";

/** False on the server and through hydration, true from the first client render after it. Lets the
 *  menu tell "nobody is connected" apart from "we haven't looked yet" without a setState-in-effect,
 *  and keeps the server HTML identical for every visitor so pages stay cacheable. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function WalletMenu() {
  const { address, isConnected, session, authState, signIn, signOut } = useSiweAuth();
  const { status } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const hydrated = useHydrated();
  const [pickerOpen, setPickerOpen] = useState(false);
  // Sticky "user signed out" flag. The MetaMask SDK / injected connectors can
  // auto-reconnect right after disconnect(), flipping isConnected back to true and
  // making the menu show "Sign in" for the just-removed wallet. While this is set we
  // force the "Connect Wallet" view regardless of the reconnect, until the user
  // explicitly picks a wallet again. Cleared on connect (onSelect) or a real session.
  const [signedOut, setSignedOut] = useState(false);

  // Sign out = clear the session AND disconnect the wallet, so the menu returns to
  // "Connect Wallet" (not "Sign in" for the same wallet).
  const handleSignOut = useCallback(async () => {
    try {
      await signOut();
      setSignedOut(true);
      try { await disconnectAsync(); } catch { /* Connector may already be disconnected. */ }
      toast(copy("account.signedOut"));
    } catch { toast.error(copy("account.signOutUnconfirmed")); }
  }, [disconnectAsync, signOut]);
  // A selection token gates auto-sign-in: rehydration never prompts, and an
  // older failed attempt cannot clear a newer choice after the picker remounts.
  const intentRef = useRef<symbol | null>(null);
  const busy = authState !== "idle";

  const doSignIn = useCallback(async () => {
    try {
      const res = await signIn();
      if (res.ok) {
        toast.success(res.created ? copy("account.created") : copy("walletMenu.welcomeBack"), {
          description: res.role ? copy("walletMenu.signedInAs", { role: res.role }) : copy("walletMenu.signedIn"),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : copy("account.signInFailed");
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
    intentRef.current = null;
    if (session === null) void doSignIn(); // null = signed out → sign in
  }, [isConnected, address, session, busy, doSignIn]);

  // A real session always wins over the sticky signed-out flag (derived, not stored,
  // to avoid a setState-in-effect cascade).
  const showSignedOut = signedOut && !session;

  // ── Still settling: server HTML, hydration, and wagmi's reconnect from cookie storage ──
  // A returning visitor is connected but wagmi doesn't know it yet. Showing "Connect Wallet" for
  // those few hundred milliseconds would be a lie that then flips — show a neutral chip instead.
  if (!hydrated || ((status === "reconnecting" || status === "connecting") && !session)) {
    return (
      <span className={`${CHIP} cursor-default opacity-70`} role="status" aria-busy>
        {hydrated && status === "connecting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />}
        {hydrated && status === "connecting" ? webHeaderMessages["walletMenu.connecting"] : copy("walletMenu.wallet")}</span>
    );
  }

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
          data-site-header-wallet
          align="end"
          className="min-w-[200px] rounded-none border-ink bg-paper p-1 font-mono text-[11px] uppercase tracking-[0.1em]"
        >
          <DropdownMenuItem
            className="cursor-pointer rounded-none text-ink-2 focus:bg-paper-2 focus:text-ink"
            onClick={() => {
              void navigator.clipboard?.writeText(session.address);
              toast(copy("walletMenu.addressCopied"));
            }}
          >
            <Copy className="h-3.5 w-3.5" />{copy("walletMenu.copyAddress")}</DropdownMenuItem>
          <DropdownMenuItem asChild className="cursor-pointer rounded-none text-ink-2 focus:bg-paper-2 focus:text-ink">
            <Link href="/dashboard">
              <BookOpen className="h-3.5 w-3.5" />{copy("walletMenu.ledger")}</Link>
          </DropdownMenuItem>
          {/* Unconditional (not isCreator-gated): the role snapshot can lag a wallet's first
              registration, and the page's empty state already routes non-owners to /register. */}
          <DropdownMenuItem asChild className="cursor-pointer rounded-none text-ink-2 focus:bg-paper-2 focus:text-ink">
            <Link href="/me/sources">
              <Library className="h-3.5 w-3.5" />{copy("walletMenu.mySources")}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="cursor-pointer rounded-none text-ink-2 focus:bg-paper-2 focus:text-ink">
            <Link href="/me/watches"><BookOpen className="h-3.5 w-3.5" />{copy("topicWatch.menu")}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="cursor-pointer rounded-none text-ink-2 focus:bg-paper-2 focus:text-ink">
            <Link href="/me/run-assignments"><Receipt className="h-3.5 w-3.5" />{ownerRunAssignmentMessages.menu}</Link>
          </DropdownMenuItem>
          {/* The paying side of the same wallet: what it dispatched and what those tolls cost. */}
          <DropdownMenuItem asChild className="cursor-pointer rounded-none text-ink-2 focus:bg-paper-2 focus:text-ink">
            <Link href="/me/profile"><ShieldCheck className="h-3.5 w-3.5" />{copy("walletMenu.privateProfile")}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="cursor-pointer rounded-none text-ink-2 focus:bg-paper-2 focus:text-ink">
            <Link href="/me/chat-accounts">{chatAccountMessages["walletMenu.chatAccounts"]}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="cursor-pointer rounded-none text-ink-2 focus:bg-paper-2 focus:text-ink">
            <Link href="/me/asks">
              <Receipt className="h-3.5 w-3.5" />{copy("walletMenu.myDispatches")}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="cursor-pointer rounded-none text-ink-2 focus:bg-paper-2 focus:text-ink">
            <Link href="/research#account-jobs-heading">
              <Receipt className="h-3.5 w-3.5" />{copy("walletMenu.paidJobs")}</Link>
          </DropdownMenuItem>
          {isCreator && (
            <DropdownMenuItem asChild className="cursor-pointer rounded-none text-ink-2 focus:bg-paper-2 focus:text-ink">
              <Link href="/register">
                <Stamp className="h-3.5 w-3.5" />{copy("walletMenu.issueToll")}</Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild className="cursor-pointer rounded-none text-ink-2 focus:bg-paper-2 focus:text-ink">
            <Link href="/connect#account-sessions-title">
              <ShieldCheck className="h-3.5 w-3.5" />{copy("walletMenu.manageSessions")}</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-line" />
          <DropdownMenuItem
            className="cursor-pointer rounded-none text-seal focus:bg-seal/10 focus:text-seal"
            onClick={handleSignOut}
            disabled={busy}
          >
            <LogOut className="h-3.5 w-3.5" /> {authState === "signing-out" ? copy("account.signingOut") : copy("account.signOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // ── Connected but not signed in: sign-in dropdown (fallback if auto-flow stalled) ──
  // Suppressed right after a user sign-out so an auto-reconnected wallet doesn't
  // show "Sign in" — the user sees "Connect Wallet" until they choose to reconnect.
  if (isConnected && address && !showSignedOut) {
    // session === undefined → the mount session check is still resolving; show a
    // neutral loading chip so already-signed-in users don't flash "Sign in".
    const loading = session === undefined;
    // A dropdown (not a bare button) so the user can escape a wrong auto-reconnected
    // wallet — with multiple injected wallets (OKX, Trust…) wagmi may reconnect one
    // the user didn't pick. "Use a different wallet" disconnects and reopens the picker.
    return (
      <DropdownMenu>
        <DropdownMenuTrigger className={CHIP} disabled={busy || loading}>
          {busy || loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" />
          )}
          {loading ? "…" : authState === "verifying" ? copy("account.verifying") : busy ? copy("walletMenu.signing") : copy("account.signIn")}
          <span className="text-ink-3">{shortAddress(address)}</span>
          {!busy && !loading && <ChevronDown className="h-3.5 w-3.5 text-ink-3" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          data-site-header-wallet
          align="end"
          className="min-w-[200px] rounded-none border-ink bg-paper p-1 font-mono text-[11px] uppercase tracking-[0.1em]"
        >
          <DropdownMenuItem
            className="cursor-pointer rounded-none text-ink-2 focus:bg-paper-2 focus:text-ink"
            onClick={doSignIn}
          >
            <ShieldCheck className="h-3.5 w-3.5" />{copy("walletMenu.signInWithWallet")}</DropdownMenuItem>
          <DropdownMenuSeparator className="bg-line" />
          <DropdownMenuItem
            className="cursor-pointer rounded-none text-seal focus:bg-seal/10 focus:text-seal"
            onClick={async () => {
              try { await disconnectAsync(); } catch { /* already disconnected */ }
              setSignedOut(true); // force the Connect Wallet picker
            }}
          >
            <Wallet className="h-3.5 w-3.5" />{copy("walletMenu.differentWallet")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // ── Disconnected: connect wallet dropdown ──
  return (
    <DropdownMenu open={pickerOpen} onOpenChange={setPickerOpen}>
      <DropdownMenuTrigger className={CHIP}>
        <Wallet className="h-3.5 w-3.5" />{copy("walletMenu.connectWallet")}<ChevronDown className="h-3.5 w-3.5 text-ink-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-site-header-wallet
        align="end"
        className="w-[260px] rounded-none border-ink bg-paper p-3"
      >
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{copy("walletMenu.chooseWallet")}</p>
        <WalletPicker
          isBusy={busy}
          onConnected={() => {}}
          onSelect={(attempt) => {
            // User chose to (re)connect: lift the signed-out suppression, flag intent
            // for auto-sign-in, and close the picker. The connected render branch
            // replaces the picker once the connection lands.
            setSignedOut(false);
            intentRef.current = attempt;
            setPickerOpen(false);
          }}
          onConnectionFailed={(attempt) => {
            if (intentRef.current === attempt) intentRef.current = null;
          }}
        />
        <p className="mt-2.5 font-mono text-[9.5px] leading-relaxed text-faint">{copy("walletMenu.connectBoundary")}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
