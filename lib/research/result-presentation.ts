import { formatRecordedUsdc } from "../display/recorded-usdc";
import { reasoningServingText, surfaceReasoning, type ReasoningSurface } from "../llm/reasoning-telemetry";
import { uniqueOutputLimits } from "../llm/output-limit-diagnostic";
import type { Confidence } from "../types";
import { researchPresentationMessages } from "./presentation-messages";
import { readCompletedAnswerLanguage, type CompletedAnswerLanguageProvenance } from "./answer-language-provenance";
import { livePresentationLocale, recordedPresentationLocale, type PresentationLanguage, type PresentationLocale, type RequestedPresentationLanguage } from "./presentation-language";

/** The resolution is presentation metadata, never a new response/receipt/answer-language field. */
export function presentationLocaleNotice(locale: PresentationLocale): string {
  const copy = researchPresentationMessages(locale.language);
  if (locale.unsupportedRequestedLanguage) return copy("unsupported");
  if (locale.agreement === "MISMATCH") return copy("requestedMismatch", { language: locale.language, answerLanguage: locale.answerLanguage });
  return locale.source === "requested" && locale.answerLanguage === "UNKNOWN" ? copy("requestedUnknown", { language: locale.language }) : "";
}

/** Shared recorded facts, same bounded projection as the existing English renderer. */
export function presentationReasoningText(result: Partial<ReasoningSurface>, language: PresentationLanguage): string {
  if (language === "en") return reasoningServingText(result);
  const copy = researchPresentationMessages(language), reasoning = result.reasoning;
  const fallback = (value: boolean | null) => copy(value === true ? "fallbackServed" : value === false ? "requestedServed" : "fallbackUnknown");
  const tiers = !reasoning || !Array.isArray(reasoning.steps) ? copy("servingUnavailable")
    : !reasoning.steps.length ? copy("servingNoSteps", { telemetry: reasoning.telemetry })
    : copy("servingSummary", { telemetry: reasoning.telemetry, steps: reasoning.steps.map(step => {
      const values = { step: step.step, engines: step.servingEngines.slice(0, 4).join(" + ") || copy("noneRecorded"),
        state: step.state, fallback: fallback(step.fallbackUsed) };
      return step.servingEngines.length > 4 ? copy("servingStepMore", { ...values, count: step.servingEngines.length - 4 }) : copy("servingStep", values);
    }).join("; ") });
  const limits = uniqueOutputLimits([...(surfaceReasoning(result.reasoningAttempts).outputLimits ?? []),
    ...(Array.isArray(result.outputLimits) ? result.outputLimits.slice(0, 2304) : [])]);
  const labels = { decompose: "limitPlanning", decide: "limitSelection", sufficiency: "limitCoverage",
    reevaluate: "limitReassessment", synthesize: "limitAnswer", attribute: "limitAttribution" } as const;
  const parts = limits.slice(0, 8).map(item => `${copy(labels[item.step])} (${item.outputTokenLimit.toLocaleString("en-US")} tokens` +
    (item.stage === "review" ? copy("limitReview") : item.stage === "generation" ? copy("limitGeneration") : "") + ")");
  const notice = parts.length ? copy("limitNotice", { limits: parts.join("; ") + (limits.length > 8 ? copy("limitMore", { count: limits.length - 8 }) : "") }) : "";
  const omitted = result.outputLimitTraceStepsOmitted;
  const partial = typeof omitted === "number" && Number.isSafeInteger(omitted) && omitted > 0
    ? copy("limitPartial", { count: omitted.toLocaleString("en-US") }) : "";
  return [tiers, notice, partial].filter(Boolean).join("\n");
}

/** Existing financial authority prose remains exact English; ordinary headings are separate. */
export const API_SETTLEMENT_NOTICE = "Planned rewards and recorded totals do not establish settlement; inspect the original payment receipts. ";

