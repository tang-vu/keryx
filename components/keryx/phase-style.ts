/**
 * Visual vocabulary for the agent's reasoning trace. Maps trace phases and
 * decision actions to a cohesive color system (amber/gold = paid/herald,
 * emerald = settled). Kept framework-agnostic (plain class strings) so any
 * component can render a consistent chip.
 */

import type { DecisionAction, TracePhase } from "@/lib/types";
import {
  Activity,
  BadgeCheck,
  Banknote,
  Brain,
  CheckCircle2,
  Coins,
  Download,
  Quote,
  Scale,
  Search,
  type LucideIcon,
} from "lucide-react";

export interface PhaseStyle {
  label: string;
  /** chip background + text */
  chip: string;
  /** small dot / accent color */
  dot: string;
  icon: LucideIcon;
}

export const PHASE_STYLES: Record<TracePhase, PhaseStyle> = {
  decompose: {
    label: "Decompose",
    chip: "bg-slate-100 text-slate-700 border-slate-200",
    dot: "bg-slate-400",
    icon: Brain,
  },
  discover: {
    label: "Discover",
    chip: "bg-slate-100 text-slate-700 border-slate-200",
    dot: "bg-slate-400",
    icon: Search,
  },
  decide: {
    label: "Decide",
    chip: "bg-amber-100 text-amber-800 border-amber-200",
    dot: "bg-amber-500",
    icon: Scale,
  },
  fetch: {
    label: "Fetch",
    chip: "bg-emerald-100 text-emerald-800 border-emerald-200",
    dot: "bg-emerald-500",
    icon: Download,
  },
  sufficiency: {
    label: "Sufficiency",
    chip: "bg-violet-100 text-violet-800 border-violet-200",
    dot: "bg-violet-500",
    icon: BadgeCheck,
  },
  synthesize: {
    label: "Synthesize",
    chip: "bg-sky-100 text-sky-800 border-sky-200",
    dot: "bg-sky-500",
    icon: Activity,
  },
  attribute: {
    label: "Attribute",
    chip: "bg-violet-100 text-violet-800 border-violet-200",
    dot: "bg-violet-500",
    icon: Quote,
  },
  settle: {
    label: "Settle",
    chip: "bg-emerald-100 text-emerald-800 border-emerald-200",
    dot: "bg-emerald-500",
    icon: Coins,
  },
  done: {
    label: "Done",
    chip: "bg-emerald-100 text-emerald-800 border-emerald-200",
    dot: "bg-emerald-500",
    icon: CheckCircle2,
  },
};

export interface ActionStyle {
  label: string;
  badge: string;
  icon: LucideIcon;
}

export const ACTION_STYLES: Record<DecisionAction, ActionStyle> = {
  BUY: {
    label: "BUY",
    badge:
      "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 ring-1 ring-emerald-500/10",
    icon: Banknote,
  },
  CACHE: {
    label: "CACHE",
    badge: "bg-blue-500/15 text-blue-700 border-blue-500/30",
    icon: Download,
  },
  SKIP: {
    label: "SKIP",
    badge: "bg-muted text-muted-foreground border-border",
    icon: Search,
  },
};

/** Short 0x… address for display. */
export function shortAddr(addr?: string | null): string {
  if (!addr) return "—";
  if (addr.startsWith("0x") && addr.length > 12) {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  }
  if (addr.length > 14) return `${addr.slice(0, 10)}…`;
  return addr;
}

/** Short tx hash for display. */
export function shortHash(hash?: string | null): string {
  if (!hash) return "";
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

/** Format a USDC amount with up to 6 decimals, trimmed. */
export function fmtUsdc(n: number | undefined | null, opts?: { sign?: boolean }): string {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  const s = v.toFixed(6).replace(/\.?0+$/, "");
  const out = s === "" || s === "-" ? "0" : s;
  return opts?.sign ? `$${out}` : out;
}
