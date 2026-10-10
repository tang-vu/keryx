"use client";

/**
 * /connect — wallet connect + SIWE sign-in page. Styled as The Mint: Bodoni
 * display type, banknote borders, vermillion (seal) accent. No RainbowKit —
 * custom flow built on wagmi primitives to preserve the design system.
 *
 * Flow:
 *   1. Not connected → show EIP-6963 wallet picker (all discovered wallets)
 *   2. Connected on wrong chain → show the configured network switch banner
 *   3. Connected on the configured chain, not signed in → show SIWE sign-in
 *   4. Signed in → show address + role badge + "Sign out" / link to register
 *
 * The sign-in flow itself lives in the shared useSiweAuth hook (also used by the
 * header wallet menu); this page only renders the step UI around it.
 */

import { useCallback, useEffect, useState } from "react";
import { useDisconnect } from "wagmi";
import { toast } from "sonner";
import { SiteHeader } from "@/components/keryx/site-header";
import {
  StepDot,
  ConnectStep,
  SignInStep,
  SignedInStep,
} from "@/components/keryx/connect-steps";
import { useArcChainGuard } from "@/lib/hooks/use-arc-chain-guard";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { sourceReturnWithOwner, safeRegistrationReturn, registrationOwnerMatches } from "@/lib/registration-return";
import { AccountSessions } from "@/components/keryx/account-sessions";
import { CircleGoogleCallback, CircleGoogleWalletButton } from "@/components/keryx/circle-google-wallet";
import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";

const message = createMessages("en");
const richMessage = createRichMessages("en");

export default function ConnectPage() {
  const { disconnect, disconnectAsync } = useDisconnect();
  const chainGuard = useArcChainGuard();
  const { address, isConnected, session, authState, signIn, signOut, refresh } = useSiweAuth();
  const handleGoogleConnected = useCallback(() => { void refresh(); }, [refresh]);

  const [returnTo, setReturnTo] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const target = safeRegistrationReturn(new URLSearchParams(window.location.search).get("returnTo"));
      if (!target) { setReturnTo(null); return; }
      // Bind once to the initiating wallet, retaining it across reloads and switches.
      const bound = sourceReturnWithOwner(target, address);
      const params = new URLSearchParams({ returnTo: bound });
      window.history.replaceState(window.history.state, "", `/connect?${params}`);
      setReturnTo(bound);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [address]);
  const identityMatches = !!address && !!session && address.toLowerCase() === session.address.toLowerCase();

  const handleSignIn = useCallback(async () => {
    try {
      const res = await signIn();
      if (res.ok) {
        toast.success(message(res.created ? "account.created" : "account.signedIn"), {
          description: message("account.role", { role: String(res.role) }),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : message("account.signInFailed");
      // User rejected the signature request — don't show an error toast for that.
      if (!msg.toLowerCase().includes("rejected") && !msg.toLowerCase().includes("denied")) {
        toast.error(msg);
      }
    }
  }, [signIn]);

  const handleSignOut = useCallback(async () => {
    // Fully disconnect so the flow returns to step 1 (connect), not a re-sign of
    // the same wallet still showing as connected.
    try {
      await signOut();
      try { await disconnectAsync(); } catch { /* Connector may already be disconnected. */ }
      toast(message("account.signedOut"));
    } catch { toast.error(message("account.signOutUnconfirmed")); }
  }, [disconnectAsync, signOut]);

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-16 sm:px-8">
        <CircleGoogleCallback onConnected={handleGoogleConnected} />
        <header className="mb-12 max-w-2xl">
          <div className="font-mono text-[12px] uppercase tracking-[0.2em] text-seal">
            {message("account.eyebrow")}
          </div>
          <h1 className="letterpress mt-2.5 font-display text-[clamp(34px,6vw,68px)] font-medium leading-[0.96] tracking-[-0.01em] text-ink">
            {richMessage("account.signInTitle", { brand: <em className="italic text-paid">{message("account.signInBrand")}</em> })}
          </h1>
          <p className="mt-3 max-w-[54ch] text-[18px] leading-relaxed text-ink-2">
            {message("account.introduction")}
          </p>
        </header>

        <div className="max-w-md">
          <div className="border border-ink bg-paper p-8">
            {/* Step indicator */}
            <div className="mb-6 flex items-center gap-3">
              <StepDot active={true} done={isConnected} label="1" />
              <div className="h-px flex-1 bg-line" />
              <StepDot active={isConnected} done={!!session} label="2" />
              <div className="h-px flex-1 bg-line" />
              <StepDot active={!!session} done={false} label="3" />
            </div>

            {!isConnected && <ConnectStep isBusy={authState !== "idle"} />}

            {isConnected && !identityMatches && (
              <SignInStep
                address={address!}
                onSignIn={handleSignIn}
                onDisconnect={() => disconnect()}
                authState={authState}
                chainGuard={chainGuard}
              />
            )}
            {isConnected && <div className="mt-4"><CircleGoogleWalletButton reconnectOnly onConnected={handleGoogleConnected} /></div>}

            {isConnected && session && identityMatches && returnTo === undefined && <p role="status" className="text-sm">{message("account.checkingReturn")}</p>}
            {isConnected && session && identityMatches && returnTo !== undefined && (
              <SignedInStep session={session} onSignOut={handleSignOut} busy={authState !== "idle"} returnTo={returnTo} returnBlocked={!!returnTo && !registrationOwnerMatches(returnTo, session.address)} />
            )}
          </div>
        </div>
        {session && <div className="max-w-2xl"><AccountSessions key={session.address.toLowerCase()} /></div>}
      </main>
    </div>
  );
}
