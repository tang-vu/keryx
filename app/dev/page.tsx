"use client";

/**
 * Developer Portal — wallet-gated API key management.
 *
 * Lists the signed-in wallet's API keys, mints new ones (raw key shown once),
 * revokes existing ones, and shows a 30-day usage chart per key.
 *
 * Keys are identity + rate-limit only. x402 payment-signature is still
 * required on every /api/agent/ask call — keys do not grant free compute.
 */

import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/keryx/site-header";
import { shortAddr } from "@/components/keryx/phase-style";
import { Copy, Key, Plus, Trash2, X } from "lucide-react";
import type { ApiKeyRow, ApiKeyUsage } from "@/lib/db/keryx-db";

interface KeyWithUsage extends ApiKeyRow {
  usage?: ApiKeyUsage[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function copyToClipboard(text: string) {
  void navigator.clipboard.writeText(text).catch(() => null);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Mini usage bar chart ──────────────────────────────────────────────────────

function UsageBar({ usage }: { usage: ApiKeyUsage[] }) {
  if (!usage.length) {
    return <p className="font-mono text-xs text-ink-3">No calls yet.</p>;
  }
  const max = Math.max(...usage.map((u) => u.count), 1);
  // Show up to 14 most recent days left→right (oldest first).
  const visible = [...usage].reverse().slice(-14);

  return (
    <div className="flex items-end gap-px" style={{ height: 32 }}>
      {visible.map((u) => (
        <div key={u.day} className="group relative flex-1" title={`${u.day}: ${u.count} calls`}>
          <div
            className="w-full rounded-sm bg-seal/70 transition-all group-hover:bg-seal"
            style={{ height: `${Math.max(2, Math.round((u.count / max) * 32))}px` }}
          />
        </div>
      ))}
    </div>
  );
}

// ── Raw-key modal (shown once at mint) ───────────────────────────────────────

function RawKeyModal({ rawKey, onClose }: { rawKey: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    copyToClipboard(rawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 backdrop-blur-sm">
      <div className="relative mx-4 max-w-lg w-full rounded border border-seal/50 bg-paper p-6 shadow-2xl">
        {/* Herald ornament */}
        <div className="mb-4 text-center font-serif text-xs tracking-widest text-seal uppercase">
          — Copy your key now —
        </div>
        <p className="mb-3 font-serif text-sm text-ink-2">
          This key will <strong>never be shown again</strong>. Store it in your secrets manager.
          If it is compromised, revoke it immediately from this dashboard.
        </p>

        {/* Key display */}
        <div className="flex items-center gap-2 rounded border border-line bg-paper-2 px-3 py-2">
          <code className="flex-1 break-all font-mono text-[11px] text-ink select-all">
            {rawKey}
          </code>
          <button
            onClick={handleCopy}
            className="shrink-0 rounded border border-line p-1.5 text-ink-2 hover:border-seal hover:text-seal transition-colors"
            title="Copy to clipboard"
          >
            <Copy size={14} />
          </button>
        </div>

        {copied && (
          <p className="mt-1.5 text-center font-mono text-xs text-paid">Copied!</p>
        )}

        <p className="mt-3 font-mono text-[10px] text-ink-3 text-center">
          x402 payment-signature is still required on every /api/agent/ask call.
          This key adds identity + rate-limit only.
        </p>

        <button
          onClick={onClose}
          className="mt-4 w-full rounded border border-seal bg-seal/10 py-2 font-mono text-sm text-seal hover:bg-seal/20 transition-colors"
        >
          I have copied my key
        </button>

        <button
          onClick={onClose}
          className="absolute right-3 top-3 text-ink-3 hover:text-ink transition-colors"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

// ── Key card ─────────────────────────────────────────────────────────────────

function KeyCard({
  apiKey,
  onRevoke,
}: {
  apiKey: KeyWithUsage;
  onRevoke: (id: string) => void;
}) {
  const isRevoked = Boolean(apiKey.revokedAt);

  return (
    <div
      className={`rounded border p-4 transition-colors ${
        isRevoked ? "border-line bg-paper opacity-60" : "border-line bg-paper hover:border-ink-3"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Key size={13} className={isRevoked ? "text-ink-3" : "text-seal"} />
            <code className="font-mono text-xs text-ink truncate">{apiKey.prefix}…</code>
            {apiKey.label && (
              <span className="rounded bg-paper-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-2">
                {apiKey.label}
              </span>
            )}
            {isRevoked && (
              <span className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-[10px] text-red-600">
                revoked
              </span>
            )}
          </div>
          <div className="mt-1 flex gap-4 font-mono text-[10px] text-ink-3">
            <span>Created {fmtDate(apiKey.createdAt)}</span>
            <span>Last used {fmtDate(apiKey.lastUsedAt)}</span>
          </div>
        </div>

        {!isRevoked && (
          <button
            onClick={() => onRevoke(apiKey.id)}
            className="shrink-0 rounded border border-line p-1.5 text-ink-3 hover:border-red-400 hover:text-red-500 transition-colors"
            title="Revoke key"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {!isRevoked && apiKey.usage && (
        <div className="mt-3">
          <p className="mb-1 font-mono text-[9px] uppercase tracking-widest text-ink-3">
            Calls (last 14 days)
          </p>
          <UsageBar usage={apiKey.usage} />
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DevPage() {
  const [keys, setKeys] = useState<KeyWithUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [showMintForm, setShowMintForm] = useState(false);
  const [rawKey, setRawKey] = useState<string | null>(null);

  async function loadKeys() {
    setLoading(true);
    try {
      const res = await fetch("/api/keys", { cache: "no-store" });
      if (res.status === 401) {
        setError("Sign in with your wallet to manage API keys.");
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as ApiKeyRow[];

      // Load usage for each active key in parallel.
      const withUsage = await Promise.all(
        data.map(async (k) => {
          if (k.revokedAt) return { ...k, usage: [] };
          try {
            const ur = await fetch(`/api/keys/${k.id}/usage`, { cache: "no-store" });
            const usage = ur.ok ? ((await ur.json()) as ApiKeyUsage[]) : [];
            return { ...k, usage };
          } catch {
            return { ...k, usage: [] };
          }
        }),
      );
      setKeys(withUsage);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadKeys(); }, []);

  async function handleMint(e: React.FormEvent) {
    e.preventDefault();
    setMinting(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel.trim() || undefined }),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const { rawKey: rk } = (await res.json()) as { rawKey: string; prefix: string; id: string };
      setRawKey(rk);
      setNewLabel("");
      setShowMintForm(false);
      void loadKeys();
    } catch (e) {
      setError(String(e));
    } finally {
      setMinting(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm("Revoke this key? All callers using it will get 401 immediately.")) return;
    try {
      await fetch(`/api/keys/${id}`, { method: "DELETE" });
      void loadKeys();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <>
      <SiteHeader />
      {rawKey && <RawKeyModal rawKey={rawKey} onClose={() => setRawKey(null)} />}

      <main className="mx-auto max-w-[820px] px-4 py-10 sm:px-8">
        {/* Page header */}
        <div className="mb-8 border-b border-line pb-6">
          <h1 className="font-serif text-2xl text-ink">Developer Portal</h1>
          <p className="mt-1 font-mono text-xs text-ink-3">
            Wallet-issued API keys for programmatic access to{" "}
            <code className="text-seal">/api/agent/ask</code>. Keys add identity + rate-limit only
            — x402 <code className="text-seal">payment-signature</code> is still required per call.
          </p>
          <div className="mt-3 flex gap-3">
            <a
              href="/api/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs text-ink-2 underline underline-offset-2 hover:text-seal transition-colors"
            >
              API Reference →
            </a>
            <a
              href="/api/openapi.json"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs text-ink-2 underline underline-offset-2 hover:text-seal transition-colors"
            >
              OpenAPI JSON →
            </a>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-6 rounded border border-red-300 bg-red-50 px-4 py-3 font-mono text-xs text-red-700">
            {error}
          </div>
        )}

        {/* Mint form */}
        <div className="mb-6">
          {!showMintForm ? (
            <button
              onClick={() => setShowMintForm(true)}
              className="flex items-center gap-2 rounded border border-seal bg-seal/10 px-4 py-2 font-mono text-sm text-seal hover:bg-seal/20 transition-colors"
            >
              <Plus size={14} /> Issue new key
            </button>
          ) : (
            <form
              onSubmit={(e) => void handleMint(e)}
              className="flex items-center gap-2 rounded border border-seal/40 bg-paper p-3"
            >
              <input
                type="text"
                placeholder="Label (optional)"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                maxLength={80}
                className="flex-1 rounded border border-line bg-paper-2 px-3 py-1.5 font-mono text-xs text-ink placeholder-ink-3 focus:border-seal focus:outline-none"
              />
              <button
                type="submit"
                disabled={minting}
                className="rounded border border-seal bg-seal/10 px-4 py-1.5 font-mono text-xs text-seal hover:bg-seal/20 disabled:opacity-50 transition-colors"
              >
                {minting ? "Minting…" : "Mint"}
              </button>
              <button
                type="button"
                onClick={() => setShowMintForm(false)}
                className="text-ink-3 hover:text-ink transition-colors"
              >
                <X size={14} />
              </button>
            </form>
          )}
        </div>

        {/* Key list */}
        {loading ? (
          <p className="font-mono text-xs text-ink-3">Loading keys…</p>
        ) : keys.length === 0 && !error ? (
          <div className="rounded border border-dashed border-line p-8 text-center">
            <Key size={24} className="mx-auto mb-2 text-ink-3" />
            <p className="font-mono text-xs text-ink-3">No API keys yet. Issue one above.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {keys.map((k) => (
              <KeyCard key={k.id} apiKey={k} onRevoke={(id) => void handleRevoke(id)} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
