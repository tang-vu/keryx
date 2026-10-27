"use client";


import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Copy, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { verificationToken } from "@/lib/sources/feed-verification-token";
import { useUiMessages } from "@/lib/i18n/ui-copy";





export interface VerificationSource { id: string; walletAddress: string; verified?: boolean; rssUrl?: string | null }

/** This action only rechecks an existing source. It never registers or sends a wallet transaction. */
export function FeedVerificationPanel({ source, enabled = true, onVerified }: {
  source: VerificationSource; enabled?: boolean; onVerified?: () => void;
}) {
  const uiCopy = useUiMessages();
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
      if (res.status === 404) throw new Error(uiCopy("feedVerification.notIndexed"));
      if (!res.ok) throw new Error(data.error ?? uiCopy("feedVerification.checkFailed"));
      if (data.verified === true) { setDone(true); onVerified?.(); }
      else setMessage(data.message ?? uiCopy("feedVerification.notFound"));
    } catch (err) { if (current()) setMessage(err instanceof Error ? err.message : uiCopy("feedVerification.feedFailed")); }
    finally { busy.current = false; if (mounted.current) setChecking(false); }
  };
  if (done) return <p role="status" className="border border-paid/40 bg-paid/10 p-3 text-sm">{uiCopy("feedVerification.verified")}</p>;
  return <section aria-label={uiCopy("feedVerification.region")} className="space-y-3 border border-amber-500/40 bg-amber-500/[0.07] p-4">
    <h3 className="font-display text-lg">{uiCopy("feedVerification.title")}</h3>
    <p className="text-sm text-ink-2">{uiCopy("feedVerification.instructions")}</p>
    <p className="break-all text-xs">{uiCopy("feedVerification.wallet", { wallet: source.walletAddress })}</p>
    {source.rssUrl && <p className="break-all text-xs">{uiCopy("feedVerification.feed", { url: source.rssUrl })}</p>}
    <div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all border border-line bg-paper p-2 font-mono text-xs">{token}</code><VerificationTokenCopy key={JSON.stringify([identity, owner])} token={token} /></div>
    {!enabled && <p role="status" className="text-sm">{uiCopy("feedVerification.waitForIndex")}</p>}
    {!ownerMatches && <p role="status" className="text-sm">{uiCopy("feedVerification.signIn")}</p>}
    {message && <p role="status" className="text-sm text-seal">{message}</p>}
    <button type="button" onClick={() => void verify()} disabled={checking || !enabled || !ownerMatches} className="flex items-center gap-2 border border-ink px-4 py-2 text-sm disabled:opacity-50">{checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{checking ? uiCopy("feedVerification.checking") : uiCopy("feedVerification.verify")}</button>
  </section>;
}

function VerificationTokenCopy({ token }: { token: string }) {
  const uiCopy = useUiMessages();
  const mounted = useRef(true), busy = useRef(false);
  const [pending, setPending] = useState(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const copy = async () => {
    if (busy.current) return;
    busy.current = true; setPending(true);
    try {
      await navigator.clipboard.writeText(token);
      if (mounted.current) toast.success(uiCopy("feedVerification.copied"));
    } catch {
      if (mounted.current) toast.error(uiCopy("feedVerification.copyUnavailable"));
    } finally { busy.current = false; if (mounted.current) setPending(false); }
  };
  return <button type="button" onClick={() => void copy()} aria-busy={pending} aria-disabled={pending} aria-label={uiCopy("feedVerification.copyLabel")} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal aria-disabled:cursor-wait"><Copy className="h-4 w-4" /></button>;
}
