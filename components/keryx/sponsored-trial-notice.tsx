import { createMessages } from "@/lib/i18n/messages";

const message = createMessages("en");

import Link from "next/link";

/** Explains the existing hosted trial without granting funds or changing the selected payer. */
export function SponsoredTrialNotice({ prepareQuestion = false }: { prepareQuestion?: boolean }) {
  return <aside aria-label={message("researchTrial.label")} className="mb-4 border border-paid/30 bg-paper px-4 py-3">
    <h2 className="font-mono text-xs font-semibold text-paid">{message("researchTrial.title")}</h2>
    <p className="mt-1 font-serif text-sm leading-relaxed text-ink-2">
        {message("researchTrial.limits")}
    </p>
    <Link prefetch={false} href={prepareQuestion ? "/#dispatch" : "/literature"}
      className="mt-1 inline-flex min-h-11 items-center font-mono text-xs text-seal underline underline-offset-4">
      {prepareQuestion ? message("researchTrial.prepareQuestion") : message("researchTrial.literatureLink")}
    </Link>
    <p className="font-serif text-xs leading-relaxed text-ink-3">
      {message(prepareQuestion ? "researchTrial.publicAndPayerNotice" : "researchTrial.publicNotice")}
    </p>
  </aside>;
}
