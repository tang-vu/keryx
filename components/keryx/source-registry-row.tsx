/**
 * One row of the public source registry (/sources). Server-rendered so the
 * catalogue is crawlable: the name links to the source's public earnings page,
 * the on-chain stamp links to the register() transaction on the explorer, and
 * the earnings figure is the lifetime total of real settled payments.
 */

import Link from "next/link";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { fmtUsdc } from "./phase-style";
import type { Source } from "@/lib/types";

const EXPLORER = "https://testnet.arcscan.app";

/** Preview-depth footnote — only levels that differ from the default earn a mention. */
const PREVIEW_NOTE: Record<string, string> = {
  excerpt: "excerpt preview",
  locked: "titles-only preview",
};

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export interface RegistryRowProps {
  source: Source;
  totalEarnedUsdc: number;
  citationCount: number;
}

export function SourceRegistryRow({ source: s, totalEarnedUsdc, citationCount }: RegistryRowProps) {
  const previewNote = s.previewDepth ? PREVIEW_NOTE[s.previewDepth] : undefined;

  return (
    <article className="border border-ink bg-paper p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)] sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={`/creator/${s.id}`}
            className="font-display text-[19px] font-medium leading-snug text-ink transition-colors hover:text-seal"
          >
            {s.name}
          </Link>
          {s.url && (
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2.5 font-mono text-[11px] text-ink-3 underline decoration-dotted underline-offset-4 transition-colors hover:text-seal"
            >
              {domainOf(s.url)} ↗
            </a>
          )}
        </div>
        <span className="shrink-0 rounded-md bg-seal/10 px-2 py-0.5 font-mono text-xs font-semibold text-seal">
          ${fmtUsdc(s.fetchPrice)} / read
        </span>
      </div>

      {s.description && (
        <p className="mt-2 line-clamp-2 font-serif text-[15px] leading-[1.5] text-ink-2">
          {s.description}
        </p>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
        {s.onchainId &&
          (s.registerTx ? (
            <a
              href={`${EXPLORER}/tx/${s.registerTx}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Registered in the on-chain SourceRegistry — opens the register() transaction"
              className="inline-flex items-center gap-1 text-paid transition-colors hover:underline"
            >
              <ShieldCheck className="h-3 w-3" />
              On-chain ↗
            </a>
          ) : (
            <span
              title="Registered in the on-chain SourceRegistry"
              className="inline-flex items-center gap-1 text-paid"
            >
              <ShieldCheck className="h-3 w-3" />
              On-chain
            </span>
          ))}
        {s.verified === false && (
          <span
            title="Feed ownership not yet proven — listed, but the agent won't read, cite, or pay this source until its owner verifies."
            className="inline-flex items-center gap-1 text-amber-700"
          >
            <ShieldAlert className="h-3 w-3" />
            Unverified
          </span>
        )}
        {totalEarnedUsdc > 0 && (
          <span className="text-paid">
            ${fmtUsdc(totalEarnedUsdc)} earned · {citationCount} cite{citationCount !== 1 ? "s" : ""}
          </span>
        )}
        {previewNote && <span>{previewNote}</span>}
        {s.tags.slice(0, 3).map((t) => (
          <span key={t} className="rounded border border-line bg-paper-2 px-1.5 py-0.5 normal-case tracking-normal">
            {t}
          </span>
        ))}
      </div>
    </article>
  );
}
