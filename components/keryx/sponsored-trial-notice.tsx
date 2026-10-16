import { createMessages } from "@/lib/i18n/messages";

const message = createMessages("en");

import Link from "next/link";
import { UiAttributes, UiMessage, UiText } from "@/lib/i18n/ui-copy";



/** Explains the existing hosted trial without granting funds or changing the selected payer. */
export function SponsoredTrialNotice({ prepareQuestion = false }: { prepareQuestion?: boolean }) {
  return <UiAttributes names={["aria-label"]}><aside aria-label={message("researchTrial.label")} className="mb-4 border border-paid/30 bg-paper px-4 py-3">
    <h2 className="font-mono text-xs font-semibold text-paid"><UiMessage messageKey={"researchTrial.title"} /></h2>
    <p className="mt-1 font-serif text-sm leading-relaxed text-ink-2">
        <UiMessage messageKey={"researchTrial.limits"} />
    </p>
    <Link prefetch={false} href={prepareQuestion ? "/#dispatch" : "/literature"}
      className="mt-1 inline-flex min-h-11 items-center font-mono text-xs text-seal underline underline-offset-4">
      <UiText source={prepareQuestion ? message("researchTrial.prepareQuestion") : message("researchTrial.literatureLink")} />
    </Link>
    <p className="font-serif text-xs leading-relaxed text-ink-3">
      <UiMessage messageKey={prepareQuestion ? "researchTrial.publicAndPayerNotice" : "researchTrial.publicNotice"} />
    </p>
  </aside></UiAttributes>;
}
