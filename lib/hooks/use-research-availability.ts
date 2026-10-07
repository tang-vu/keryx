"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseResearchAvailability, type ResearchAvailability } from "../research/availability-contract";

export function useResearchAvailability() {
  const [availability, setAvailability] = useState<ResearchAvailability | null>(null);
  const [checking, setChecking] = useState(true);
  const controllerRef = useRef<AbortController | null>(null);
  const read = useCallback(async (signal: AbortSignal) => {
    if (signal.aborted) return null;
    let value: ResearchAvailability | null = null;
    try {
      const response = await fetch("/api/research/availability", { cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
      if (!response.ok) throw new Error("Availability unavailable");
      value = parseResearchAvailability(await response.json());
      if (!value) throw new Error("Availability unavailable");
      if (!signal.aborted) setAvailability(value);
    } catch { if (!signal.aborted) setAvailability(null); }
    finally { if (!signal.aborted) setChecking(false); }
    return signal.aborted ? null : value;
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    void Promise.resolve().then(() => read(controller.signal));
    return () => controllerRef.current?.abort();
  }, [read]);
  const refresh = () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setChecking(true);
    return read(controller.signal);
  };
  return { availability, checking, refresh };
}
