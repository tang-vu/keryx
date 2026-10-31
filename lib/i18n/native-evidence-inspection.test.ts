// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { SourceEvidenceLens, SourceEvidenceLensView } from "@/components/keryx/source-evidence-lens";
import { ResearchCitationExport } from "@/components/keryx/research-citation-export";
import { buildSourceEvidenceLens } from "../research/source-evidence-lens";
import type { EvidenceMatrixInput } from "../research/evidence-matrix";
import { extractNamespaceCopy, validateNamespaceDraft } from "../../scripts/check-ui-copy.mjs";
import { UiCopyContext, englishUiCopy } from "./ui-copy-context";
import { createMessages, englishMessages } from "./messages";
import { createRichMessages } from "./rich-messages";
import { loadUiPreview } from "./ui-preview-catalogues";

const locales = ["es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id", "ru", "ar"] as const;
const keys = ["citationExport.title", "citationExport.bibtex", "citationExport.cslJson", "citationExport.ris", "citationExport.references.one",
  "citationExport.omitted.one", "citationExport.references.other", "citationExport.omitted.other", "bibliographyExport.label", "bibliographyExport.provenance",
  "bibliographyExport.bibtex", "bibliographyExport.cslJson", "bibliographyExport.ris", "reportSourceLens.unavailable", "reportSourceLens.empty",
  "reportSourceLens.title", "reportSourceLens.localView", "reportSourceLens.originalExcerpts", "reportSourceLens.viewExcerpts", "reportSourceLens.intro",
  "reportSourceLens.select", "reportSourceLens.keepAll", "reportSourceLens.restore", "reportSourceLens.original", "reportSourceLens.missing", "reportSourceLens.lost",
  "reportSourceLens.inspect", "reportSourceLens.remaining.one", "reportSourceLens.remaining.other", "reportSourceLens.omitted.one", "reportSourceLens.omitted.other",
  "reportSourceLens.alreadyMissing.one", "reportSourceLens.alreadyMissing.other", "reportSourceLens.version", "reportSourceLens.versionTitle"] as const;
const claim = "Original target <literal> {count} 日本語 / हिन्दी";
const citation = { marker: "A1", sourceId: "original-record-alpha", sourceName: "Restore source", itemId: "original-item",
  itemTitle: "Original title {count}", itemUrl: "https://publisher.test/original", contentVersion: "original-version-v7", weight: 1, reward: 0, rationale: "Original rationale" };
const quote = "Original excerpt <literal> {source}.  \n\n";
const run: EvidenceMatrixInput = { subClaims: [claim], citations: [citation], evidence: [
  { ...citation, claimIndex: 0, claim, quote, support: 0.8, qualifiesForAnswer: true, qualifiesForReward: false },
] };
function node(html: string) { const element = document.createElement("div"); element.innerHTML = html; return element; }
async function prepared(locale: typeof locales[number]) {
  const preview = await loadUiPreview(locale), message = createMessages(locale, preview.$messages);
  const context = { ...englishUiCopy, locale, preview, message, richMessage: createRichMessages(locale, preview.$messages) };
  return { message, render: (child: React.ReactElement) => node(renderToStaticMarkup(React.createElement(UiCopyContext.Provider, { value: context }, child))) };
}

it.each(locales)("%s binds all35 ordinary inspection/reference leaves while keeping critical qualification and failures English", async locale => {
  const path = "locales/en/reports.ts", binding = extractNamespaceCopy(path, readFileSync(path, "utf8"));
  const draft = JSON.parse(readFileSync(`locales/${locale}/ui-drafts/reports.json`, "utf8"));
  expect(draft.status).toBe("machineDraft"); expect(draft.review).toBeNull(); expect(Object.keys(draft.entries)).toHaveLength(140);
  const valid = validateNamespaceDraft(draft, binding, JSON.parse(readFileSync("locales/glossary/en.json", "utf8")));
  const preview = await loadUiPreview(locale);
  for (const key of keys) {
    expect(valid.coveredKeys).toContain(key); expect(draft.entries[key].source).toBe(englishMessages[key]);
    expect(preview.$messages[key]).toBe(draft.entries[key].text);
  }
  for (const key of ["citationExport.failed", "bibliographyExport.failed", "bibliographyExport.notice", "reportSourceLens.qualification"] as const)
    expect(preview.$messages[key]).toBeUndefined();
  const message = createMessages(locale, preview.$messages);
  for (const count of [1, 2]) {
    const text = message(count === 1 ? "reportSourceLens.remaining.one" : "reportSourceLens.remaining.other", { count });
    expect(text).toContain(String(count)); expect(text).not.toContain("{count}");
  }
});

it.each(locales)("%s attributes actual inspection labels and English qualifications without translating original content", async locale => {
  const ui = await prepared(locale), original = JSON.stringify(run), output = ui.render(React.createElement(SourceEvidenceLens, { run }));
  expect(output.querySelector("summary")?.textContent).toBe(ui.message("reportSourceLens.title"));
  expect(output.querySelector(`summary [lang="${locale}"]`)).not.toBeNull();
  expect(output.querySelector('[lang="en"]')?.textContent).toBe(englishMessages["reportSourceLens.qualification"]);
  expect(output.querySelector("h3")?.textContent).toBe(claim); expect(output.querySelector("h3")?.getAttribute("lang")).toBe("und");
  expect(output.querySelector("blockquote p")?.textContent).toBe(`“${quote}”`); expect(output.querySelector("blockquote p")?.getAttribute("lang")).toBe("und");
  expect(output.querySelector('option[value="original-record-alpha"]')?.textContent).toBe(citation.sourceName);
  expect(output.textContent).toContain(citation.itemTitle); expect(output.textContent).toContain(citation.contentVersion);
  expect(output.querySelector("blockquote")?.textContent).toContain(citation.sourceName);
  expect(output.querySelector("blockquote")?.textContent).not.toContain(ui.message("reportSourceLens.restore"));
  expect(output.querySelector("script")).toBeNull(); expect(JSON.stringify(run)).toBe(original);
});

it.each(locales)("%s renders the real reference controls in the prepared interface while keeping reference identity and omission counts", async locale => {
  const ui = await prepared(locale), citations = [citation, { ...citation, marker: "A2", itemUrl: undefined }], original = JSON.stringify(citations);
  const output = ui.render(React.createElement(ResearchCitationExport, { citations }));
  expect(output.querySelectorAll(`button [lang="${locale}"]`)).toHaveLength(3);
  for (const key of ["citationExport.bibtex", "citationExport.cslJson", "citationExport.ris"] as const) expect(output.textContent).toContain(ui.message(key));
  expect(output.textContent).toContain(ui.message("citationExport.references.one", { count: 1 }));
  expect(output.textContent).toContain(ui.message("citationExport.omitted.one", { count: 1 }));
  expect(JSON.stringify(citations)).toBe(original);
});

it("retains the explicit custom-message contract and direct hook-free invocation of the pure lens view", () => {
  const messages = createMessages("fr", { "reportSourceLens.title": "Explicit supplied inspection label" });
  const tree = SourceEvidenceLensView({ model: buildSourceEvidenceLens(run), selectId: "explicit", onOmit() {}, messages });
  const output = node(renderToStaticMarkup(tree)); expect(output.querySelector("summary")?.textContent).toBe("Explicit supplied inspection label");
  expect(output.querySelector("blockquote p")?.textContent).toBe(`“${quote}”`);
});
