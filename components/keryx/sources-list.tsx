"use client";

/**
 * Grid of registered sources. Name, description, tags, fetch price, wallet
 * (mono short), and author splits when there is more than one author.
 */

import { Wallet, ShieldCheck, ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtUsdc, shortAddr } from "./phase-style";

export interface SourceCardData {
  id: string;
  name: string;
  url?: string;
  description: string;
  tags: string[];
  fetchPrice: number;
  walletAddress: string;
  authors: { name: string; splitWeight: number }[];
  /** Set once the source is registered on the on-chain SourceRegistry. */
  onchainId?: string;
  /** EVM tx hash of the register() call — links to the block explorer as verifiable proof. */
  registerTx?: string;
  /** Feed-ownership proven. false = listed but off the agent's money path until verified. */
  verified?: boolean;
}

export function SourcesList({ sources }: { sources: SourceCardData[] }) {
  if (sources.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line py-10 text-center text-sm text-ink-3">
        No sources registered yet — be the first.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {sources.map((s) => (
        <Card key={s.id} className="flex flex-col p-5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-serif text-[17px] leading-tight text-ink">
              {s.name}
            </h3>
            <span className="shrink-0 rounded-md bg-seal/10 px-2 py-0.5 font-mono text-xs font-semibold text-seal">
              ${fmtUsdc(s.fetchPrice)}
            </span>
          </div>

          {s.verified === false && (
            <p
              title="Feed ownership not yet proven — listed but the agent won't read, cite, or pay it until verified."
              className="mt-2 inline-flex items-center gap-1 self-start rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-amber-700"
            >
              <ShieldAlert className="h-3 w-3" />
              Unverified
            </p>
          )}

          <p className="mt-1.5 line-clamp-2 text-sm text-ink-2">
            {s.description}
          </p>

          {s.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {s.tags.slice(0, 4).map((t) => (
                <Badge key={t} variant="secondary" className="font-normal">
                  {t}
                </Badge>
              ))}
            </div>
          )}

          <div className="mt-auto pt-4">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 font-mono text-[11px] text-ink-3">
                <Wallet className="h-3 w-3" />
                {shortAddr(s.walletAddress)}
              </p>
              {s.registerTx && (
                <a
                  href={`https://testnet.arcscan.app/tx/${s.registerTx}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Registered on-chain — view the register() transaction on ArcScan"
                  className="flex items-center gap-1 font-mono text-[10.5px] text-paid hover:underline"
                >
                  <ShieldCheck className="h-3 w-3" />
                  On-chain
                </a>
              )}
            </div>
            {s.authors.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.authors.map((a) => (
                  <span
                    key={a.name}
                    className="rounded border border-line bg-paper-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-2"
                  >
                    {a.name} · {Math.round(a.splitWeight * 100)}%
                  </span>
                ))}
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
