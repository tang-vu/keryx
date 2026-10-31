// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { LiteratureComparisonPreview } from "@/components/keryx/literature-comparison-preview";
import { extractNamespaceCopy, validateNamespaceDraft } from "../../scripts/check-ui-copy.mjs";
import { UiCopyContext, englishUiCopy } from "./ui-copy-context";
import { createMessages, englishMessages } from "./messages";
import { createRichMessages } from "./rich-messages";
import { loadUiPreview } from "./ui-preview-catalogues";
import { shippedUiLocales } from "./locales";
import { PAPER_CATALOG } from "../papers/catalog";
import { PAPER_REPOSITORIES, paperRecordSchema } from "../papers/types";
import { SCREENING_STATES } from "../papers/literature-workspace";

const locales = ["es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id", "ru", "ar"] as const;
const keys = ["label", "title", "outsideFilter", "remove", "focus", "noFocus", "reviewQuestion", "preparedQuestion", "paper", "removeLabel"].map(key => `literatureComparison.${key}`);
const read = (path: string) => readFileSync(path, "utf8");
const binding = extractNamespaceCopy("locales/en/reports.ts", read("locales/en/reports.ts"));
const glossary = JSON.parse(read("locales/glossary/en.json"));
// The seed catalogue has no Crossref record; this is an explicitly synthetic official-host fixture.
const crossref = paperRecordSchema.parse({ title: "Synthetic Crossref comparison fixture", authors: ["Synthetic author"],
  authorCount: 1, authorsTruncated: false, repository: "crossref", doi: "10.5555/keryx-comparison-fixture",
  url: "https://doi.org/10.5555/keryx-comparison-fixture", metadataUrl: "https://api.crossref.org/works/10.5555%2Fkeryx-comparison-fixture",
  metadataObservedAt: "2026-11-01T00:00:00Z", publicationKind: "unknown", peerReview: "unknown" });

it.each(locales)("%s admits exactly ten source-bound comparison additions while preserving draft status and placeholders", async locale => {
  const draft = JSON.parse(read(`locales/${locale}/ui-drafts/reports.json`));
  expect(draft.status).toBe("machineDraft"); expect(draft.review).toBeNull();
  expect(Object.keys(draft.entries)).toHaveLength(140);
  expect(validateNamespaceDraft(draft, binding, glossary).coveredKeys).toHaveLength(140);
  const preview = await loadUiPreview(locale);
  for (const key of keys) {
    const entry = draft.entries[key];
    expect(entry.source).toBe(binding.entries[key]); expect(entry.text).not.toBe(entry.source);
    expect(entry.text).not.toMatch(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/u);
    expect([...entry.text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)].map(match => match[1]).sort())
      .toEqual([...entry.source.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)].map(match => match[1]).sort());
    expect(preview.reports[entry.source]).toBe(entry.text);
    expect(preview.$messages[key]).toBe(entry.text);
  }
  expect(Object.keys(draft.entries).filter(key => Object.hasOwn(preview.$messages, key))).toHaveLength(139);
  expect(shippedUiLocales).toEqual(["en"]);
});

it.each(locales)("%s renders every screening/repository combination with literal original data, safe rich nodes and exact remove callbacks", async locale => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const preview = await loadUiPreview(locale), message = createMessages(locale, preview.$messages);
  const ui = { ...englishUiCopy, locale, preview, message, richMessage: createRichMessages(locale, preview.$messages) };
  const container = document.createElement("div"); container.lang = locale; container.dir = locale === "ar" ? "rtl" : "ltr";
  document.body.append(container); const root = createRoot(container), remove = vi.fn();
  const originalTitle = englishMessages["literatureComparison.remove"];
  const focus = "Original العربية 日本語 <script>literal</script> {number}";
  const draft = "Original prepared question\n{screening} <source> العربية 日本語";
  try {
    for (const screening of Object.keys(SCREENING_STATES) as Array<keyof typeof SCREENING_STATES>) {
      for (const repository of Object.keys(PAPER_REPOSITORIES) as Array<keyof typeof PAPER_REPOSITORIES>) {
        const original = repository === "crossref" ? crossref : PAPER_CATALOG.find(paper => paper.repository === repository);
        expect(original, `Valid repository fixture required for ${repository}`).toBeDefined();
        const paper = { ...original!, title: originalTitle };
        await act(async () => root.render(React.createElement(UiCopyContext.Provider, { value: ui },
          React.createElement(LiteratureComparisonPreview, { entries: [{ paper, screening, matchesSearch: false }], filter: "all",
            savedQuestion: focus, draft, onRemove: remove }))));
        const metadata = container.querySelector("ol li p")!;
        expect(metadata.textContent).toBe(message("literatureComparison.paper", { number: 1,
          screening: message(`paperWorkspace.screening.${screening}`), repository: PAPER_REPOSITORIES[repository] }));
        expect(metadata.firstElementChild?.getAttribute("lang")).toBe(locale);
        if (locale === "ar") expect(metadata.firstElementChild?.getAttribute("dir")).toBe("rtl");
        const identity = metadata.querySelector("bdi")!;
        expect(identity.textContent).toBe(PAPER_REPOSITORIES[repository]);
        expect(identity.getAttribute("lang")).toBe("en"); expect(identity.getAttribute("dir")).toBe("ltr");
        expect(identity.getAttribute("translate")).toBe("no");
        const source = container.querySelector("ol li a")!;
        expect(source.textContent).toBe(originalTitle); expect(source.getAttribute("href")).toBe(paper.url);
        expect(source.getAttribute("dir")).toBe("auto"); expect(source.querySelector("[lang]")).toBeNull();
        const url = [...container.querySelectorAll("ol li p")].find(node => node.textContent === paper.url)!;
        expect(url.getAttribute("dir")).toBe("ltr"); expect(url.getAttribute("translate")).toBe("no");
        if (paper.arxivId) {
          const identifier = [...container.querySelectorAll("p")].find(node => node.textContent === `arXiv ${paper.arxivId}`)!;
          expect(identifier.getAttribute("lang")).toBe("en"); expect(identifier.getAttribute("dir")).toBe("ltr");
        }
        expect(container.querySelector("pre")!.textContent).toBe(draft);
        expect(container.querySelector("pre")!.getAttribute("dir")).toBe("auto");
        expect([...container.querySelectorAll("p")].find(node => node.textContent === focus)?.getAttribute("dir")).toBe("auto");
        expect(container.querySelector("script,source")).toBeNull();
        const button = container.querySelector("button")!;
        expect(document.getElementById(button.getAttribute("aria-labelledby")!)!.textContent).toBe(message("literatureComparison.removeLabel", { number: 1 }));
        expect(document.getElementById(button.getAttribute("aria-describedby")!)!.textContent).toContain(paper.url);
        remove.mockClear(); await act(async () => button.click()); expect(remove).toHaveBeenCalledExactlyOnceWith(paper.url);
      }
    }
    await act(async () => root.render(React.createElement(UiCopyContext.Provider, { value: ui },
      React.createElement(LiteratureComparisonPreview, { entries: [{ paper: PAPER_CATALOG[0], screening: "include" }], filter: "all",
        savedQuestion: "", draft: "", onRemove: remove }))));
    expect(container.textContent).toContain(message("literatureComparison.noFocus")); expect(container.querySelector("details")).toBeNull();
    await act(async () => root.render(React.createElement(LiteratureComparisonPreview, { entries: [], filter: "all", savedQuestion: focus, draft, onRemove: remove })));
    expect(container.textContent).toBe("");
  } finally { await act(async () => root.unmount()); container.remove(); }
});
