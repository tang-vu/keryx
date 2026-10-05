"use client";

import { useCallback, useEffect, useState } from "react";

export interface LedgerResource<T> {
  status: "loading" | "ready" | "error";
  data: T | null;
  observedAt: string | null;
}

/** Independent, non-overlapping reads; errors retain explicitly dated data. */
export function useLedgerResource<T>(url: string, parse: (body: unknown) => T) {
  const [resource, setResource] = useState<LedgerResource<T>>({ status: "loading", data: null, observedAt: null });
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const response = await fetch(url, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (!response.ok) throw new Error("Ledger resource unavailable");
        const data = parse(await response.json());
        if (alive) setResource({ status: "ready", data, observedAt: new Date().toISOString() });
      } catch {
        if (alive) setResource(previous => ({ ...previous, status: "error" }));
      } finally {
        if (alive) timer = setTimeout(() => void poll(), 10_000);
      }
    }
    void poll();
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [url, parse, revision]);
  return { ...resource, retry };
}
