import { jobCompletionTarget } from "@/lib/operator/job-targets";
import { jobTargetCopy } from "@/locales/en/job-targets";

export function ResearchJobTarget({ mode, version, monthly = false }: {
  mode: "quick" | "deep"; version: string; monthly?: boolean;
}) {
  const target = jobCompletionTarget(mode, version);
  return <div className="space-y-2 font-serif text-sm" data-job-completion-target>
    <p>{target ? jobTargetCopy.target(target.tier, target.seconds) : jobTargetCopy.unavailable}</p>
    {target && <p className="text-ink-3">{jobTargetCopy.terms}</p>}
    {target && monthly && <p className="text-ink-3">{jobTargetCopy.monthly}</p>}
  </div>;
}
