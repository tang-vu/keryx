// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PdfReadingScope } from "@/components/keryx/pdf-reading-scope";
import { ReportComparisonLink } from "@/components/keryx/report-comparison-link";
import { LiteratureComparisonPreview } from "@/components/keryx/literature-comparison-preview";
import { AnswerEvidenceStatus } from "@/components/keryx/answer-evidence-status";
import { UiCopyContext, englishUiCopy } from "./ui-copy-context";
import { preparedLocales } from "./locales";
import { createMessages, englishMessages } from "./messages";
import { createRichMessages } from "./rich-messages";
import { loadUiPreview } from "./ui-preview-catalogues";
import { previewCopy, previewText } from "./ui-preview";
import { pdfReadingCopy } from "@/locales/en/pdf-reading";
import { reportComparisonCopy } from "@/locales/en/report-comparison";
import { pdfReadingNotice } from "../research/pdf-reading";
import type { PaperRecord } from "../papers/types";
import { PAPER_REPOSITORIES } from "../papers/types";
import { evidenceFollowUpContext, evidenceFollowUpHref } from "../research/answer-evidence-status";

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => React.createElement("a", props, children) }));
const h = React.createElement;
const scope = { format: "keryx-pdf-text-scope-v1" as const, pagesRead: 3, totalPages: 5, pagesWithoutText: [2], textLimitReached: false };
const paper: PaperRecord = { title: englishMessages["researchEntry.question"], authors: ["Original author"], authorCount: 1,
  authorsTruncated: false, repository: "arxiv", arxivId: "2601.00001v1", url: "https://arxiv.org/abs/2601.00001v1",
  metadataUrl: "https://arxiv.org/abs/2601.00001v1", metadataObservedAt: "2026-10-16T00:00:00Z", publicationKind: "preprint", peerReview: "unknown" };
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div"); container.lang = "en"; document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const language = (element: Element) => element.closest("[lang]")?.getAttribute("lang");

