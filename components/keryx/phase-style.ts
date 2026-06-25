/**
 * Visual vocabulary for the agent's reasoning trace. Maps trace phases and
 * decision actions onto "The Mint" palette — the vermillion seal marks a
 * spending decision, treasury green marks money moving (fetch / settle), and
 * structural phases stay quiet ink. Kept framework-agnostic (plain class
 * strings) so any component can render a consistent chip.
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
  RotateCcw,
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

const NEUTRAL = "bg-paper-2 text-ink-2 border-line";
const SEAL = "bg-seal/10 text-seal border-seal/30";
const PAID = "bg-paid/10 text-paid border-paid/30";

export const PHASE_STYLES: Record<TracePhase, PhaseStyle> = {
  decompose: { label: "Decompose", chip: NEUTRAL, dot: "bg-ink-3", icon: Brain },
  discover: { label: "Discover", chip: NEUTRAL, dot: "bg-ink-3", icon: Search },
  decide: { label: "Decide", chip: SEAL, dot: "bg-seal", icon: Scale },
  fetch: { label: "Fetch", chip: PAID, dot: "bg-paid", icon: Download },
  sufficiency: { label: "Sufficiency", chip: NEUTRAL, dot: "bg-ink-3", icon: BadgeCheck },
  reevaluate: { label: "Re-evaluate", chip: SEAL, dot: "bg-seal", icon: RotateCcw },
  synthesize: { label: "Synthesize", chip: NEUTRAL, dot: "bg-ink-3", icon: Activity },
  attribute: { label: "Attribute", chip: SEAL, dot: "bg-seal", icon: Quote },
  settle: { label: "Settle", chip: PAID, dot: "bg-paid", icon: Coins },
  done: { label: "Done", chip: PAID, dot: "bg-paid", icon: CheckCircle2 },
};

export interface ActionStyle {
  label: string;
  badge: string;
  icon: LucideIcon;
}

export const ACTION_STYLES: Record<DecisionAction, ActionStyle> = {
  BUY: {
    label: "BUY",
    badge: "bg-paid/12 text-paid border-paid/30",
    icon: Banknote,
  },
  CACHE: {
    label: "CACHE",
    badge: "bg-paper-2 text-ink-2 border-ink-3/40",
    icon: Download,
  },
  SKIP: {
    label: "SKIP",
    badge: "bg-transparent text-ink-3 border-line",
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
