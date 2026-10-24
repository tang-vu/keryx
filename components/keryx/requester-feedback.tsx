"use client";
import { useState, useSyncExternalStore } from "react";
import { useUiMessages } from "@/lib/i18n/ui-copy";
import { useLocale } from "@/lib/i18n/locale-context";
import { formatLocalizedDecimal, formatLocalizedNumber } from "@/lib/i18n/format";
import { observeRequesterDelivery, requesterObservation } from "@/lib/research-feedback/browser-delivery";
import { requestRequesterFeedback } from "@/lib/research-feedback/client";
import type { FeedbackInput, RequesterFeedback as Feedback } from "@/lib/research-feedback/contracts";

export function RequesterFeedback({ runId }: { runId: string }) {
  const packet = useSyncExternalStore(observeRequesterDelivery, () => requesterObservation(runId), () => null);
  const copy = useUiMessages();
  const { locale } = useLocale();
  const [choice, setChoice] = useState<FeedbackInput["choice"] | null>(null), [reason, setReason] = useState("");
  const [phase, setPhase] = useState<"ready" | "sending" | "confirmed" | "unconfirmed">("ready");
  const [saved, setSaved] = useState<Feedback | null>(null);
  if (!packet) return null;
  const observed = packet.observations, price = observed.modelCostUsd;
  const bounds = price ? `$${formatLocalizedDecimal(price.lower, locale, 6)}–$${formatLocalizedDecimal(price.upper, locale, 6)}` : copy("requesterFeedback.unknown");
  const duration = observed.generationDurationMs === null ? copy("requesterFeedback.unknown") : `${formatLocalizedDecimal(observed.generationDurationMs / 1000, locale, 1)} s`;
  async function submit(read = false) {
    if (!packet?.feedback || phase === "sending") return;
    const input = read ? undefined : choice ? { choice, reason } : undefined;
    if (!read && !input) return;
    setPhase("sending");
    try {
      const response = await requestRequesterFeedback(window.location.origin, packet.feedback.token, input);
      if (response.runId !== runId) throw new Error();
      setSaved(response.feedback); setPhase(response.feedback ? "confirmed" : "ready");
    } catch { setPhase("unconfirmed"); }
  }
  return <section className="space-y-3 border-t border-line px-6 py-4 sm:px-9" aria-label={copy("requesterFeedback.label")} data-testid="requester-feedback">
    <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-ink-2">
      <span>{copy("requesterFeedback.duration", { value: duration })}</span>
      <span>{copy("requesterFeedback.cost", { value: bounds })}</span>
    </div>
    <details className="text-xs text-ink-3"><summary>{copy("requesterFeedback.basis")}</summary>
      <p className="mt-1">{copy("requesterFeedback.partial")}</p>
      <p>{copy("requesterFeedback.calls", { failed: formatLocalizedNumber(observed.failedCalls, locale), missing: formatLocalizedNumber(observed.missingUsageCalls, locale), unpriced: formatLocalizedNumber(observed.unpricedUsageRecords, locale) })}</p>
    </details>
    {packet.feedback ? <div className="space-y-2">
      <p className="font-serif text-sm text-ink">{copy("requesterFeedback.question")}</p>
      {phase !== "confirmed" ? <>
        <div className="flex flex-wrap gap-2" role="group" aria-label={copy("requesterFeedback.question")}>
          {(["useful", "revise", "reject"] as const).map(value => <button key={value} type="button" aria-pressed={choice === value}
            disabled={phase === "sending"} onClick={() => setChoice(value)}
            className={`border px-3 py-1 text-xs ${choice === value ? "border-seal bg-paper-2 text-ink" : "border-line text-ink-2"}`}>
            {copy(`requesterFeedback.${value}`)}</button>)}
        </div>
        <label className="block text-xs text-ink-2">{copy("requesterFeedback.reason")}
          <textarea value={reason} maxLength={1000} rows={2} disabled={phase === "sending"} onChange={event => setReason(event.target.value)}
            className="mt-1 block w-full border border-line bg-paper px-2 py-1 text-sm" /></label>
        <button type="button" disabled={phase === "sending" || phase !== "unconfirmed" && choice === null} onClick={() => void submit(phase === "unconfirmed")}
          className="border border-line px-3 py-1 text-xs text-ink">
          {copy(phase === "sending" ? "requesterFeedback.sending" : phase === "unconfirmed" ? "requesterFeedback.check" : "requesterFeedback.submit")}</button>
      </> : <p className="text-sm text-ink-2" role="status">{copy("requesterFeedback.confirmed", { choice: saved ? copy(`requesterFeedback.${saved.choice}`) : "" })}</p>}
      {phase === "unconfirmed" && <p role="status" className="text-xs text-ink-2">{copy("requesterFeedback.unconfirmed")}</p>}
      <p className="text-xs text-ink-3">{copy("requesterFeedback.private")}</p>
    </div> : <p className="text-xs text-ink-3">{copy("requesterFeedback.unavailable")}</p>}
  </section>;
}
