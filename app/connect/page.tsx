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
 * Step sub-components live in components/keryx/connect-steps.tsx.
 */

import { useState, useCallback } from "react";
import { useAccount, useDisconnect, useSignMessage } from "wagmi";
import { SiweMessage } from "siwe";
import { toast } from "sonner";
import { SiteHeader } from "@/components/keryx/site-header";
import {
  StepDot,
  ConnectStep,
  SignInStep,
  SignedInStep,
  type AuthState,
} from "@/components/keryx/connect-steps";
import { useArcChainGuard } from "@/lib/hooks/use-arc-chain-guard";

export default function ConnectPage() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const chainGuard = useArcChainGuard();

  const [authState, setAuthState] = useState<AuthState>("idle");
  const [session, setSession] = useState<{ address: string; role: string } | null>(null);

  // isBusy covers the connecting state from the WalletPicker's own useConnect
  // plus any local auth state — passed down so the picker can disable itself.
  const isBusy = authState !== "idle";

  const handleSignIn = useCallback(async () => {
    if (!address) return;
    setAuthState("signing");
    try {
      // Fetch a single-use nonce from the server. It lives in an httpOnly cookie;
      // we only receive the value here to embed in the SIWE message.
      const nonceRes = await fetch("/api/auth/nonce");
      if (!nonceRes.ok) throw new Error("Failed to get nonce");
      const { nonce } = (await nonceRes.json()) as { nonce: string };

      const message = new SiweMessage({
        domain: window.location.host,
        address,
        // ASCII only — EIP-4361's ABNF statement grammar rejects non-ASCII (e.g. an
        // em-dash), which makes the siwe parser throw "invalid message". Keep it plain.
        statement: "Sign in to Keryx. Citations are currency.",
        uri: window.location.origin,
        version: "1",
        chainId: 5042002,
        nonce,
        issuedAt: new Date().toISOString(),
        expirationTime: new Date(Date.now() + 7 * 86400e3).toISOString(),
      });
      const prepared = message.prepareMessage();

      setAuthState("verifying");
      const signature = await signMessageAsync({ message: prepared });

      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prepared, signature }),
      });
      const verifyData = (await verifyRes.json()) as {
        ok?: boolean;
        address?: string;
        role?: string;
        error?: string;
      };
      if (!verifyRes.ok) throw new Error(verifyData.error ?? "Verification failed");

      // Fetch the session with a FRESH role so the badge always reflects the
      // current env/DB state rather than the role baked at JWT-mint time.
      const sessionRes = await fetch("/api/auth/session");
      const sessionData = (await sessionRes.json()) as {
        session?: { address: string; role: string } | null;
      };
      const freshSession = sessionData.session ?? {
        address: verifyData.address!,
        role: verifyData.role!,
      };

      setSession({ address: freshSession.address, role: freshSession.role });
      toast.success("Signed in to Keryx", { description: `Role: ${freshSession.role}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-in failed";
      // User rejected the signature request — don't show an error toast for that.
      if (!msg.toLowerCase().includes("rejected") && !msg.toLowerCase().includes("denied")) {
        toast.error(msg);
      }
    } finally {
      setAuthState("idle");
    }
  }, [address, signMessageAsync]);

  const handleSignOut = useCallback(async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    setSession(null);
    toast("Signed out");
  }, []);

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

            {!isConnected && (
              <ConnectStep isBusy={isBusy} />
            )}

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