export interface RemotePresentationResult extends ReasoningSurface {
  answer: string;
  citations: { source: string; rewardPlannedUsdc: number }[];
  claimCoverage: { coverage: number }[];
  paymentMode: string;
  settledPayments: number;
  paymentAttempts: number;
  totalToCreatorsUsdc: number;
  operatingFee?: { amountUsdc: number; status: string };
  confidence?: Confidence;
  dispatchUrl: string;
}
/** Caller supplies the existing public projection; no private reads/enrichment or new response fields. */
export function remoteResearchText(result: RemotePresentationResult, locale: PresentationLocale): string {
  const copy = researchPresentationMessages(locale.language);
  const rewards = result.citations.length ? result.citations.map(c => `- ${c.source}: ${formatRecordedUsdc(c.rewardPlannedUsdc, { minimumFractionDigits: 4 })} USDC`).join("\n")
    : `- ${copy("noRewards")}`;
  const settlement = result.paymentMode === "real" ? `${result.settledPayments}/${result.paymentAttempts} payment attempts settled`
    : result.paymentMode === "offline" ? "offline payment simulation" : "payment mode unknown; no simulation or settlement inferred";
  const selection = result.reasoning.sourceSelection;
  const selectionText = copy("selection", { state: selection.state, engines: selection.servingEngines.slice(0, 4).join(", ") || copy("noneRecorded"),
    more: selection.servingEngines.length > 4 ? copy("more", { count: selection.servingEngines.length - 4 }) : "",
    fallback: copy(selection.fallbackUsed === true ? "fallbackServed" : selection.fallbackUsed === false ? "requestedServed" : "fallbackUnknown"),
    telemetry: result.reasoning.telemetry });
  const authority = `${copy("remoteTotal")} ${formatRecordedUsdc(result.totalToCreatorsUsdc, { minimumFractionDigits: 4 })} USDC · ${settlement}\n` +
    (result.operatingFee ? `Keryx operating fee allocation: ${formatRecordedUsdc(result.operatingFee.amountUsdc, { minimumFractionDigits: 6 })} USDC · ${result.operatingFee.status}. Separate from creator rewards; inspect the payment ledger for settlement evidence.\n` : "");
  const notice = presentationLocaleNotice(locale);
  return `${result.answer}\n\n${presentationReasoningText(result, locale.language)}\n\n` +
    `${copy("citations")}\n${rewards}\n\n` + copy("evidence", { covered: result.claimCoverage.filter(c => c.coverage >= 0.4).length, total: result.claimCoverage.length }) +
    `\n${selectionText}\n` + (locale.language === "en" ? "" : `${copy("financialDetails")}\n`) + authority +
    `${copy("confidence")} ${result.confidence?.level ?? "Low"} · ${result.dispatchUrl}` + (notice ? `\n\n${notice}` : "");
}

export interface StdioPresentationResult extends Partial<ReasoningSurface> {
  status?: string; queryId?: string; answerLanguage?: CompletedAnswerLanguageProvenance;
  answer: string; citations: { source: string; reward: number }[]; totalToCreators: number; settlementId?: string; amountPaid?: string;
}
/** The paid request/body/hash/custody path is intentionally not an input to this text renderer. */
export function stdioResearchText(result: StdioPresentationResult, baseUrl: string, locale: PresentationLocale): string {
  const copy = researchPresentationMessages(locale.language);
  const cites = result.citations?.length ? result.citations.map(c => `  • ${c.source} — ${formatRecordedUsdc(c.reward)}`).join("\n") : "  (none)";
  const proof = result.settlementId ? ` (Circle Gateway settlement ${result.settlementId.slice(0, 12)}…, batched on Arc)` : "";
  // Exact pre-existing English payment/settlement authority and canonical amount strings.
  const authority = `— Paid Keryx ${result.amountPaid} USDC${proof}\n` +
    `Recorded creator total: ${formatRecordedUsdc(result.totalToCreators)}; citation allocations (not individual settlement proof):\n${cites}\n` +
    `On-chain proof + live feed: ${baseUrl}/dashboard`;
  const notice = presentationLocaleNotice(locale);
  return `${result.answer}\n\n${presentationReasoningText(result, locale.language)}\n\n` +
    (locale.language === "en" ? "" : `${copy("financialDetails")}\n`) + authority + (notice ? `\n\n${notice}` : "");
}

/** Presentation adapter only. Injection keeps custody/client startup out of offline contract tests. */
export function createStdioResearchHandler<T extends StdioPresentationResult>(ask: (question: string, budget?: number) => Promise<T>, baseUrl: string) {
  return async ({ question, budget, language }: { question: string; budget?: number; language?: RequestedPresentationLanguage }) => {
    const locale = livePresentationLocale({ requestedLanguage: language, originalQuestion: question });
    try {
      const result = await ask(question, budget);
      const packet = result.status === "completed" ? readCompletedAnswerLanguage(result.answerLanguage, result.queryId, result.answer) : undefined;
      const completedLocale = livePresentationLocale({ requestedLanguage: language, originalQuestion: question, recordedAnswerLanguage: packet?.language });
      const { answerLanguage, ...publicResult } = result;
      return { content: [{ type: "text" as const, text: stdioResearchText(result, baseUrl, completedLocale) }],
        structuredContent: { ...publicResult, ...(packet ? { answerLanguage: packet } : {}) } };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { isError: true, content: [{ type: "text" as const, text: researchPresentationMessages(locale.language)("stdioFailure", { detail }) }] };
    }
  };
}

/** Shared label contract for the report owner. No question/request inference, report rendering,
 * payment formatting, privacy projection or stored-answer metadata write is performed here. */
export function recordedReportPresentation(recordedAnswerLanguage: unknown) {
  const locale = recordedPresentationLocale(recordedAnswerLanguage), copy = researchPresentationMessages(locale.language);
  return { locale, notice: locale.answerLanguage === "UNKNOWN" ? copy("recordedUnknown") : "", labels: {
    title: copy("reportTitle"), bibliography: copy("reportBibliography"), sources: copy("reportSources"), evidence: copy("reportEvidence"),
    evidenceNotice: copy("reportEvidenceNotice"), quote: copy("reportQuote"), confidence: copy("reportConfidence"), payments: copy("reportPayments"),
  } };
}
