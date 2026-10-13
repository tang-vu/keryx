import { Buffer } from "node:buffer";
import { expect, it } from "vitest";
import { buildAnswerContent, keryxMeta } from "../openai-compat";
import { buildAnswerText as telegram } from "../telegram/ask-message";
import { buildAnswerText as slack } from "../slack/ask-command";
import { buildAnswerMessage as discord } from "../discord/ask-interaction";
import { researchReportMarkdown } from "../research-report-export";
import { presentationRun } from "./presentation.test-fixture";
import { finalizeAnswerLanguage, recordedAnswerLanguage } from "./answer-language-provenance";
import { recordedReportPresentation } from "./result-presentation";
import { livePresentationLocale } from "./presentation-language";
import { botResearchMessages } from "../bots/research-messages";
import { config } from "../config";
import { finalizeGroundedAnswer } from "../agent/answer-grounding";
import { buildEvidenceLedger } from "../agent/evidence-ledger";

// Fixed synthetic originals: no producer198 rerun, provider or channel requests.
// JSON/HTML/Markdown encodings differ; byte authority is the untouched evidence field.
it.each(["en", "vi", "pt", "es"] as const)("keeps %s recorded answer/scaffolding agreement and exact originals across owned consumers", language => {
  const run = presentationRun("An English question does not prove answer language.");
  run.evidence![0].quote = "Exact “quote” <unmodified> & 日本語.\r\nLine two [S9].";
  const beforeEvidence = Buffer.from(run.evidence![0].quote, "utf8");
  const ledger = buildEvidenceLedger({ subClaims: [run.evidence![0].claim],
    gathered: [{ marker: "S1", sourceId: "source-original", sourceName: "Original source", sourceKind: "public-reference",
      text: run.evidence![0].quote }], answer: "Draft [S1]", declaredMarkers: ["S1"],
    proposedEvidence: [{ claimIndex: 0, marker: "S1", quote: run.evidence![0].quote,
      quoteSpan: { start: 0, end: run.evidence![0].quote.length }, support: 0.8 }] });
  expect(ledger.acceptedMarkers.has("S1")).toBe(true);
  expect(Buffer.from(ledger.evidence[0].quote, "utf8")).toEqual(beforeEvidence);
  run.answer = finalizeGroundedAnswer({ question: run.question, answer: "Draft [S1]", ledger, presentation: { language } });
  const beforeMeta = keryxMeta(run);
  const packet = finalizeAnswerLanguage({ answer: run.answer, rendererLanguage: language, statements: [], proposals: [] });
  run.trace.push({ phase: "done", ts: 0, message: "Done", detail: { answerLanguage: packet } });
  expect(recordedAnswerLanguage(run)).toBe(language);
  expect(livePresentationLocale({ recordedAnswerLanguage: recordedAnswerLanguage(run), originalQuestion: run.question }).agreement).toBe("MATCHED");
  const message = botResearchMessages(run.question, language);
  expect(telegram(run)).toContain(message("fullTrace", { url: `${config.baseUrl}/dispatch/${run.id}` }));
  expect(slack(run)).toContain(message("fullTrace", { url: `${config.baseUrl}/dispatch/${run.id}` }));
  expect(discord(run).embeds[0].footer.text).toContain(message("sourcesOne", { count: 1 }));
  expect(buildAnswerContent(run)).toContain(run.answer);
  expect(researchReportMarkdown(run, null, [])).toContain(recordedReportPresentation(language).labels.title);
  expect(keryxMeta(run)).toEqual(beforeMeta);
  expect(Buffer.from(run.evidence![0].quote, "utf8")).toEqual(beforeEvidence);
});
