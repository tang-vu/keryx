/** Product-owned bot notices; not a UI locale or a payment-state dictionary. */
export const botResearchEnglish = Object.freeze({
  citationHeading: "Citations and planned rewards (USDC)",
  slackCitationHeading: "Citations and planned rewards — weighted USDC citation rewards",
  weight: "weight {weight}",
  sourcesOne: "{count} source cited",
  sourcesOther: "{count} sources cited",
  recordedCreators: "{amount} recorded to creators",
  recordedCreatorTotal: "{amount} recorded creator-payment total",
  settlementNotice: "Recorded amounts are not settlement proof; check the full trace receipts.",
  slackSettlementNotice: "Planned rewards are not settlement evidence. See the trace for settled, pending, failed or simulated payments.",
  discordSettlementNotice: "Recorded amounts are not settlement proof; check full trace receipts at the title link",
  fullTrace: "Full trace: {url}",
  failure: "⚠️ Keryx could not finish this dispatch: {detail}",
  paused: "New research is temporarily paused while an earlier delivery is reviewed. You can still inspect saved reports. Increasing the source budget or connecting a wallet will not remove this pause. Your question has not been retried.",
  treasuryUnavailable: "Keryx's treasury wallet is not configured on this deployment.",
  sponsoredLimited: "Sponsored dispatches are temporarily limited or unavailable — try again in a minute.",
  dispatching: "⏳ Keryx is dispatching — buying sources and settling citations…",
  discordUsage: "Only `/ask question:<text>` is wired up here.",
} as const);

export type BotResearchCatalogue = { readonly [Key in keyof typeof botResearchEnglish]: string };

/** No original question or admitted preference exists on a bare help command. */
export const botHelpEnglish = Object.freeze({
  herald: "Keryx",
  tagline: "the citation-toll research herald.",
  telegramExplanation: "Ask a question and Keryx reads selected sources, returns cited evidence, and records planned USDC creator rewards. Open the full trace to check payment mode and settlement receipts.",
  slackExplanation: "Ask a question and Keryx selects sources within a budget, answers with citations, and attempts weighted USDC rewards for eligible cited creators. The dispatch trace shows payment outcomes.",
  telegramUsage: "Usage: <code>/ask what is x402?</code>",
  slackUsage: "Usage: `/keryx what is x402?`",
  reviewBoundary: "Review-first is available only in the authenticated live browser; review mode flags are refused here.",
  privateQuestion: "In this private chat you can also just type the question.",
  telegramStatus: "Creators keep 100%. Live traction:",
  slackStatus: "Creator payments and service charges are recorded separately. Live status:",
} as const);
