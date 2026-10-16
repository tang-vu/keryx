"use client";


import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useUiMessages } from "@/lib/i18n/ui-copy";





type Rating = "up" | "down";
type Phase = "loading" | "ready" | "unavailable" | "sending" | "confirmed" | "unconfirmed";
interface Counts { up: number; down: number }
const OBSERVATION_MS = 15_000;

function readCounts(value: unknown): Counts {
  if (!value || typeof value !== "object") throw new Error("Feedback counts unavailable");
  const { up, down } = value as Record<string, unknown>;
  if (typeof up !== "number" || typeof down !== "number" ||
      !Number.isSafeInteger(up) || !Number.isSafeInteger(down) || up < 0 || down < 0 ||
      !Number.isSafeInteger(up + down)) throw new Error("Feedback counts unavailable");
  return { up, down };
}

/** Bound headers and body observation. Aborting cannot undo a server-side insert. */
async function requestCounts(url: string, init: RequestInit, controller = new AbortController()): Promise<Counts> {
  let rejectObservation!: (reason: Error) => void;
  const stopped = new Promise<never>((_resolve, reject) => { rejectObservation = reject; });
  const stop = () => rejectObservation(new Error("Feedback observation ended"));
  controller.signal.addEventListener("abort", stop, { once: true });
  if (controller.signal.aborted) stop();
  const timer = setTimeout(() => controller.abort(), OBSERVATION_MS);
  try {
    return await Promise.race([stopped, (async () => {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) throw new Error("Feedback unavailable");
      return readCounts(await response.json());
    })()]);
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", stop);
  }
}

/** Anonymous engagement only. Each mounted report allows one append-only attempt. */
export function AnswerFeedback({ queryId }: { queryId: string }) {
  return <ReportFeedback key={queryId} queryId={queryId} />;
}

function ReportFeedback({ queryId }: { queryId: string }) {
  const copy = useUiMessages();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [recorded, setRecorded] = useState<Rating | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      try {
        const next = await requestCounts(`/api/feedback?queryId=${encodeURIComponent(queryId)}`, {}, controller);
        if (active) { setCounts(next); setPhase("ready"); }
      } catch {
        if (active) setPhase("unavailable");
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [queryId]);

  async function vote(rating: Rating) {
    if (attempted.current || phase === "loading") return;
    // A ref closes same-tick double clicks before React commits the pending UI.
    attempted.current = true;
    setPhase("sending");
    try {
      const next = await requestCounts("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queryId, rating }),
      });
      setCounts(next);
      setRecorded(rating);
      setPhase("confirmed");
    } catch {
      // The server can persist before its response fails. Retrying could append twice.
      setPhase("unconfirmed");
    }
  }

  const total = counts ? counts.up + counts.down : null;
  const disabled = phase !== "ready" && phase !== "unavailable";
  const message = phase === "loading" ? copy("reportFeedback.loading")
    : phase === "unavailable" ? copy("reportFeedback.unavailable")
    : phase === "sending" ? copy("reportFeedback.sending")
    : phase === "confirmed" ? copy("reportFeedback.confirmed")
    : phase === "unconfirmed" ? copy("reportFeedback.unconfirmed")
    : null;

  return <div className="flex flex-wrap items-center gap-3 border-t border-line px-6 py-3 sm:px-9" role="group" aria-label={copy("reportFeedback.label")}>
    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{copy("reportFeedback.helpful")}</span>
    {(["up", "down"] as const).map(rating => <button
      key={rating}
      type="button"
      aria-label={counts ? copy(rating === "up" ? counts[rating] === 1 ? "reportFeedback.up.one" : "reportFeedback.up.other" : counts[rating] === 1 ? "reportFeedback.down.one" : "reportFeedback.down.other", { count: counts[rating] }) : copy(rating === "up" ? "reportFeedback.up" : "reportFeedback.down")}
      aria-pressed={recorded === rating}
      disabled={disabled}
      onClick={() => void vote(rating)}
      className={cn("flex min-h-11 min-w-11 items-center justify-center gap-1 border px-2 font-mono text-xs transition-colors focus-visible:outline-2 focus-visible:outline-seal",
        recorded === rating ? rating === "up" ? "border-paid bg-paid/10 text-paid" : "border-destructive bg-destructive/10 text-destructive"
          : "border-line text-ink-3 enabled:hover:border-ink enabled:hover:text-ink")}
    ><span aria-hidden="true">{rating === "up" ? "👍" : "👎"}</span>{counts && <span>{counts[rating]}</span>}</button>)}
    {total !== null && total > 0 && counts && <span className="font-mono text-[10px] text-ink-3">
      {copy(total === 1 ? "reportFeedback.summary.one" : "reportFeedback.summary.other", { count: total, positive: Math.round(counts.up / total * 100) })}
    </span>}
    {message && <p className="w-full text-sm text-ink-2" role={phase === "unconfirmed" ? "alert" : "status"}>{message}</p>}
  </div>;
}
