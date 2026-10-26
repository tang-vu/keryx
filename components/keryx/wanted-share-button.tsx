"use client";


import { useEffect, useRef, useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { useUiMessages } from "@/lib/i18n/ui-copy";





export function WantedShareButton({
  url,
  claim,
}: {
  url: string;
  claim: string;
}) {
  return <WantedShareAction key={url} url={url} claim={claim} />;
}

function WantedShareAction({ url, claim }: { url: string; claim: string }) {
  const uiCopy = useUiMessages();
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false), [manual, setManual] = useState(false);
  const active = useRef(false), attempt = useRef(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { attempt.current++; clearTimeout(resetTimer.current); }, []);

  const share = async () => {
    if (active.current) return;
    active.current = true;
    const current = ++attempt.current, isCurrent = () => attempt.current === current;
    clearTimeout(resetTimer.current); setSharing(true); setCopied(false); setManual(false);
    try {
      if (navigator.share) {
        try {
          await navigator.share({ title: uiCopy("wantedShare.title"), text: uiCopy("wantedShare.text", { claim }), url });
          return;
        } catch (error) {
          // Native cancellation should not initiate a clipboard write.
          if (error instanceof DOMException && error.name === "AbortError" || !isCurrent()) return;
        }
      }
      await navigator.clipboard.writeText(url);
      if (isCurrent()) {
        setCopied(true);
        resetTimer.current = setTimeout(() => setCopied(false), 2_000);
      }
    } catch { if (isCurrent()) setManual(true); }
    finally {
      active.current = false;
      if (isCurrent()) setSharing(false);
    }
  };

  return (
    <div className="min-w-0 max-w-full">
    <button
      type="button"
      onClick={share}
      disabled={sharing}
      className="inline-flex min-h-11 items-center gap-2 border border-ink bg-ink px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-paper transition-colors hover:bg-seal disabled:opacity-50"
    >
      {copied ? <Check size={14} aria-hidden /> : <Share2 size={14} aria-hidden />}
      {copied ? uiCopy("wantedShare.copied") : uiCopy("wantedShare.share")}
      <Copy size={12} className="opacity-60" aria-hidden />
    </button>
    {manual && <textarea readOnly rows={2} value={url} aria-label={uiCopy("wantedShare.share")}
      ref={element => { element?.focus(); element?.select(); }}
      onFocus={event => event.currentTarget.select()}
      className="mt-3 block min-h-11 w-full min-w-0 max-w-full border border-line bg-paper px-3 py-2 font-mono text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal" />}
    </div>
  );
}
