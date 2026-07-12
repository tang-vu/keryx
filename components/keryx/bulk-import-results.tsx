"use client";

/**
 * Presentational results for a bulk feed import: one row per pasted feed with its live phase, plus
 * the shared feed-ownership token panel. All the creator's feeds share ONE verify token (it is keyed
 * to the payout wallet, not the source), so a single "Verify all" pass covers every row.
 */

import { CheckCircle2, Loader2, XCircle, ShieldCheck, Copy, ExternalLink, PenLine } from "lucide-react";
import { toast } from "sonner";

export type BulkPhase =
  | "ready"      // ingested, awaiting the creator's on-chain signature
  | "signing"    // wallet signature prompt open
  | "confirming" // tx submitted, waiting for the receipt
  | "done"       // on-chain (or offline row already written)
  | "failed"     // ingest or tx failed
  | "skipped";   // deselected by the creator

export interface BulkFeed {
  rssUrl: string;
  ok: boolean;
  status: number;
  mode?: string;
  sourceId?: string;
  error?: string;
  selected: boolean;
  phase: BulkPhase;
  txHash?: string;
}

const PHASE_LABEL: Record<BulkPhase, string> = {
  ready: "Ready to sign",
  signing: "Awaiting signature…",
  confirming: "Confirming on-chain…",
  done: "Registered",
  failed: "Failed",
  skipped: "Skipped",
};

function PhaseIcon({ phase }: { phase: BulkPhase }) {
  if (phase === "done") return <CheckCircle2 className="h-4 w-4 shrink-0 text-paid" />;
  if (phase === "failed") return <XCircle className="h-4 w-4 shrink-0 text-seal" />;
  if (phase === "signing" || phase === "confirming")
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-2" />;
  return null;
}

export function BulkImportResults({
  feeds,
  onToggle,
  busy,
}: {
  feeds: BulkFeed[];
  onToggle: (rssUrl: string) => void;
  busy: boolean;
}) {
  if (feeds.length === 0) return null;
  return (
    <ul className="divide-y divide-line border border-line bg-paper-2">
      {feeds.map((f) => {
        const dim = f.phase === "skipped" || (!f.ok && f.phase === "failed");
        return (
          <li key={f.rssUrl} className="flex items-center gap-3 px-3 py-2.5">
            {/* Only a ready-and-listable feed can be toggled; a failed ingest has nothing to sign. */}
            <input
              type="checkbox"
              checked={f.selected && f.ok}
              disabled={!f.ok || busy || f.phase === "done"}
              onChange={() => onToggle(f.rssUrl)}
              className="h-3.5 w-3.5 shrink-0 accent-seal"
            />
            <div className={`min-w-0 flex-1 ${dim ? "opacity-55" : ""}`}>
              <p className="truncate font-mono text-[12px] text-ink">{f.rssUrl}</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
                {f.ok ? PHASE_LABEL[f.phase] : f.error || "Could not read feed"}
              </p>
            </div>
            {f.txHash && (
              <a
                href={`https://testnet.arcscan.app/tx/${f.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                title="View on ArcScan"
                className="shrink-0 text-seal hover:text-ink"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <PhaseIcon phase={f.phase} />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Shared feed-ownership proof. The same token verifies every source this wallet registered, so the
 * creator places it once per feed then runs a single Verify-all pass over the freshly-listed rows.
 */
export function BulkVerifyPanel({
  token,
  instructions,
  registeredCount,
  verifiedCount,
  verifying,
  onVerifyAll,
}: {
  token: string;
  instructions: string;
  registeredCount: number;
  verifiedCount: number;
  verifying: boolean;
  onVerifyAll: () => void;
}) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      toast.success("Token copied — paste it into each feed.");
    } catch {
      toast.error("Couldn't copy — select the token manually.");
    }
  };
  return (
    <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/[0.07] p-4">
      <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-amber-700">
        <PenLine className="h-3.5 w-3.5" />
        One token verifies all {registeredCount} sources
      </div>
      <p className="text-xs text-ink-2">{instructions}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 break-all rounded border border-line bg-paper px-2.5 py-1.5 font-mono text-xs text-ink">
          {token}
        </code>
        <button
          type="button"
          onClick={copy}
          title="Copy token"
          className="shrink-0 rounded-md border border-line px-2 py-1.5 text-ink transition-colors hover:bg-paper"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      <button
        type="button"
        onClick={onVerifyAll}
        disabled={verifying}
        className="flex w-full items-center justify-center gap-2 border border-ink bg-paper px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)] active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
        {verifying
          ? "Checking feeds…"
          : verifiedCount > 0
          ? `Verified ${verifiedCount}/${registeredCount} — check again ▸`
          : "Verify all feeds ▸"}
      </button>
    </div>
  );
}
