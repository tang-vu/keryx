/**
 * Banknote vocabulary shared across the Mint surfaces:
 * - SectionHeading: the engraved "§ I · The purchase ———" rule above a panel.
 * - Microprint: the tiny security-print strip that runs under the hero.
 * - Ticker: a slow running tape with faded edges.
 *
 * Panels themselves are plain `border border-ink bg-paper` blocks (the crisp
 * banknote frame); the double-frame variant wraps that in `border-2 border-ink
 * p-[5px]`.
 */

import { cn } from "@/lib/utils";

export function SectionHeading({
  numeral,
  label,
  right,
  className,
}: {
  numeral: string;
  label: string;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3.5 flex items-baseline gap-3", className)}>
      <span className="letterpress font-display text-[20px] font-semibold italic text-seal">
        § {numeral}
      </span>
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
        {label}
      </span>
      <span className="h-px flex-1 bg-line" />
      {right && (
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">
          {right}
        </span>
      )}
    </div>
  );
}

export function Microprint({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const unit = `${text}　·　`;
  return (
    <div
      aria-hidden
      className={cn(
        "overflow-hidden whitespace-nowrap font-mono text-[8px] uppercase leading-none tracking-[0.18em] text-ink-3/70 select-none",
        className,
      )}
    >
      {unit.repeat(24)}
    </div>
  );
}

export function Ticker({
  items,
  className,
}: {
  items: string[];
  className?: string;
}) {
  const run = [...items, ...items];
  return (
    <div
      className={cn("relative overflow-hidden", className)}
      style={{
        maskImage:
          "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
        WebkitMaskImage:
          "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
      }}
    >
      <div
        className="flex w-max gap-10 whitespace-nowrap"
        style={{ animation: "kxTape 38s linear infinite" }}
      >
        {run.map((it, i) => (
          <span
            key={i}
            className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3"
          >
            <span className="h-1 w-1 rounded-full bg-seal" />
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}
