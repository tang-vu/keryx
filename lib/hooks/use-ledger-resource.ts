"use client";

import { useCallback, useEffect, useState } from "react";

export interface LedgerResource<T> {
  status: "loading" | "ready" | "error";
  data: T | null;
  observedAt: string | null;
}

/** Independent, non-overlapping reads; errors retain explicitly dated data. */
export function useLedgerResource<T>(url: string, parse: (body: unknown) => T, enabled = true, refreshIntervalMs = 60_000) {
  const [resource, setResource] = useState<LedgerResource<T>>({ status: "loading", data: null, observedAt: null });
  const [revision, setRevision] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const retry = useCallback(() => {
    setRetrying(true);
    setRevision(value => value + 1);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const visible = () => document.visibilityState !== "hidden";
    async function poll() {
      if (!alive || pending || !visible()) return;
      pending = true;
      try {
        const response = await fetch(url, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (!response.ok) throw new Error("Ledger resource unavailable");
        const data = parse(await response.json());
        if (alive) setResource({ status: "ready", data, observedAt: new Date().toISOString() });
      } catch {
        if (alive) setResource(previous => ({ ...previous, status: "error" }));
      } finally {
        pending = false;
        if (alive) {
          setRetrying(false);
          // Activity is historical data, not a live trading feed. Leave room for
          // new page reads and stop background tabs from repeatedly scanning it.
          if (visible()) timer = setTimeout(() => void poll(), refreshIntervalMs);
        }
      }
    }
    const visibility = () => {
      clearTimeout(timer);
      if (visible()) void poll();
    };
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => { alive = false; clearTimeout(timer); controller.abort(); document.removeEventListener("visibilitychange", visibility); };
  }, [url, parse, revision, enabled, refreshIntervalMs]);
  return { ...resource, retrying, retry };
}
