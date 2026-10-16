"use client";

import { useEffect, useRef, useState } from "react";

import { STATUS_PATH, type MaintenanceStatus } from "@/lib/maintenance/public-status";
import { observeMaintenanceStatus, type StatusReadBudget } from "@/lib/maintenance/status-observer";
import { useUiMessages } from "@/lib/i18n/ui-copy";





/** Independent public control notice; it cannot disable, submit or recover a caller's request. */
export function MaintenanceBanner() {
  const message = useUiMessages();
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [observation, setObservation] = useState<"current" | "unavailable" | "finished">("current");
  const budget = useRef<StatusReadBudget>({ startedAt: null, reads: 0, stopped: false });
  useEffect(() => observeMaintenanceStatus(budget.current, value => {
    setObservation(value.kind);
    if (value.kind === "current") setStatus(value.status);
  }), []);

  // An absent/inert front door is not a service-health signal. Never advertise a failed initial read.
  if (!status || status.state === "normal") return null;
  const title = observation === "unavailable" ? message("maintenance.statusUnavailable") :
    message(status.state === "upcoming" ? "maintenance.upcoming" : status.state === "overrun" ? "maintenance.overrun" :
      status.state === "control-unavailable" ? "maintenance.controlUnavailable" : "maintenance.held");
  return (
    <aside role="status" aria-live="polite" aria-atomic="true" className="border-b border-line bg-paper px-4 py-3 text-ink">
      <div className="mx-auto max-w-[1180px] text-sm">
        <p className="font-semibold">{title}</p>
        <p>{message("maintenance.lastObserved", { checkedAt: status.checkedAt })}</p>
        {status.window && <>
          <p className="break-words">{status.window.message}</p>
          <p>{message("maintenance.starts", { startsAt: status.window.startsAt })}</p>
          <p>{message("maintenance.expectedEnd", { endsAt: status.window.endsAt })}</p>
        </>}
        <p>{message("maintenance.healthUnknown")}</p>
        {observation === "finished" && <p>{message("maintenance.refreshEnded")}</p>}
        <p>{message("maintenance.noRetry")}</p>
        <a href={STATUS_PATH} className="inline-flex min-h-11 items-center underline underline-offset-4">
          {message("researchError.serviceStatus")}
        </a>
      </div>
    </aside>
  );
}
