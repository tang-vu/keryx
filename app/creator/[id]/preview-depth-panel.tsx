"use client";

/**
 * Owner-only free-preview depth control, shown inline on a creator's own profile. Self-gating: it
 * asks GET /api/creator/[id]/preview-depth and renders nothing unless the live SIWE session owns
 * this source — the same pattern as NotifyWebhookPanel, so non-owners never see it (or a flash).
 *
 * The depth is the creator's incentive dial (see lib/sources/preview-depth.ts): how much of each
 * item the free preview reveals to the agent before it decides to pay the toll.
 */


import { useEffect, useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { previewDepthLabels } from "@/lib/i18n/creator-preview";
import {
  PREVIEW_DEPTHS,
  type PreviewDepth,
} from "@/lib/sources/preview-depth";
import { useUiMessages } from "@/lib/i18n/ui-copy";





export function PreviewDepthPanel({ creatorId }: { creatorId: string }) {
  const uiCopy = useUiMessages();
  const [owner, setOwner] = useState(false); // stays false (renders nothing) until proven owner
  const [depth, setDepth] = useState<PreviewDepth>("full");
  const [saving, setSaving] = useState<PreviewDepth | null>(null);

  useEffect(() => {
    fetch(`/api/creator/${creatorId}/preview-depth`)
      .then(async (r) => {
        if (!r.ok) return; // 401/403/404 → not the owner, stay hidden
        const d = (await r.json()) as { depth?: PreviewDepth };
        setOwner(true);
        if (d.depth) setDepth(d.depth);
      })
      .catch(() => {});
  }, [creatorId]);

  if (!owner) return null;

  const choose = async (next: PreviewDepth) => {
    if (saving || next === depth) return;
    setSaving(next);
    const prev = depth;
    setDepth(next); // optimistic — revert on failure
    try {
      const res = await fetch(`/api/creator/${creatorId}/preview-depth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depth: next }),
      });
      const d = (await res.json()) as { depth?: PreviewDepth; error?: string };
      if (!res.ok) throw new Error(d.error ?? uiCopy("creatorPreview.failed"));
      toast.success(uiCopy("creatorPreview.saved", { label: previewDepthLabels[next].label }));
    } catch (e) {
      setDepth(prev);
      toast.error(e instanceof Error ? e.message : uiCopy("creatorPreview.failed"));
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="mb-8 border border-line bg-paper p-5">
      <h2 className="mb-1 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <Eye className="h-3.5 w-3.5 text-seal" /> {uiCopy("creatorPreview.title")}
      </h2>
      <p className="mb-4 max-w-xl font-serif text-[13px] text-ink-2">
        {uiCopy("creatorPreview.description")}
      </p>

      <div className="grid gap-2 sm:grid-cols-3">
        {PREVIEW_DEPTHS.map((d) => {
          const selected = d === depth;
          return (
            <button
              key={d}
              type="button"
              onClick={() => choose(d)}
              disabled={saving !== null}
              aria-pressed={selected}
              className={
                "flex flex-col gap-1 border p-3 text-left transition-colors disabled:cursor-not-allowed " +
                (selected
                  ? "border-seal bg-seal/[0.07]"
                  : "border-line bg-paper-2 hover:border-seal/50")
              }
            >
              <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-ink">
                {saving === d ? <Loader2 className="h-3 w-3 animate-spin text-seal" /> : null}
                {previewDepthLabels[d].label}
                {selected && saving === null ? <span className="text-seal">✓</span> : null}
              </span>
              <span className="font-serif text-[12px] leading-snug text-ink-3">
                {previewDepthLabels[d].hint}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
