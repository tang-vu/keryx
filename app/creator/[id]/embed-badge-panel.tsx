"use client";

/**
 * Public "Cited by Keryx" embed panel on a creator's page. Shows the live badge
 * (rendered from /api/creator/[id]/badge.svg) plus copy-paste Markdown + HTML
 * snippets, so any creator can display — verifiably, on their own site — that AI
 * agents pay them per citation. This is the monetization flywheel: the badge links
 * back to the creator's live earnings page, turning payouts into proof and reach.
 */


import { BadgeCheck, Copy } from "lucide-react";
import { toast } from "sonner";
import { useBrowserOrigin } from "@/lib/hooks/use-browser-origin";
import { useUiMessages } from "@/lib/i18n/ui-copy";





// SSR + first client render agree on the canonical host; refined to the real origin on mount
// so localhost/preview embeds copy the right URL too.
const CANONICAL = "https://keryx.cc";

export function EmbedBadgePanel({ creatorId }: { creatorId: string }) {
  const uiCopy = useUiMessages();
  const origin = useBrowserOrigin(CANONICAL);

  const badgeUrl = `${origin}/api/creator/${creatorId}/badge.svg`;
  const pageUrl = `${origin}/creator/${creatorId}`;
  const markdown = `[![${uiCopy("creatorBadge.snippetAlt")}](${badgeUrl})](${pageUrl})`;
  const html = `<a href="${pageUrl}"><img src="${badgeUrl}" alt="${uiCopy("creatorBadge.snippetAlt")}"></a>`;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(uiCopy("creatorBadge.copied", { label }));
    } catch {
      toast.error(uiCopy("creatorBadge.copyFailed"));
    }
  };

  return (
    <section className="mb-8 border border-line bg-paper p-5">
      <h2 className="mb-1 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <BadgeCheck className="h-3.5 w-3.5 text-seal" /> {uiCopy("creatorBadge.title")}
      </h2>
      <p className="mb-4 max-w-xl font-serif text-[13px] text-ink-2">
        {uiCopy("creatorBadge.description")}
      </p>

      {/* Live preview straight from the endpoint */}
      <div className="mb-4 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={badgeUrl} alt={uiCopy("creatorBadge.alt")} className="h-5" />
        <span className="font-mono text-[10px] text-ink-3">{uiCopy("creatorBadge.preview")}</span>
      </div>

      <div className="space-y-2">
        <SnippetRow label="Markdown" value={markdown} onCopy={() => copy(markdown, "Markdown")} />
        <SnippetRow label="HTML" value={html} onCopy={() => copy(html, "HTML")} />
      </div>
    </section>
  );
}

function SnippetRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  const uiCopy = useUiMessages();
  return (
    <div>
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto whitespace-nowrap rounded border border-line bg-paper-2 px-2.5 py-1.5 font-mono text-[11px] text-ink">
          {value}
        </code>
        <button
          type="button"
          onClick={onCopy}
          title={uiCopy("creatorBadge.copyTitle", { label })}
          className="shrink-0 rounded-md border border-line px-2 py-1.5 text-ink transition-colors hover:bg-paper-2"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
