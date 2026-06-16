"use client";

/**
 * Big bold metric tile for the traction dashboard. Number ticks/transitions
 * smoothly on poll updates.
 */

import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  accent?: "amber" | "emerald" | "neutral";
}

const ACCENTS = {
  amber: "text-seal bg-seal/10",
  emerald: "text-paid bg-paid/10",
  neutral: "text-ink bg-paper-2",
} as const;

export function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  accent = "neutral",
}: MetricCardProps) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
          {label}
        </span>
        <span
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-lg",
            ACCENTS[accent],
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div>
        <p className="font-mono text-2xl tracking-tight tabular-nums text-ink sm:text-3xl">
          {value}
        </p>
        {sub && <p className="mt-0.5 text-xs text-ink-3">{sub}</p>}
      </div>
    </Card>
  );
}
