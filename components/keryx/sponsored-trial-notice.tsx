import Link from "next/link";

/** Explains the existing hosted trial without granting funds or changing the selected payer. */
export function SponsoredTrialNotice({ prepareQuestion = false }: { prepareQuestion?: boolean }) {
  return <aside aria-label="Sponsored research trial" className="mb-4 border border-paid/30 bg-paper px-4 py-3">
    <h2 className="font-mono text-xs font-semibold text-paid">Research trial, sponsored by Keryx</h2>
    <p className="mt-1 font-serif text-sm leading-relaxed text-ink-2">
        No wallet or USDC deposit required. Keryx covers source purchases, eligible creator rewards and operating fees within its trial usage and spending limits.
    </p>
    <Link prefetch={false} href={prepareQuestion ? "/#dispatch" : "/literature"}
      className="mt-1 inline-flex min-h-11 items-center font-mono text-xs text-seal underline underline-offset-4">
      {prepareQuestion ? "Prepare a research question →" : "Working on a literature review? Save and compare papers →"}
    </Link>
    <p className="font-serif text-xs leading-relaxed text-ink-3">
      Trial reports have public links. Use questions you can share publicly.
      {prepareQuestion && " Check who pays in the question composer; an active research budget uses your USDC."}
    </p>
  </aside>;
}
