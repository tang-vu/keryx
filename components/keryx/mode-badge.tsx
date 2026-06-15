"use client";

/**
 * Real/offline mode badge. "live on Arc testnet" (emerald, pulsing dot) vs
 * "offline preview — payments simulated" (muted).
 */

import type { StreamMode } from "@/lib/hooks/use-ask-stream";
import { cn } from "@/lib/utils";

export function ModeBadge({
  mode,
  className,
}: {
  mode: StreamMode | null;
  className?: string;
}) {
  if (!mode) return null;
  const real = mode === "real";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        real
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
          : "border-border bg-muted text-muted-foreground",
        className,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          real ? "animate-pulse bg-emerald-500" : "bg-muted-foreground/50",
        )}
      />
      {real ? "live on Arc testnet" : "offline preview · simulated"}
    </span>
  );
}
