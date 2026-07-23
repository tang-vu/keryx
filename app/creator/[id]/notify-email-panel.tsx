"use client";

/**
 * Owner-only citation email-alert settings — the human channel beside the webhook panel.
 * Same self-gating pattern: it asks GET /api/creator/[id]/notify and renders nothing unless the
 * live SIWE session owns this source. When the deployment has no email provider configured the
 * panel still saves the address but says delivery is dark, so nobody is silently promised mail.
 */

import { useEffect, useState } from "react";
import { Mail, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";

export function NotifyEmailPanel({ creatorId }: { creatorId: string }) {
  const [owner, setOwner] = useState(false); // stays false (renders nothing) until proven owner
  const [email, setEmail] = useState("");
  const [configured, setConfigured] = useState(false);
  const [deliveryOn, setDeliveryOn] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/creator/${creatorId}/notify`)
      .then(async (r) => {
        if (!r.ok) return; // 401/403/404 → not the owner, stay hidden
        const d = (await r.json()) as { email?: string | null; emailEnabled?: boolean };
        setOwner(true);
        setConfigured(Boolean(d.email));
        setEmail(d.email ?? "");
        setDeliveryOn(Boolean(d.emailEnabled));
      })
      .catch(() => {});
  }, [creatorId]);

  if (!owner) return null;

  const save = async (nextEmail: string) => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/creator/${creatorId}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: nextEmail }),
      });
      const d = (await res.json()) as { email?: string | null; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Failed to save email");
      setConfigured(Boolean(d.email));
      setEmail(d.email ?? "");
      toast.success(d.email ? "Email alerts on — you'll hear when you're cited." : "Email alerts off.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save email");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mb-8 border border-line bg-paper p-5">
      <h2 className="mb-1 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <Mail className="h-3.5 w-3.5 text-seal" /> Citation email alerts
      </h2>
      <p className="mb-4 max-w-xl font-serif text-[13px] text-ink-2">
        Get a short email when the agent cites you and the payout settles — no webhook server
        needed. At most one per hour; every payout still shows here. {configured ? "Active." : "Not set."}
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="bg-paper-2 font-mono text-sm"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => save(email.trim())}
            disabled={saving || !email.trim()}
            className="flex items-center justify-center gap-2 border border-ink bg-seal px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-cream transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)] active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
            {configured ? "Update" : "Save"}
          </button>
          {configured && (
            <button
              type="button"
              onClick={() => {
                setEmail("");
                save("");
              }}
              disabled={saving}
              title="Disable email alerts"
              className="flex items-center justify-center rounded-md border border-line px-3 py-2 text-ink-3 transition-colors hover:bg-paper-2 hover:text-destructive disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {!deliveryOn && (
        <p className="mt-3 font-mono text-[10px] text-ink-3">
          Saved addresses are kept, but this deployment hasn&apos;t enabled an email provider yet —
          delivery starts the moment it does.
        </p>
      )}

      <p className="mt-3 font-mono text-[10px] text-ink-3">
        Own several sources?{" "}
        <a href="/me/sources" className="text-seal underline underline-offset-2 hover:text-ink">
          Manage them all in one place →
        </a>
      </p>
    </section>
  );
}
