import type { MonitoringObservations } from "@/lib/ops/monitoring-observations";
import { createMessages } from "@/lib/i18n/messages";

import { DisplayTime } from "./display-time";
import { UiElement, UiMessage, UiRichMessage, UiText } from "@/lib/i18n/ui-copy";



const message = createMessages("en");


export function MonitoringStatusSection({ monitoring }: { monitoring: MonitoringObservations }) {
  return (
    <UiElement as="section" names={["aria-label"]} attributes={{ "className": "mt-8 border-t border-line pt-5", "aria-label": message("statusMonitoring.recordedMonitoringChecks") }}>
      <h2 className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3"><UiMessage messageKey={"statusMonitoring.recordedMonitoringChecks"} /></h2>
      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-5 font-mono text-[12px] sm:grid-cols-2">
        {monitoring.checks.map(check => (
          <div key={check.name} className="flex flex-col gap-1">
            <dt className="text-ink-3">{check.label}</dt>
            <dd className={check.state === "recent" ? "text-ink" : "text-seal"}>
              {check.state === "recent" ? <UiMessage messageKey={"statusMonitoring.recentObservation"} /> : check.state === "stale" ? <UiMessage messageKey={"statusMonitoring.staleObservation"} /> : <UiMessage messageKey={"statusMonitoring.noCurrentObservation"} />}
              {check.checkedAt && <span className="mt-1 block text-[10px] text-ink-3"><DisplayTime value={check.checkedAt} /></span>}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm text-ink-3"><UiRichMessage messageKey={"statusMonitoring.observationServiceAvailabilityAndRecordedChecksAreSeparate"} values={{ observation: monitoring.state === "incomplete" && message("statusMonitoring.missingObservations") }} /></p>
    </UiElement>
  );
}
