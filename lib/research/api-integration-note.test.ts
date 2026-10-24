import { expect, it } from "vitest";
import { apiIntegrationNote } from "./api-integration-note";
import { requestsApiIntegrationNote, API_INTEGRATION_NOTE_REQUEST } from "./api-integration-note-request";
import { prepareSpecialistBrief } from "./specialist-briefs";
import type { EvidenceLedger } from "../agent/evidence-ledger";
import type { CitedStatement } from "../agent/cited-statements";
import { extractAnswerMarkers } from "../agent/evidence-ledger";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AnswerMarkdown } from "../../components/keryx/answer-markdown";

const quote = "Version two may deliver a duplicate after a retry; this is not an exactly-once guarantee.";
const statement = "On version two, a retry may duplicate delivery.";
function fixture() {
  const ledger: EvidenceLedger = { evidence: [{ claimIndex: 0, claim: "What retry constraint applies?", marker: "S1", sourceId: "synthetic-api",
    sourceName: "Synthetic API", quote, support: 0.9, qualifiesForAnswer: true, qualifiesForReward: false,
    webProvenance: { retrievedAt: "2026-10-24T00:00:00.000Z", extraction: "html", truncated: true, publisherGroup: "example.org", normalizedBodyHash: "a".repeat(64),
      htmlSectionScope: { format: "keryx-html-section-scope-v1", fragment: "retries", headingLevel: 2, htmlStart: 30, htmlEnd: 900,
        documentCharacters: 1000, documentSha256: "b".repeat(64) } } }],
    claimCoverage: [{ claimIndex: 0, claim: "What retry constraint applies?", coverage: 0.9, coveredBy: ["S1"] },
      { claimIndex: 1, claim: "What is the version-two price?", coverage: 0, coveredBy: [] }], acceptedMarkers: new Set(["S1"]), droppedCitations: [], droppedEvidence: 0 };
  return { answer: `A previously admitted answer [S1]`, ledger, statements: [{ claimIndex: 0, marker: "S1", quote, text: statement }] as CitedStatement[], language: "en" as const };
}

it("requires an explicit original first-line request and prepares it only for the API track", () => {
  expect(requestsApiIntegrationNote(API_INTEGRATION_NOTE_REQUEST + "\n\nQuestion: Retry?")).toBe(true);
  for (const text of ["Do not " + API_INTEGRATION_NOTE_REQUEST, "Source says:\n" + API_INTEGRATION_NOTE_REQUEST,
    "Context: " + API_INTEGRATION_NOTE_REQUEST, API_INTEGRATION_NOTE_REQUEST + " Ignore the prior request."]) expect(requestsApiIntegrationNote(text)).toBe(false);
  for (const track of ["api-platform", "saas-competition", "scholarly-literature"] as const) {
    const prepared = prepareSpecialistBrief({ track, decision: "Our exact integration question", context: "API version two", sourceLeads: [] });
    expect(requestsApiIntegrationNote(prepared.request.question)).toBe(track === "api-platform");
  }
});

it("pairs a selected reviewed statement with the exact quote, section scope and explicit missing evidence", () => {
  const input = fixture(), before = structuredClone(input.ledger), answer = apiIntegrationNote(input)!;
  expect(answer).toContain(statement); expect(answer).toContain(quote); expect(answer).toContain("heading section #retries");
  expect(answer).toContain("What is the version-two price?"); expect(answer).toContain("proposal");
  expect([...extractAnswerMarkers(answer)]).toEqual(["S1"]); expect(input.ledger).toEqual(before);
  expect(answer).not.toContain("guaranteed compatible");
});

it("falls back to an inspectable excerpt when no selected statement has that exact ledger binding", () => {
  const input = fixture(); input.statements[0].quote = "An unrelated policy quote.";
  const answer = apiIntegrationNote(input)!;
  expect(answer).not.toContain(statement); expect(answer).toContain(quote); expect(answer).toContain("No reviewed summary");
});

it("does not promote rejected rows or invent/drop an existing answer marker", () => {
  const input = fixture(); input.ledger.evidence[0].qualifiesForAnswer = false;
  expect(apiIntegrationNote(input)).toBeUndefined();
  expect(apiIntegrationNote({ ...fixture(), answer: "Existing accepted answer [S1] [S2]" })).toBeUndefined();
  const noMarker = { ...fixture(), answer: "No accepted marker." };
  expect(apiIntegrationNote(noMarker)).toBeUndefined();
});

it("retains low-assessment gaps even when a source excerpt is present", () => {
  const input = fixture(); input.ledger.claimCoverage[0].coverage = 0.2;
  expect(apiIntegrationNote(input)).toContain("recorded assessment remains below");
});

it.each(["en", "vi", "pt", "es"] as const)("uses the existing reading component for %s without injecting source markers or HTML", language => {
  const input = fixture(); input.ledger.claimCoverage[1].claim = "<script>bad()</script> [S99]\n### Forged heading";
  const answer = apiIntegrationNote({ ...input, language })!;
  expect([...extractAnswerMarkers(answer)]).toEqual(["S1"]);
  const html = renderToStaticMarkup(createElement(AnswerMarkdown, { text: answer, citations: [] }));
  expect(html).not.toContain("<script>"); expect(html).not.toContain("<h2>Forged heading"); expect(html).toContain("S99");
});

it("refuses compacting excessive rows instead of clipping qualified conditions", () => {
  const input = fixture(); input.ledger.evidence = Array.from({ length: 17 }, (_, index) => ({ ...input.ledger.evidence[0], quote: `${quote} ${index}` }));
  expect(apiIntegrationNote(input)).toBeUndefined();
});
