"use client";

import { useEffect } from "react";

/** Existing coarse tab/day counter, isolated from the server-rendered product guide. */
export function LandingVisit() {
  // One coarse landing event per tab/day. No stable id is created and credentials are omitted, so
  // the server receives only the allowlisted event name and increments a UTC-day counter.
  useEffect(() => {
    const day = new Date().toISOString().slice(0, 10);
    const key = `keryx:activation:landing:${day}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "pending");
      void fetch("/api/activation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "reader_landing" }),
        credentials: "omit",
        keepalive: true,
      }).then((response) => {
        if (response.ok) window.sessionStorage.setItem(key, "1");
        else window.sessionStorage.removeItem(key);
      }).catch(() => window.sessionStorage.removeItem(key));
    } catch {
      // Storage disabled or telemetry unavailable: the product remains fully functional.
    }
  }, []);

  return null;
}
