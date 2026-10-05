"use client";

export function parseBudgetAmount(value: string): number | null {
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value)) return null;
  const amount = Number(value), micros = Math.round(amount * 1e6);
  return amount > 0 && Number.isSafeInteger(micros) && micros > 0 ? amount : null;
}

interface Props {
  questionInput: string;
  onQuestionChange(value: string): void;
  durationSeconds: number;
  onDurationChange(value: number): void;
}

export function ResearchBudgetFields({ questionInput, onQuestionChange, durationSeconds, onDurationChange }: Props) {
  return <div className="grid gap-3 sm:grid-cols-2">
    <label className="flex flex-col gap-1.5 text-xs text-ink-2">
      Maximum per question (USDC)
      <input aria-label="Maximum per question (USDC)" type="text" inputMode="decimal"
        value={questionInput} onChange={event => onQuestionChange(event.target.value)}
        className="w-full border border-ink/30 bg-paper px-3 py-2 font-mono text-xs text-ink focus:border-seal focus:outline-none" />
    </label>
    <label className="flex flex-col gap-1.5 text-xs text-ink-2">
      Budget duration
      <select aria-label="Budget duration" value={durationSeconds} onChange={event => onDurationChange(Number(event.target.value))}
        className="w-full border border-ink/30 bg-paper px-3 py-2 font-mono text-xs text-ink focus:border-seal focus:outline-none">
        <option value={3600}>1 hour</option>
        <option value={86400}>24 hours</option>
        <option value={604800}>7 days</option>
      </select>
    </label>
  </div>;
}
