"use client";

/**
 * /connect — wallet connect + SIWE sign-in page. Styled as The Mint: Bodoni
 * display type, banknote borders, vermillion (seal) accent. No RainbowKit —
 * custom flow built on wagmi primitives to preserve the design system.
 *
 * Flow:
 *   1. Not connected → show EIP-6963 wallet picker (all discovered wallets)
 *   2. Connected on wrong chain → show "Switch to Arc Testnet" banner
 *   3. Connected on Arc Testnet, not signed in → show "Sign In" button (SIWE)
 *   4. Signed in → show address + role badge + "Sign out" / link to register
 *
 * The sign-in flow itself lives in the shared useSiweAuth hook (also used by the
 * header wallet menu); this page only renders the step UI around it.
 */

import { useCallback } from "react";
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

export default function ConnectPage() {
  const { disconnect, disconnectAsync } = useDisconnect();
  const chainGuard = useArcChainGuard();
  const { address, isConnected, session, authState, signIn, signOut } = useSiweAuth();

  const handleSignIn = useCallback(async () => {
    try {
      const res = await signIn();
      if (res.ok) {
        toast.success(res.created ? "Account created" : "Signed in to Keryx", {
          description: `Role: ${res.role}`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-in failed";
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
      await disconnectAsync();
    } catch {
      /* already disconnected — ignore */
    }
    await signOut();
    toast("Signed out");
  }, [disconnectAsync, signOut]);

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-16 sm:px-8">
        <header className="mb-12 max-w-2xl">
          <div className="font-mono text-[12px] uppercase tracking-[0.2em] text-seal">
            Wallet authentication
          </div>
          <h1 className="letterpress mt-2.5 font-display text-[clamp(34px,6vw,68px)] font-medium leading-[0.96] tracking-[-0.01em] text-ink">
            Connect your <em className="italic text-paid">wallet.</em>
          </h1>
          <p className="mt-3 max-w-[54ch] text-[18px] leading-relaxed text-ink-2">
            Your wallet is your identity on Keryx. Sign in with Ethereum to
            register sources, earn tolls, and manage your creator profile.
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

            {isConnected && !session && (
              <SignInStep
                address={address!}
                onSignIn={handleSignIn}
                onDisconnect={() => disconnect()}
                authState={authState}
                chainGuard={chainGuard}
              />
            )}

            {isConnected && session && (
              <SignedInStep session={session} onSignOut={handleSignOut} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
