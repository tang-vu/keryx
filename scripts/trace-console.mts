/**
 * Shared ANSI console helpers for the CLI reasoning-trace printers
 * (scripts/ask.mts and scripts/demo-full-cycle.mts). One source of truth for the
 * trace look so both entry points stay identical.
 */

import type { TraceStep } from "../lib/types.ts";

export const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[22m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[39m`,
  green: (s: string) => `\x1b[32m${s}\x1b[39m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[39m`,
  red: (s: string) => `\x1b[31m${s}\x1b[39m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[39m`,
};

const phaseColor: Record<string, (s: string) => string> = {
  decompose: c.cyan,
  discover: c.cyan,
  decide: c.yellow,
  fetch: c.green,
  sufficiency: c.magenta,
  reevaluate: c.yellow,
  synthesize: c.cyan,
  adjudicate: c.magenta,
  verdict: c.magenta,
  attribute: c.magenta,
  settle: c.green,
  done: c.bold,
};

/** Print one streamed trace step with a phase-colored tag. */
export function printStep(s: TraceStep): void {
  const tag = (phaseColor[s.phase] ?? c.dim)(`[${s.phase}]`.padEnd(14));
  console.log(`${tag} ${s.message}`);
}
