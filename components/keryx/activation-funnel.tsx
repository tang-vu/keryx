"use client";

import type { ActivationEvent, ActivationFunnel } from "@/lib/types";

const READER: Array<{ event: ActivationEvent; label: string }> = [
  { event: "reader_landing", label: "Landing" },
  { event: "reader_ask_started", label: "Ask accepted" },
  { event: "reader_answer_completed", label: "Answer complete" },
  { event: "reader_wallet_connected", label: "Wallet sign-in" },
  { event: "reader_session_funded", label: "Session funded" },
  { event: "reader_returning_dispatch", label: "Returning ask" },
];

const CREATOR: Array<{ event: ActivationEvent; label: string }> = [
  { event: "creator_registration_started", label: "Register started" },
  { event: "creator_verification_completed", label: "Feed verified" },
  { event: "creator_citation_settled", label: "Citation settled" },
  { event: "creator_withdrawal_completed", label: "Cash-out complete" },
];

export function ActivationFunnelPanel({ funnel }: { funnel: ActivationFunnel }) {
  const total = Object.values(funnel.counts).reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  return (
    <section className="mt-6 border border-line bg-paper-2/50 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-seal">
            Activation · last {funnel.windowDays} days
          </div>
          <h2 className="mt-1 font-display text-[22px] font-medium text-ink">
            Where readers and creators continue
          </h2>
        </div>
        <p className="max-w-[48ch] font-mono text-[10px] leading-relaxed text-ink-3">
          Coarse event totals, not unique people. No analytics cookie, fingerprint, wallet, IP,
          question, or source id is stored in these counters.
        </p>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <FunnelRow title="Reader path" stages={READER} counts={funnel.counts} />
        <FunnelRow title="Creator path" stages={CREATOR} counts={funnel.counts} />
      </div>
    </section>
  );
}

function FunnelRow({
  title,
  stages,
  counts,
}: {
  title: string;
  stages: Array<{ event: ActivationEvent; label: string }>;
  counts: ActivationFunnel["counts"];
}) {
  const max = Math.max(1, ...stages.map((stage) => counts[stage.event]));
  return (
    <div>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
        {title}
      </div>
      <div className="space-y-2">
        {stages.map((stage) => {
          const count = counts[stage.event];
          return (
            <div key={stage.event} className="grid grid-cols-[116px_1fr_48px] items-center gap-2">
              <span className="font-mono text-[10.5px] text-ink-2">{stage.label}</span>
              <span className="h-2 overflow-hidden bg-line/60">
                <span
                  className="block h-full bg-seal"
                  style={{ width: `${Math.max(count > 0 ? 4 : 0, (count / max) * 100)}%` }}
                />
              </span>
              <span className="text-right font-mono text-[11px] tabular-nums text-ink">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
