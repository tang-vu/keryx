"use client";

import { useEffect, useState } from "react";

import { formatDate, formatCalendarDate, formatRelativeTime, resolveViewerTimeZone, type DisplayLocale } from "@/lib/i18n/format";
import { useUiMessages } from "@/lib/i18n/ui-copy";





/** UTC first render matches SSR. Resolve the viewer zone only after hydration. */
function useViewerTimeZone(): string {
  const [zone, setZone] = useState("UTC");
  useEffect(() => { setZone(resolveViewerTimeZone()); }, []);
  return zone;
}

export function DisplayTime({ value, locale = "en", dateOnly = false, now, timeZone, relative = false, timeStyle = "short" }: {
  value: string | number; locale?: DisplayLocale; dateOnly?: boolean; now?: string | number; timeZone?: string; relative?: boolean; timeStyle?: "short" | "medium";
}) {
  const copy = useUiMessages();
  const viewerZone = useViewerTimeZone();
  const [observedNow, setObservedNow] = useState<number | undefined>(undefined);
  useEffect(() => { if (relative) setObservedNow(Date.now()); }, [relative, value]);
  const calendar = dateOnly && typeof value === "string" ? formatCalendarDate(value, locale) : null;
  const date = formatDate(value, locale, timeZone ?? viewerZone, { timeStyle: dateOnly ? undefined : timeStyle });
  if (calendar) return <time dateTime={calendar.date} title={calendar.date}>{calendar.text}</time>;
  if (!date) return <span>{copy("displayTime.unavailable")}</span>;
  const clock = now ?? observedNow;
  return <time dateTime={date.utc} title={date.utc}>{clock === undefined ? date.text : formatRelativeTime(value, clock, locale)}</time>;
}
