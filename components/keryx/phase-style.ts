import { formatRecordedAmount } from "@/lib/i18n/format";
/**
 * Visual vocabulary for the agent's reasoning trace. Maps trace phases and
 * decision actions onto "The Mint" palette — the vermillion seal marks a
 * spending decision, treasury green marks money moving (fetch / settle), and
 * structural phases stay quiet ink. Kept framework-agnostic (plain class
 * strings) so any component can render a consistent chip.
 */

import { createMessages } from "@/lib/i18n/messages";

const message = createMessages("en");

import type { DecisionAction, TracePhase } from "@/lib/types";
import {
  Activity,
  BadgeCheck,
  Banknote,
  Brain,
  CheckCircle2,
  Coins,
  Download,
  FileCheck2,
  Gauge,
  Gavel,
  Quote,
  RotateCcw,
  Scale,
  ScanSearch,
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
  decompose: { label: message("decisionPhase.decompose"), chip: NEUTRAL, dot: "bg-ink-3", icon: Brain },
  discover: { label: message("decisionPhase.discover"), chip: NEUTRAL, dot: "bg-ink-3", icon: Search },
  coverage: { label: message("decisionPhase.precheck"), chip: SEAL, dot: "bg-seal", icon: ScanSearch },
  decide: { label: message("decisionPhase.decide"), chip: SEAL, dot: "bg-seal", icon: Scale },
  fetch: { label: message("decisionPhase.fetch"), chip: PAID, dot: "bg-paid", icon: Download },
  sufficiency: { label: message("decisionPhase.sufficiency"), chip: NEUTRAL, dot: "bg-ink-3", icon: BadgeCheck },
  reevaluate: { label: message("decisionPhase.reevaluate"), chip: SEAL, dot: "bg-seal", icon: RotateCcw },
  synthesize: { label: message("decisionPhase.synthesize"), chip: NEUTRAL, dot: "bg-ink-3", icon: Activity },
  evidence: { label: message("decisionPhase.evidence"), chip: PAID, dot: "bg-paid", icon: FileCheck2 },
  adjudicate: { label: message("decisionPhase.adjudicate"), chip: SEAL, dot: "bg-seal", icon: Gavel },
  verdict: { label: message("decisionPhase.verdict"), chip: NEUTRAL, dot: "bg-ink-3", icon: Gauge },
  attribute: { label: message("decisionPhase.attribute"), chip: SEAL, dot: "bg-seal", icon: Quote },
  settle: { label: message("decisionPhase.settle"), chip: PAID, dot: "bg-paid", icon: Coins },
  done: { label: message("decisionPhase.done"), chip: PAID, dot: "bg-paid", icon: CheckCircle2 },
};

export interface ActionStyle {
  label: string;
  badge: string;
  icon: LucideIcon;
}

export const ACTION_STYLES: Record<DecisionAction, ActionStyle> = {
  BUY: {
    label: message("sourceDecision.buy"),
    badge: "bg-paid/12 text-paid border-paid/30",
    icon: Banknote,
  },
  CACHE: {
    label: message("sourceDecision.cache"),
    badge: "bg-paper-2 text-ink-2 border-ink-3/40",
    icon: Download,
  },
  SKIP: {
    label: message("sourceDecision.skip"),
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
  return formatRecordedAmount(n, { denomination: opts?.sign ? "$" : undefined });
}
