"use client";

import type { RunVisibility } from "@/lib/run-privacy/contracts";
import type { useResearchVisibility } from "@/lib/hooks/use-research-visibility";
import { UiMessage, useUiMessages } from "@/lib/i18n/ui-copy";



const exposure = { private: 0, unlisted: 1, public: 2 };

export function ResearchVisibilityPicker({ preference, disabled, parentVisibility, allowedVisibilities, compact, showContextHint = true }: {
  preference: ReturnType<typeof useResearchVisibility>; disabled?: boolean; parentVisibility?: RunVisibility; allowedVisibilities?: readonly RunVisibility[]; compact?: boolean; showContextHint?: boolean;
}) {
  const message = useUiMessages();
  return <div className={compact ? "mb-2" : "mt-3 border-t border-line pt-3"} data-testid="research-visibility">
    <label className="flex min-h-11 flex-wrap items-center gap-3 font-mono text-xs text-ink">
      <UiMessage messageKey="researchVisibility.label" />
      <select value={preference.visibility} disabled={disabled || !preference.ready} onChange={event => preference.choose(event.target.value as RunVisibility)}
        className="min-h-11 border border-ink bg-paper px-3 py-2">
        {(["public", "unlisted", "private"] as const).map(value => <option dir="auto" key={value} value={value}
          disabled={!!allowedVisibilities && !allowedVisibilities.includes(value) || !preference.privacyActive && value !== "public" || value === "private" && !preference.wallet
            || !!parentVisibility && exposure[value] > exposure[parentVisibility]}>{message(`researchVisibility.${value}`)}</option>)}
      </select>
    </label>
    <p className={compact ? "mt-1 text-xs leading-4 text-ink-2 sm:text-sm sm:leading-relaxed" : "mt-1 text-sm leading-relaxed text-ink-2"} role="status">
      <UiMessage messageKey={preference.status === "loading" ? "researchVisibility.loading" : preference.status === "error"
        ? "researchVisibility.unavailable" : `researchVisibility.${preference.visibility}Notice`} />
    </p>
    {preference.status === "error" && <button type="button" onClick={preference.retry} disabled={disabled} className="min-h-11 text-sm underline"><UiMessage messageKey="researchVisibility.retry" /></button>}
    {showContextHint && preference.ready && <p className={compact ? "mt-1 text-[11px] leading-4 text-ink-3 sm:text-xs" : "mt-1 text-xs text-ink-3"}><UiMessage messageKey={parentVisibility && parentVisibility !== "public"
      ? "researchVisibility.followUp" : !preference.wallet ? "researchVisibility.signIn" : "researchVisibility.questionOnly"} /></p>}
  </div>;
}
