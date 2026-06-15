"use client";

/**
 * Grid of registered sources. Name, description, tags, fetch price, wallet
 * (mono short), and author splits when there is more than one author.
 */

import { Wallet } from "lucide-react";
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
}

export function SourcesList({ sources }: { sources: SourceCardData[] }) {
  if (sources.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
        No sources registered yet — be the first.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {sources.map((s) => (
        <Card key={s.id} className="flex flex-col p-5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold tracking-tight text-foreground">
              {s.name}
            </h3>
            <span className="shrink-0 rounded-md bg-amber-500/10 px-2 py-0.5 font-mono text-xs font-semibold text-amber-700">
              ${fmtUsdc(s.fetchPrice)}
            </span>
          </div>

          <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
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
            <p className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <Wallet className="h-3 w-3" />
              {shortAddr(s.walletAddress)}
            </p>
            {s.authors.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.authors.map((a) => (
                  <span
                    key={a.name}
                    className="rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground"
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
