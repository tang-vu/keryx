/** Retained one-shot model output, replayed without network, payment or database access. */
import { createHash } from "node:crypto";
import frozenSource from "../../llm/fixtures/issue-238-mdn-button.json";
import captured from "../../llm/fixtures/mdn-grounded-model-20261008.json";
import { gatheredArticle } from "../../web-research/article-reader";
import type { GatheredContent } from "../../llm/reasoning-engine";
import { buildEvidenceLedger } from "../evidence-ledger";
import { selectCitedStatements } from "../cited-statements";
import { finalizeGroundedAnswer } from "../answer-grounding";
import { answerPresentation } from "../../research/answer-presentation";

// Preserve the captured trial's exact text/question/claim projection and digest
// while sharing the original frozen source corpus and its provenance.
const corpus = { text: frozenSource.text, question: frozenSource.question, claims: frozenSource.subClaims };

export function mdnModelReplay() {
  if (createHash("sha256").update(JSON.stringify(corpus)).digest("hex") !== "6a0e513d1c3cb995c4c228305e0b8f5bfb152a117292b8017f2017905a181c85" ||
      createHash("sha256").update(corpus.text).digest("hex") !== captured.sourceSha ||
      captured.evidenceReview !== "completed" || captured.originalNumberOfBullets !== 0) throw new Error("Retained MDN trial binding changed");
  const source = { ...gatheredArticle(captured.publicSource.sourceId, { text: corpus.text,
    finalUrl: captured.publicSource.itemUrl, title: captured.publicSource.itemTitle, kind: "html", truncated: false }),
    ...captured.publicSource } as GatheredContent;
  const ledger = buildEvidenceLedger({ question: corpus.question, subClaims: corpus.claims, gathered: [source],
    answer: captured.draft, declaredMarkers: [source.marker], proposedEvidence: captured.evidence,
    finalAssessment: captured.assessment });
  const statements = selectCitedStatements(captured.evidence, ledger);
  const answer = finalizeGroundedAnswer({ question: corpus.question, answer: captured.draft,
    ledger, statements, presentation: answerPresentation(corpus.question) });
  return { question: corpus.question, draft: captured.draft, ledger, statements, answer,
    sentences: statements.map(statement => statement.text), quotes: [...new Set(statements.map(statement => statement.quote))] };
}
