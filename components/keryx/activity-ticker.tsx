"use client";

/**
 * Live citation ticker — a thin marquee of the most recent REAL settled citations
 * (source → reward → how long ago), pulled from /api/activity and refreshed every 20s.
 * Proof-of-life on the landing page: agents are paying creators right now. Renders
 * nothing until there's real activity, and silently no-ops on any fetch error, so it
 * can never break the page it sits on.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtUsdc } from "./phase-style";

interface ActivityItem {
  sourceId: string;
  sourceName: string;
  question: string | null;
  rewardUsdc: number;
  origin: string;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  if (isNaN(d)) return "";
  const s = Math.max(0, Math.round((Date.now() - d) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function ActivityTicker() {
  const [items, setItems] = useState<ActivityItem[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/activity", { cache: "no-store" });
        const data = await res.json();
        if (alive && Array.isArray(data.activity)) setItems(data.activity);
      } catch {
        /* keep the last good list; the ticker must never throw on the landing page */
      }
    };
    load();
    const t = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (items.length === 0) return null;

  // Duplicate the row so the marquee loops seamlessly (translateX -50% lands on the copy).
  const row = [...items, ...items];

  return (
    <div className="group relative overflow-hidden border-y border-line bg-paper/60 py-2">
      <div
        className="flex w-max gap-8 whitespace-nowrap pl-8 group-hover:[animation-play-state:paused]"
        style={{
          animation: "kxTape 60s linear infinite",
          maskImage: "linear-gradient(90deg, transparent, #000 4%, #000 96%, transparent)",
          WebkitMaskImage: "linear-gradient(90deg, transparent, #000 4%, #000 96%, transparent)",
        }}
      >
        {row.map((it, i) => (
          <Link
            key={`${it.createdAt}-${i}`}
            href={`/creator/${it.sourceId}`}
            className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-ink-3 transition-colors hover:text-ink"
            title={it.question ? `cited for: ${it.question}` : undefined}
          >
            <span className="text-seal">◆</span>
            <span className="font-semibold text-ink-2">{it.sourceName}</span>
            <span>cited</span>
            <span className="text-seal">{fmtUsdc(it.rewardUsdc, { sign: true })}</span>
            <span className="text-ink-3/70">· {timeAgo(it.createdAt)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
