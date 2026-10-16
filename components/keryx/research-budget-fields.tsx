"use client";


import { useUiMessages } from "@/lib/i18n/ui-copy";





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
  const copy = useUiMessages();
  return <div className="grid gap-3 sm:grid-cols-2">
    <label className="flex flex-col gap-1.5 text-xs text-ink-2">
      {copy("budgetFields.questionCap")}
      <input aria-label={copy("budgetFields.questionCap")} type="text" inputMode="decimal"
        value={questionInput} onChange={event => onQuestionChange(event.target.value)}
        className="w-full border border-ink/30 bg-paper px-3 py-2 font-mono text-xs text-ink focus:border-seal focus:outline-none" />
    </label>
    <label className="flex flex-col gap-1.5 text-xs text-ink-2">
      {copy("budgetFields.duration")}
      <select aria-label={copy("budgetFields.duration")} value={durationSeconds} onChange={event => onDurationChange(Number(event.target.value))}
        className="w-full border border-ink/30 bg-paper px-3 py-2 font-mono text-xs text-ink focus:border-seal focus:outline-none">
        <option value={3600}>{copy("budgetFields.hours.one", { count: 1 })}</option>
        <option value={86400}>{copy("budgetFields.hours.other", { count: 24 })}</option>
        <option value={604800}>{copy("budgetFields.days.other", { count: 7 })}</option>
      </select>
    </label>
  </div>;
}
