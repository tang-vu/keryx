"use client";
import { createMessages } from "@/lib/i18n/messages";
import type { RunVisibility } from "@/lib/run-privacy/contracts";
import type { useResearchVisibility } from "@/lib/hooks/use-research-visibility";
const message = createMessages("en");
const exposure = { private: 0, unlisted: 1, public: 2 };

export function ResearchVisibilityPicker({ preference, disabled, parentVisibility, allowedVisibilities }: {
  preference: ReturnType<typeof useResearchVisibility>; disabled?: boolean; parentVisibility?: RunVisibility; allowedVisibilities?: readonly RunVisibility[];
}) {
  return <div className="mt-3 border-t border-line pt-3" data-testid="research-visibility">
    <label className="flex min-h-11 flex-wrap items-center gap-3 font-mono text-xs text-ink">
      {message("researchVisibility.label")}
      <select value={preference.visibility} disabled={disabled || !preference.ready} onChange={event => preference.choose(event.target.value as RunVisibility)}
        className="min-h-11 border border-ink bg-paper px-3 py-2">
        {(["public", "unlisted", "private"] as const).map(value => <option key={value} value={value}
          disabled={!!allowedVisibilities && !allowedVisibilities.includes(value) || !preference.privacyActive && value !== "public" || value === "private" && !preference.wallet
            || !!parentVisibility && exposure[value] > exposure[parentVisibility]}>{message(`researchVisibility.${value}`)}</option>)}
      </select>
    </label>
    <p className="mt-1 text-sm leading-relaxed text-ink-2" role="status">
      {preference.status === "loading" ? message("researchVisibility.loading") : preference.status === "error"
        ? message("researchVisibility.unavailable") : message(`researchVisibility.${preference.visibility}Notice`)}
    </p>
    {preference.status === "error" && <button type="button" onClick={preference.retry} disabled={disabled} className="min-h-11 text-sm underline">{message("researchVisibility.retry")}</button>}
    {preference.ready && <p className="mt-1 text-xs text-ink-3">{parentVisibility && parentVisibility !== "public"
      ? message("researchVisibility.followUp") : !preference.wallet ? message("researchVisibility.signIn") : message("researchVisibility.questionOnly")}</p>}
  </div>;
}
