"use client";
import { useEffect, useState } from "react";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { FeedVerificationPanel, type VerificationSource } from "./feed-verification-panel";

export function OwnerFeedVerification({ sourceId, onVerified }: { sourceId: string; onVerified?: () => void }) {
  const { session } = useSiweAuth();
  const sessionAddress = session?.address;
  const [source, setSource] = useState<VerificationSource | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    if (!sessionAddress) return;
    void fetch(`/api/sources/verify?sourceId=${encodeURIComponent(sourceId)}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) })
      .then(async res => {
        if ([401, 403].includes(res.status)) return null;
        if (!res.ok) throw new Error("Verification source unavailable");
        return (await res.json()).source as VerificationSource;
      })
      .then(value => { if (active) { setSource(value); setUnavailable(false); } })
      .catch(() => { if (active) { setSource(null); setUnavailable(true); } });
    return () => { active = false; };
  }, [sourceId, sessionAddress, retry]);
  if (!session) return null;
  if (unavailable) return <p role="status" className="mb-6 text-sm">Feed verification is unavailable or this source is not indexed yet. <button className="underline" onClick={() => setRetry(value => value + 1)}>Retry</button>. Do not register it again.</p>;
  if (!source || source.id !== sourceId || source.walletAddress.toLowerCase() !== session.address.toLowerCase() || !source.rssUrl || source.verified) return null;
  return <div className="mb-6"><FeedVerificationPanel key={`${source.id}:${source.walletAddress}`} source={source} onVerified={onVerified} /></div>;
}
