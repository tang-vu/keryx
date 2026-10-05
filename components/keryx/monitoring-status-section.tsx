import type { MonitoringObservations } from "@/lib/ops/monitoring-observations";

export function MonitoringStatusSection({ monitoring }: { monitoring: MonitoringObservations }) {
  return (
    <section className="mt-8 border-t border-line pt-5" aria-label="Recorded monitoring checks">
      <h2 className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">Recorded monitoring checks</h2>
      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-5 font-mono text-[12px] sm:grid-cols-2">
        {monitoring.checks.map(check => (
          <div key={check.name} className="flex flex-col gap-1">
            <dt className="text-ink-3">{check.label}</dt>
            <dd className={check.state === "recent" ? "text-ink" : "text-seal"}>
              {check.state === "recent" ? "Recent observation" : check.state === "stale" ? "Stale observation" : "No current observation"}
              {check.checkedAt && <time className="mt-1 block text-[10px] text-ink-3" dateTime={check.checkedAt}>{new Date(check.checkedAt).toUTCString()}</time>}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm text-ink-3">
        {monitoring.state === "incomplete" && "Some checks have no recent recorded observation. "}
        Service availability and recorded checks are separate. A recent observation does not prove that a check passed,
        that it runs automatically, or that a payment settled. Review the results below where available.
      </p>
    </section>
  );
}
