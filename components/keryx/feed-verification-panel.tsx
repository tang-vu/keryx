"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Copy, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { verificationToken } from "@/lib/sources/feed-verification-token";

export interface VerificationSource { id: string; walletAddress: string; verified?: boolean; rssUrl?: string | null }

/** This action only rechecks an existing source. It never registers or sends a wallet transaction. */
export function FeedVerificationPanel({ source, enabled = true, onVerified }: {
  source: VerificationSource; enabled?: boolean; onVerified?: () => void;
}) {
  const { session } = useSiweAuth();
  const identity = `${source.id}:${source.walletAddress.toLowerCase()}`;
  const owner = session?.address.toLowerCase();
  const latest = useRef({ identity, owner });
  const mounted = useRef(true);
  useLayoutEffect(() => { latest.current = { identity, owner }; }, [identity, owner]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const ownerMatches = owner === source.walletAddress.toLowerCase();
  const [checking, setChecking] = useState(false);
  const [done, setDone] = useState(source.verified === true);
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  const token = verificationToken(source.walletAddress);
  const copy = async () => {
    try { await navigator.clipboard.writeText(token); toast.success("Token copied. Paste it into your feed."); }
    catch { toast.error("Select and copy the token manually."); }
  };
  const verify = async () => {
    if (busy.current || !enabled || !ownerMatches) return;
    const current = () => mounted.current && latest.current.identity === identity && latest.current.owner === owner;
    busy.current = true; setChecking(true); setMessage("");
    try {
      const res = await fetch("/api/sources/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: source.id }), signal: AbortSignal.timeout(20_000),
      });
      const data = await res.json() as { verified?: boolean; message?: string; error?: string };
      if (!current()) return;
      if (res.status === 404) throw new Error("This source is not available in the index. Retry later; do not register it again.");
      if (!res.ok) throw new Error(data.error ?? "The verification check could not finish. Retry safely.");
      if (data.verified === true) { setDone(true); onVerified?.(); }
      else setMessage(data.message ?? "Token not found in the feed yet. Publish the exact token, then retry.");
    } catch (err) { if (current()) setMessage(err instanceof Error ? err.message : "The feed could not be checked. Retry safely."); }
    finally { busy.current = false; if (mounted.current) setChecking(false); }
  };
  if (done) return <p role="status" className="border border-paid/40 bg-paid/10 p-3 text-sm">Feed ownership verified. Paid discovery also requires an active, indexed listing.</p>;
  return <section aria-label="Feed ownership verification" className="space-y-3 border border-amber-500/40 bg-amber-500/[0.07] p-4">
    <h3 className="font-display text-lg">Verify feed ownership</h3>
    <p className="text-sm text-ink-2">Publish this exact token anywhere in your RSS feed (for example its description or a post), wait for it to publish, then check below. This verifies the existing source without a new registration or gas payment.</p>
    <p className="break-all text-xs">Payout wallet: {source.walletAddress}</p>
    {source.rssUrl && <p className="break-all text-xs">Feed: {source.rssUrl}</p>}
    <div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all border border-line bg-paper p-2 font-mono text-xs">{token}</code><button type="button" onClick={() => void copy()} aria-label="Copy verification token"><Copy className="h-4 w-4" /></button></div>
    {!enabled && <p role="status" className="text-sm">Wait until registration is confirmed and indexed before verifying. Do not register this source again.</p>}
    {!ownerMatches && <p role="status" className="text-sm">Sign in with this source&apos;s payout wallet to verify ownership.</p>}
    {message && <p role="status" className="text-sm text-seal">{message}</p>}
    <button type="button" onClick={() => void verify()} disabled={checking || !enabled || !ownerMatches} className="flex items-center gap-2 border border-ink px-4 py-2 text-sm disabled:opacity-50">{checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{checking ? "Checking feed..." : "Verify ownership"}</button>
  </section>;
}