for (const locale of preparedLocales) it(`${locale} exposes actual report-label languages and preserves exact evidence and callbacks`, async () => {
  const preview = await loadUiPreview(locale), message = createMessages(locale, preview.$messages);
  const remove = vi.fn(), originalFocus = englishMessages["researchEntry.question"], originalDraft = "Exact original <source> {count} USDC\n中文 / Tiếng Việt";
  const evidence = { id: "11111111-1111-4111-8111-111111111111", question: originalFocus,
    subClaims: [englishMessages["reportEvidence.title"]], citations: [], evidence: [] };
  const ui = { ...englishUiCopy, locale, preview, message, richMessage: createRichMessages(locale, preview.$messages) };
  await act(async () => root.render(h(UiCopyContext.Provider, { value: ui },
    h("div", { id: "pdf" }, h(PdfReadingScope, { provenance: { extraction: "pdf", pdfTextScope: scope } })),
    h("div", { id: "comparison-link" }, h(ReportComparisonLink)),
    h("div", { id: "evidence-status" }, h(AnswerEvidenceStatus, { run: evidence })),
    h(LiteratureComparisonPreview, { entries: [{ paper, screening: "include", matchesSearch: false }], filter: "exclude",
      savedQuestion: originalFocus, draft: originalDraft, onRemove: remove }))));
  const selectedPdf = previewCopy(preview, "pdf-reading", pdfReadingCopy);
  expect(container.querySelector("#pdf")!.textContent).toBe(pdfReadingNotice(scope, false, selectedPdf));
  const pdfParts = [...container.querySelectorAll("#pdf > span > span")];
  expect(pdfParts).toHaveLength(5);
  for (const [index, key] of (["summary", "emptyPages", "limit", "textOnly", "recovery"] as const).entries())
    expect(language(pdfParts[index])).toBe(selectedPdf[key] === pdfReadingCopy[key] ? "en" : locale);
  if (locale !== "en") {
    for (const key of ["summary", "emptyPages", "limit", "textOnly", "recovery"] as const)
      expect(selectedPdf[key]).not.toBe(pdfReadingCopy[key]);
    expect(container.querySelectorAll(`#pdf [lang="${locale}"]`)).toHaveLength(5);
  }
  const link = container.querySelector("#comparison-link a")!;
  const linkText = previewText(preview, reportComparisonCopy.link, ["report-comparison"]);
  expect(link.textContent).toBe(linkText); expect(link.getAttribute("href")).toBe("/research/compare");
  expect(language(link.querySelector("[lang]") ?? link)).toBe(linkText === reportComparisonCopy.link ? "en" : locale);
  const heading = container.querySelector("section.min-w-0 h3")!;
  expect(heading.textContent).toBe(message("literatureComparison.title"));
  expect(language(heading.querySelector("[lang]") ?? heading))
    .toBe(message("literatureComparison.title") === englishMessages["literatureComparison.title"] ? "en" : locale);
  const source = container.querySelector(`a[href="${paper.url}"]`)!;
  expect(source.textContent).toBe(paper.title); expect(source.querySelector("[lang]")).toBeNull();
  expect(container.querySelector("section.min-w-0 ol li p")!.textContent).toBe(message("literatureComparison.paper", {
    number: 1, screening: message("paperWorkspace.screening.include"), repository: PAPER_REPOSITORIES.arxiv,
  }));
  expect(container.querySelector("pre")!.textContent).toBe(originalDraft);
  expect([...container.querySelectorAll("p")].some(node => node.textContent === originalFocus)).toBe(true);
  const button = container.querySelector("button")!;
  const name = document.getElementById(button.getAttribute("aria-labelledby")!)!;
  expect(name.textContent).toBe(message("literatureComparison.removeLabel", { number: 1 }));
  expect(language(name.querySelector("[lang]") ?? name))
    .toBe(name.textContent === createMessages("en")("literatureComparison.removeLabel", { number: 1 }) ? "en" : locale);
  expect(document.getElementById(button.getAttribute("aria-describedby")!)!.textContent).toContain(paper.url);
  for (const [element, key] of [[container.querySelector("section.min-w-0")!, "literatureComparison.label"],
    [container.querySelector("pre")!, "literatureComparison.preparedQuestion"]] as const) {
    const label = document.getElementById(element.getAttribute("aria-labelledby")!)!;
    expect(label.textContent).toBe(message(key));
    expect(language(label.querySelector("[lang]") ?? label)).toBe(message(key) === englishMessages[key] ? "en" : locale);
  }
  await act(async () => button.click()); expect(remove).toHaveBeenCalledExactlyOnceWith(paper.url);
  expect(container.querySelector("source")).toBeNull();
  const status = container.querySelector("#evidence-status")!, statusTitle = status.querySelector("h3")!;
  expect(statusTitle.textContent).toBe(message("reportEvidence.title"));
  if (locale !== "en") expect(statusTitle.textContent).not.toBe(englishMessages["reportEvidence.title"]);
  expect(language(statusTitle.querySelector("[lang]") ?? statusTitle))
    .toBe(message("reportEvidence.title") === englishMessages["reportEvidence.title"] ? "en" : locale);
  expect(status.querySelector("p.break-words")!.textContent).toBe(evidence.subClaims[0]);
  const budget = [...status.querySelectorAll("p")].find(node => node.textContent === englishMessages["reportEvidence.prepareNotice"])!;
  expect(language(budget.querySelector("[lang]") ?? budget)).toBe("en");
  expect(status.querySelector("a")!.getAttribute("href")).toBe(evidenceFollowUpHref(evidence.id,
    message("reportEvidence.draft", evidenceFollowUpContext(evidence.question, evidence.subClaims[0]))));
  const followUp = new URL(status.querySelector("a")!.getAttribute("href")!, "https://ui.test");
  expect(followUp.searchParams.get("q")).toContain(evidence.question);
  expect(followUp.searchParams.get("q")).toContain(evidence.subClaims[0]);
  expect(followUp.searchParams.get("parent")).toBe(evidence.id);
  for (const forbidden of ["run", "budget", "model"]) expect(followUp.searchParams.has(forbidden)).toBe(false);
});

it("does not invent PDF coverage for malformed, missing or non-PDF metadata", async () => {
  for (const provenance of [undefined, { extraction: "html" as const, pdfTextScope: scope }, { extraction: "pdf" as const }, { extraction: "pdf" as const, pdfTextScope: { ...scope, pagesRead: 6 } }]) {
    await act(async () => root.render(h(PdfReadingScope, { provenance })));
    expect(container.textContent).toBe("");
  }
});
