"use client";

/**
 * UsdcPresetChips — quick-pick USDC amounts for the session funding inputs.
 *
 * Purely presentational: clicking a chip writes the amount into the caller's
 * text state (the same state the free-form input edits), so the input stays
 * the single source of truth and stays hand-editable.
 */

interface Props {
  /** Current raw input text — the matching chip renders as selected. */
  value: string;
  onPick: (amount: string) => void;
}

/** Ladder chosen for real Keryx budgets: a single ask (~$0.05), a session, a heavy session. */
const PRESETS = ["0.05", "0.25", "1"] as const;

export function UsdcPresetChips({ value, onPick }: Props) {
  const current = parseFloat(value);
  return (
    <div className="flex items-center gap-1">
      {PRESETS.map((amount) => {
        const selected = Number.isFinite(current) && current === parseFloat(amount);
        return (
          <button
            key={amount}
            type="button"
            onClick={() => onPick(amount)}
            aria-pressed={selected}
            className={
              "border px-2 py-1 font-mono text-[10px] tracking-[0.08em] transition-colors " +
              (selected
                ? "border-seal bg-seal/10 text-seal"
                : "border-ink/25 bg-paper text-ink-3 hover:border-seal/60 hover:text-ink")
            }
          >
            ${amount}
          </button>
        );
      })}
    </div>
  );
}
