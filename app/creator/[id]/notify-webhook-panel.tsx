"use client";

/**
 * Owner-only citation-webhook settings, shown inline on a creator's own profile so an
 * already-registered (e.g. seeded) source can add, rotate, or disable its notify webhook after the
 * fact. Self-gating: it asks GET /api/creator/[id]/notify and renders nothing unless the live SIWE
 * session owns this source — non-owners never see it (and never see a flash while it resolves).
 */

import { useEffect, useState } from "react";
import { Webhook, Copy, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";

export function NotifyWebhookPanel({ creatorId }: { creatorId: string }) {
  const [owner, setOwner] = useState(false); // stays false (renders nothing) until proven owner
  const [url, setUrl] = useState("");
  const [configured, setConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/creator/${creatorId}/notify`)
      .then(async (r) => {
        if (!r.ok) return; // 401/403/404 → not the owner, stay hidden
        const d = (await r.json()) as { configured?: boolean; url?: string | null };
        setOwner(true);
        setConfigured(Boolean(d.configured));
        setUrl(d.url ?? "");
      })
      .catch(() => {});
  }, [creatorId]);

  if (!owner) return null;

  const save = async (nextUrl: string) => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/creator/${creatorId}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: nextUrl }),
      });
      const d = (await res.json()) as { configured?: boolean; url?: string | null; secret?: string; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Failed to save webhook");
      setConfigured(Boolean(d.configured));
      setUrl(d.url ?? "");
      setSecret(d.secret ?? null);
      toast.success(d.configured ? "Webhook saved — signing secret shown once below." : "Webhook disabled.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save webhook");
    } finally {
      setSaving(false);
    }
  };

  const copySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      toast.success("Secret copied.");
    } catch {
      toast.error("Couldn't copy — select and copy the secret manually.");
    }
  };

  return (
    <section className="mb-8 border border-line bg-paper p-5">
      <h2 className="mb-1 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <Webhook className="h-3.5 w-3.5 text-seal" /> Citation webhook
      </h2>
      <p className="mb-4 max-w-xl font-serif text-[13px] text-ink-2">
        Get a signed POST the instant the agent cites you and pays — your own agent can react without
        polling. {configured ? "Active." : "Not set."}
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-agent.com/keryx-hook"
          className="bg-paper-2 font-mono text-sm"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => save(url.trim())}
            disabled={saving || !url.trim()}
            className="flex items-center justify-center gap-2 border border-ink bg-seal px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-cream transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)] active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Webhook className="h-3.5 w-3.5" />}
            {configured ? "Rotate" : "Save"}
          </button>
          {configured && (
            <button
              type="button"
              onClick={() => {
                setUrl("");
                save("");
              }}
              disabled={saving}
              title="Disable webhook"
              className="flex items-center justify-center rounded-md border border-line px-3 py-2 text-ink-3 transition-colors hover:bg-paper-2 hover:text-destructive disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {secret && (
        <div className="mt-4 space-y-2 rounded-md border border-seal/40 bg-seal/[0.06] p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-seal">
            Signing secret — shown once
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded border border-line bg-paper px-2.5 py-1.5 font-mono text-xs text-ink">
              {secret}
            </code>
            <button
              type="button"
              onClick={copySecret}
              title="Copy secret"
              className="shrink-0 rounded-md border border-line px-2 py-1.5 text-ink transition-colors hover:bg-paper-2"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="font-mono text-[10px] text-ink-3">
            Verify: <code>sha256=hex(hmac_sha256(secret, rawBody))</code> on the X-Keryx-Signature header.
          </p>
        </div>
      )}
    </section>
  );
}
