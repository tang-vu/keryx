"use client";

/**
 * claim-onchain-panel — surfaces the signed-in creator's sources that predate the on-chain
 * registry (no onchainId yet) and offers to move each one on-chain.
 *
 * The backend already lands a register() event on the existing row (pre-registry adoption), but
 * the only way to reach that path was to re-paste your own feed URL into the register form and
 * know that this is safe. This panel makes the pending step visible: one click pre-fills the form
 * with the source's own feed/URL and price, and the creator just signs.
 *
 * Renders nothing when the wallet owns no unclaimed rows, so almost nobody ever sees it.
 */

import { createMessages } from "@/lib/i18n/messages";
import { Link2 } from "lucide-react";
import type { SourceCardData } from "./sources-list";
import { fmtUsdc } from "./phase-style";

const uiCopy = createMessages("en");

export function ClaimOnchainPanel({
  sources,
  address,
  onClaim,
}: {
  sources: SourceCardData[];
  address?: string;
  /** Pre-fill the register form with this source's feed/URL so the creator can sign. */
  onClaim: (source: SourceCardData) => void;
}) {
  if (!address) return null;

  const unclaimed = sources.filter(
    (s) =>
      s.walletAddress.toLowerCase() === address.toLowerCase() &&
      !s.onchainId &&
      // A row with neither feed nor URL has nothing to bind the on-chain id to.
      (s.rssUrl || s.url),
  );
  if (unclaimed.length === 0) return null;

  return (
    <div className="mb-4 space-y-3 rounded-md border border-seal/40 bg-seal/[0.06] p-4">
      <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-seal">
        <Link2 className="h-3.5 w-3.5" />
        {uiCopy("registrationAdoption.title")}
      </div>
      <p className="text-xs text-ink-2">
        {uiCopy(unclaimed.length === 1 ? "registrationAdoption.explanation.one" : "registrationAdoption.explanation.other")}
      </p>
      <ul className="space-y-2">
        {unclaimed.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between gap-3 rounded border border-line bg-paper px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate font-serif text-[15px] leading-tight text-ink">{s.name}</p>
              <p className="truncate font-mono text-[10.5px] text-ink-3">
                {uiCopy("registrationAdoption.readPrice", { url: s.rssUrl || s.url || "", price: fmtUsdc(s.fetchPrice) })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onClaim(s)}
              className="shrink-0 border border-ink bg-paper-2 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink transition-all hover:-translate-y-0.5 hover:shadow-[0_3px_0_var(--ink)] active:translate-y-0 active:shadow-none"
            >
              {uiCopy("registrationAdoption.move")}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
