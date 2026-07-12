"use client";

/**
 * SessionActiveCard — the active-session strip above the ask form.
 *
 * Extracted from GrantSpendDialog so the dialog stays a thin state router.
 * Shows the remaining cap + spend bar, a live expiry countdown, top-up with
 * quick presets, and revoke. When the grant TTL is nearly up it surfaces a
 * one-click "Extend session": the signer worker still holds the key, so the
 * extension is a single API call — no signature, no gas, no new funds.
 */

import { useEffect, useState } from "react";
import type { GrantState } from "@/lib/hooks/use-session-grant";
import { UsdcPresetChips } from "@/components/keryx/usdc-preset-chips";

/** Warn (and offer one-click extend) when this little of the grant TTL remains. */
const EXPIRY_WARN_MS = 10 * 60 * 1000;

interface Props {
  grantState: GrantState;
  onTopUp: (addUsdc: number) => void;
  onRevoke: () => void;
  /** Re-register the grant for a fresh TTL, no wallet interaction. False = nothing to extend. */
  onExtend: () => Promise<boolean>;
}

/** Milliseconds until expiry, re-evaluated every 30s so the label and warning stay honest. */
function useRemainingMs(expiresAt: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return expiresAt ? new Date(expiresAt).getTime() - now : null;
}

function formatRemaining(ms: number): string {
  if (ms <= 60_000) return "under a minute";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function SessionActiveCard({ grantState, onTopUp, onRevoke, onExtend }: Props) {
  const [showRevoke, setShowRevoke] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const [topUpInput, setTopUpInput] = useState("0.05");
  const [extending, setExtending] = useState(false);
  const [extendFailed, setExtendFailed] = useState(false);

  const topUpNum = parseFloat(topUpInput);
  const topUpValid = Number.isFinite(topUpNum) && topUpNum > 0;

  const remainingMs = useRemainingMs(grantState.expiresAt);
  const expiringSoon = remainingMs !== null && remainingMs <= EXPIRY_WARN_MS;

  const spentPct = grantState.cap > 0 ? Math.min(100, (grantState.spent / grantState.cap) * 100) : 0;
  const remaining = Math.max(0, grantState.cap - grantState.spent);

  const handleExtend = async () => {
    setExtending(true);
    setExtendFailed(false);
    const ok = await onExtend(); // success refreshes expiresAt via grantState — no local bookkeeping
    if (!ok) setExtendFailed(true);
    setExtending(false);
  };

  return (
    <div className="mb-4 border border-seal/40 bg-paper px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {/* green dot = active session */}
          <span className="h-2 w-2 rounded-full bg-paid" />
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">
            Session active — ${remaining.toFixed(4)} remaining
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => { setShowTopUp((v) => !v); setShowRevoke(false); }}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-paid underline underline-offset-2 hover:opacity-80"
          >
            Add funds
          </button>
          <button
            type="button"
            onClick={() => { setShowRevoke(true); setShowTopUp(false); }}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 underline underline-offset-2 hover:text-seal"
          >
            Revoke
          </button>
        </div>
      </div>

      {/* spend progress bar */}
      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-seal transition-all"
          style={{ width: `${spentPct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] tracking-widest text-faint">
        <span>${grantState.spent.toFixed(4)} spent</span>
        <span>${grantState.cap.toFixed(4)} cap</span>
      </div>

      {remainingMs !== null && !expiringSoon && (
        <div className="mt-1.5 font-mono text-[9px] text-faint">
          Expires in {formatRemaining(remainingMs)}
        </div>
      )}

      {expiringSoon && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 border border-seal/40 bg-paper-2 px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-seal">
            {remainingMs !== null && remainingMs <= 0
              ? "Session expiring…"
              : `Expires in ${formatRemaining(remainingMs ?? 0)}`}
          </span>
          <button
            type="button"
            onClick={handleExtend}
            disabled={extending}
            className="border border-ink bg-ink px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-cream transition-all hover:-translate-y-0.5 hover:shadow-[0_3px_0_var(--seal)] active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {extending ? "Extending…" : "Extend session ▸"}
          </button>
          <span className="w-full font-mono text-[9px] leading-relaxed text-faint">
            {extendFailed
              ? "Could not extend — if it keeps failing, use “Recover funded session” after expiry."
              : "One click — no signature, no gas. Your unspent USDC carries over."}
          </span>
        </div>
      )}

      {showTopUp && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
            Add
          </span>
          <UsdcPresetChips value={topUpInput} onPick={setTopUpInput} />
          <input
            type="number"
            inputMode="decimal"
            min={0.01}
            step={0.01}
            value={topUpInput}
            onChange={(e) => setTopUpInput(e.target.value)}
            className="w-20 border border-ink/30 bg-paper px-2 py-1 font-mono text-[12px] text-ink focus:border-seal focus:outline-none"
          />
          <span className="font-mono text-[10px] text-ink-3">USDC</span>
          <button
            type="button"
            onClick={() => { if (topUpValid) { setShowTopUp(false); onTopUp(topUpNum); } }}
            disabled={!topUpValid}
            className="border border-ink bg-ink px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-cream transition-all hover:-translate-y-0.5 hover:shadow-[0_3px_0_var(--seal)] active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add funds ▸
          </button>
          <span className="w-full font-mono text-[9px] leading-relaxed text-faint">
            One MetaMask tx · deposits into the same session · cap rises after confirm
          </span>
        </div>
      )}

      {showRevoke && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-2.5 font-serif text-[13px] leading-snug text-ink-2">
            Revoking stops the agent from spending. Any unspent USDC stays safe
            in the Gateway under your session address{" "}
            {grantState.sessAddr ? (
              <span className="font-mono text-[11px]">{grantState.sessAddr.slice(0, 10)}…</span>
            ) : null}
            {" "}— derived from your wallet, so you can resume it anytime with
            “Recover funded session”. (It is not auto-returned to your wallet.)
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setShowRevoke(false); onRevoke(); }}
              className="border border-destructive/60 bg-destructive/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-destructive hover:bg-destructive/20"
            >
              Revoke grant
            </button>
            <button
              type="button"
              onClick={() => setShowRevoke(false)}
              className="px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-3 hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
