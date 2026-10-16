"use client";
import { DisplayTime } from "@/components/keryx/display-time";


/**
 * Live citation ticker — a thin marquee of the most recent REAL settled citations
 * (source → reward → how long ago), pulled from /api/activity and refreshed every 20s.
 * Confirmed empty activity is hidden. Loading and unavailable activity stay distinct.
 */


import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtUsdc } from "./phase-style";
import { useUiMessages } from "@/lib/i18n/ui-copy";





interface ActivityItem {
  sourceId: string;
  sourceName: string;
  question: string | null;
  rewardUsdc: number;
  origin: string;
  createdAt: string;
}

function timeAgo(iso: string) {
  return <DisplayTime value={iso} relative />;
}

export function ActivityTicker() {
  const uiCopy = useUiMessages();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/activity", { cache: "no-store" });
        if (!res.ok) throw new Error("Activity unavailable");
        const data = await res.json();
        if (data.error) throw new Error("Activity unavailable");
        if (!Array.isArray(data.activity)) throw new Error("Invalid activity feed");
        if (alive) { setItems(data.activity); setState(data.activity.length ? "ready" : "empty"); }
      } catch {
        if (alive) { setItems([]); setState("error"); }
      }
    };
    load();
    const t = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (state === "empty") return null;
  if (state !== "ready") return <div className="border-y border-line bg-paper/60 px-4 py-3 font-mono text-xs text-ink-3" role="status">{state === "loading" ? uiCopy("landingActivity.loading") : uiCopy("landingActivity.unavailable")}</div>;

  // Duplicate the row so the marquee loops seamlessly (translateX -50% lands on the copy).
  const row = [...items, ...items];

  return (
    <div className="group relative flex items-center overflow-hidden border-y border-line bg-paper/60 py-2">
      <div
        className="flex w-max gap-8 whitespace-nowrap pl-8 group-hover:[animation-play-state:paused] motion-reduce:!animate-none max-sm:!animate-none"
        style={{
          animation: paused ? "none" : "kxTape 60s linear infinite",
          maskImage: "linear-gradient(90deg, transparent, #000 4%, #000 96%, transparent)",
          WebkitMaskImage: "linear-gradient(90deg, transparent, #000 4%, #000 96%, transparent)",
        }}
      >
        {row.map((it, i) => (
          <Link
            key={`${it.createdAt}-${i}`}
            href={`/creator/${it.sourceId}`}
            className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-ink-3 transition-colors hover:text-ink"
            title={it.question ? uiCopy("landingActivity.questionTitle", { question: it.question }) : undefined}
          >
            <span className="text-seal">◆</span>
            <span className="font-semibold text-ink-2">{it.sourceName}</span>
            <span>{uiCopy("landingActivity.cited")}</span>
            <span className="text-seal">{fmtUsdc(it.rewardUsdc, { sign: true })}</span>
            <span className="text-ink-3/70">· {timeAgo(it.createdAt)}</span>
          </Link>
        ))}
      </div>
      <button type="button" onClick={() => setPaused(!paused)} className="ml-auto min-h-11 shrink-0 bg-paper px-3 font-mono text-[10px] uppercase text-ink underline">{paused ? uiCopy("landingActivity.play") : uiCopy("landingActivity.pause")}</button>
    </div>
  );
}
