"use client";

import { createMessages } from "@/lib/i18n/messages";
import { useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";

const uiCopy = createMessages("en");

export function WantedShareButton({
  url,
  claim,
}: {
  url: string;
  claim: string;
}) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: uiCopy("wantedShare.title"),
          text: uiCopy("wantedShare.text", { claim }),
          url,
        });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch (error) {
      // Closing the native share sheet is not an error the page needs to surface.
      if (error instanceof DOMException && error.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2_000);
      } catch {
        // The URL remains visible in the browser address bar as the manual fallback.
      }
    }
  };

  return (
    <button
      type="button"
      onClick={share}
      className="inline-flex items-center gap-2 border border-ink bg-ink px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-paper transition-colors hover:bg-seal"
    >
      {copied ? <Check size={14} aria-hidden /> : <Share2 size={14} aria-hidden />}
      {copied ? uiCopy("wantedShare.copied") : uiCopy("wantedShare.share")}
      <Copy size={12} className="opacity-60" aria-hidden />
    </button>
  );
}
