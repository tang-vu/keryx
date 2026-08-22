"use client";

/**
 * Public "Ask Keryx on your site" panel on a creator's page. One copy-paste
 * script tag adds a floating ask button to the creator's own site: their
 * visitors ask with no wallet, and when the herald cites this creator, the
 * creator is paid — turning their existing audience into paying citations.
 * Complements the static badge (proof) with a live surface (demand).
 */

import { Copy, MessageSquareQuote } from "lucide-react";
import { toast } from "sonner";
import { useBrowserOrigin } from "@/lib/hooks/use-browser-origin";

// SSR + first client render agree on the canonical host; refined on mount so
// localhost/preview copies carry the right URL.
const CANONICAL = "https://keryx.cc";

export function EmbedWidgetPanel({ creatorId }: { creatorId: string }) {
  const origin = useBrowserOrigin(CANONICAL);

  const snippet = `<script src="${origin}/keryx-widget.js" data-keryx-source="${creatorId}" async></script>`;
  const previewUrl = `${origin}/embed?source=${encodeURIComponent(creatorId)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      toast.success("Widget snippet copied.");
    } catch {
      toast.error("Couldn't copy — select and copy manually.");
    }
  };

  return (
    <section className="mb-8 border border-line bg-paper p-5">
      <h2 className="mb-1 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <MessageSquareQuote className="h-3.5 w-3.5 text-seal" /> Put the herald on your site
      </h2>
      <p className="mb-4 max-w-xl font-serif text-[13px] text-ink-2">
        One line adds a floating &ldquo;Ask Keryx&rdquo; button to your own site. Your readers ask
        for free — no wallet — and every time the herald cites you in an answer, you&rsquo;re paid
        for it. Your audience becomes your toll traffic.
      </p>

      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto whitespace-nowrap rounded border border-line bg-paper-2 px-2.5 py-1.5 font-mono text-[11px] text-ink">
          {snippet}
        </code>
        <button
          type="button"
          onClick={copy}
          title="Copy widget snippet"
          className="shrink-0 rounded-md border border-line px-2 py-1.5 text-ink transition-colors hover:bg-paper-2"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>

      <a
        href={previewUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-block font-mono text-[10px] uppercase tracking-[0.12em] text-seal hover:underline"
      >
        Preview the panel ↗
      </a>
    </section>
  );
}
