import { jobCompletionTarget } from "@/lib/operator/job-targets";
import { jobTargetCopy } from "@/locales/en/job-targets";
import { UiText } from "@/lib/i18n/ui-copy";



export function ResearchJobTarget({ mode, version, monthly = false }: {
  mode: "quick" | "deep"; version: string; monthly?: boolean;
}) {
  const target = jobCompletionTarget(mode, version);
  return <div className="space-y-2 font-serif text-sm" data-job-completion-target>
    <p><UiText source={target ? jobTargetCopy.target(target.tier, target.seconds) : jobTargetCopy.unavailable} namespaces={["job-targets"]} /></p>
    {target && <p className="text-ink-3"><UiText source={jobTargetCopy.terms} namespaces={["job-targets"]} /></p>}
    {target && <p className="text-ink-3"><UiText source={jobTargetCopy.reviewTerms} namespaces={["job-targets"]} /></p>}
    {target && monthly && <p className="text-ink-3"><UiText source={jobTargetCopy.monthly} namespaces={["job-targets"]} /></p>}
  </div>;
}
