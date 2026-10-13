"use client";

import { useEffect, useState } from "react";
import type { PaidJobEscalation } from "../a2a/overdue-types";
import { jobTargetWarningDelay } from "./job-targets";

/** One browser display timeout, no polling, notification, persistence or execution. */
export function useJobTargetWarning(escalation: PaidJobEscalation | undefined): boolean {
  const [warningFor, setWarningFor] = useState<PaidJobEscalation | null>(null);
  useEffect(() => {
    if (jobTargetWarningDelay(escalation, 0) === null) return;
    const origin = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    const check = () => {
      if (!active) return;
      clearTimeout(timer);
      const delay = jobTargetWarningDelay(escalation, Math.max(0, Math.floor(performance.now() - origin)));
      if (delay === 0) setWarningFor(escalation!);
      else if (delay !== null) timer = setTimeout(check, delay);
    };
    check();
    document.addEventListener("visibilitychange", check);
    return () => { active = false; clearTimeout(timer); document.removeEventListener("visibilitychange", check); };
  }, [escalation]);
  return escalation !== undefined && warningFor === escalation;
}
