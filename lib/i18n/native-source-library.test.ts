// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { CitedSourceCard } from "@/components/keryx/cited-source-card";
import { PublicReferenceCard } from "@/components/keryx/public-reference-card";
import { SourceLibraryFilters } from "@/components/keryx/source-library-filters";
import { parseLibraryFilters } from "../sources/library-browse";
import { extractNamespaceCopy, validateNamespaceDraft } from "../../scripts/check-ui-copy.mjs";
import { UiCopyContext, englishUiCopy } from "./ui-copy-context";
import { createMessages, englishMessages } from "./messages";
import { createRichMessages } from "./rich-messages";
import { loadUiPreview } from "./ui-preview-catalogues";
import type { CitedSourceHistoryEntry } from "../sources/cited-source-history";
import type { PublicReference } from "../public-references/catalog";

const locales = ["es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id"] as const;
const cited: CitedSourceHistoryEntry = { url: "https://original.test/日本語?x={count}", title: "Metadata only", publisher: "Original publisher", runId: "original/run?x=1", citedAt: "", truncated: true };
const feed: PublicReference = { id: "original-feed", name: "Clear filters", url: "https://original.test/feed", rssUrl: "https://original.test/rss", active: true, description: "Original description {count}", tags: ["Topics"],
  items: (["full_text", "excerpt", "abstract", "metadata_only"] as const).map((deliveryKind, i) => ({ id: `original-${i}`, title: `Original item ${i}`, summary: "Original summary", content: "Original content", link: `https://original.test/${i}`, deliveryKind })) };
function node(html: string) { const element = document.createElement("div"); element.innerHTML = html; return element; }
async function prepared(locale: typeof locales[number]) {
  const preview = await loadUiPreview(locale), message = createMessages(locale, preview.$messages);
  const context = { ...englishUiCopy, locale, preview, message, richMessage: createRichMessages(locale, preview.$messages) };
  return { message, render: (child: React.ReactElement) => node(renderToStaticMarkup(React.createElement(UiCopyContext.Provider, { value: context }, child))) };
}

it.each(locales)("%s binds112 ordinary source-library leaves without admitting source-control/payment notices", async locale => {
  const path = "locales/en/source-directory.ts", binding = extractNamespaceCopy(path, readFileSync(path, "utf8"));
  const draft = JSON.parse(readFileSync(`locales/${locale}/ui-drafts/source-directory.json`, "utf8"));
  expect(draft.status).toBe("machineDraft"); expect(draft.review).toBeNull(); expect(Object.keys(draft.entries)).toHaveLength(112);
  const valid = validateNamespaceDraft(draft, binding, JSON.parse(readFileSync("locales/glossary/en.json", "utf8"))), preview = await loadUiPreview(locale);
  for (const [key, entry] of Object.entries(draft.entries) as [keyof typeof englishMessages, { source: string; text: string }][]) {
    expect(valid.coveredKeys).toContain(key); expect(entry.source).toBe(englishMessages[key]); expect(preview.$messages[key]).toBe(entry.text);
  }
  for (const key of ["sourceFeed.paymentNotice", "sourceFeed.claim", "sourceExplore.draftNotice", "sourcePreview.control", "sourceFilter.notice", "sourceLibrary.intro", "sourceLibrary.claim", "sourceLibrary.registered.one", "sourceRegistry.toll"] as const)
    expect(preview.$messages[key]).toBeUndefined();
});

it.each(locales)("%s preserves exact cited metadata and every recorded reading-scope distinction", async locale => {
  const ui = await prepared(locale), before = JSON.stringify(cited);
  for (const deliveryKind of ["full_text", "excerpt", "abstract", "metadata_only", undefined] as const) for (const truncated of [false, true]) {
    const output = ui.render(React.createElement(CitedSourceCard, { entry: { ...cited, deliveryKind, truncated } }));
    const key = `sourceCited.${truncated ? "scopeBounded" : "scope"}.${deliveryKind ?? "unrecorded"}` as keyof typeof englishMessages;
    expect(output.querySelector("article > p.border-l-2")?.textContent).toBe(ui.message(key));
    expect(output.querySelector(`article > p.border-l-2 [lang="${locale}"]`)).not.toBeNull();
    expect(output.querySelector("h3 a")?.textContent).toBe(cited.title); expect(output.querySelector("h3 a")?.getAttribute("href")).toBe(cited.url);
    expect(output.querySelector('a[href^="/dispatch/"]')?.getAttribute("href")).toBe("/dispatch/original%2Frun%3Fx%3D1");
    expect(output.textContent).toContain(ui.message("sourceCited.readUnavailable")); expect(output.textContent).toContain(ui.message("sourceCited.citationUnavailable"));
  }
  expect(JSON.stringify(cited)).toBe(before);
});

it.each(locales)("%s translates authored feed labels while retaining original names/tags/URLs and critical notices", async locale => {
  const ui = await prepared(locale), before = JSON.stringify(feed), output = ui.render(React.createElement(PublicReferenceCard, { reference: feed }));
  expect(output.querySelector("h3 a")?.textContent).toContain(feed.name); expect(output.querySelector("h3 a")?.textContent).not.toContain(ui.message("sourceFilter.clear"));
  expect(output.querySelector('ul[aria-label]')?.getAttribute("aria-label")).toBe(ui.message("sourceFeed.topics")); expect(output.querySelector('ul[aria-label] li')?.textContent).toBe("Topics");
  for (const key of ["sourceFeed.fullText", "sourceFeed.excerpt", "sourceFeed.abstract", "sourceFeed.metadata", "sourceFeed.collectedUnavailable"] as const) expect(output.textContent).toContain(ui.message(key));
  expect(output.querySelector('[lang="en"]')?.textContent).toBe(englishMessages["sourceFeed.dateUnavailable"]);
  expect(output.textContent).toContain(englishMessages["sourceFeed.paymentNotice"]); expect(JSON.stringify(feed)).toBe(before);
});

it.each(locales)("%s formats translated input templates before interpolation without changing GET values or validation", async locale => {
  const ui = await prepared(locale), filters = parseLibraryFilters({ q: "Clear filters {count} 日本語", author: "Original author", doi: "10.1234/original", year: "2024", kind: "paper" });
  const before = JSON.stringify(filters), output = ui.render(React.createElement(SourceLibraryFilters, { filters, total: 8, matched: 2, publishers: 1 }));
  expect(output.querySelector("form")?.getAttribute("action")).toBe("/sources#browse-sources");
  expect(output.querySelector('input[name="q"]')?.getAttribute("value")).toBe(filters.q);
  expect(output.querySelector('input[name="q"]')?.getAttribute("placeholder")).toBe(ui.message("sourceFilter.placeholder", { database: "PostgreSQL", domain: "circle.com" }));
  expect(output.querySelector('input[name="author"]')?.getAttribute("placeholder")).toBe(ui.message("sourceFilter.authorPlaceholder"));
  expect(output.querySelector('input[name="doi"]')?.getAttribute("placeholder")).toBe(ui.message("sourceFilter.doiPlaceholder", { identifier: "10.…", url: "https://doi.org/…" }));
  expect(output.querySelector('input[name="year"]')?.getAttribute("pattern")).toBe("[0-9]{4}");
  expect(output.querySelector('input[name="q"]')?.getAttribute("maxlength")).toBe("120"); expect(output.querySelector('input[name="doi"]')?.getAttribute("maxlength")).toBe("200");
  expect(output.querySelector('nav[aria-label]')?.getAttribute("aria-label")).toBe(ui.message("sourceFilter.topicsLabel")); expect(JSON.stringify(filters)).toBe(before);
  expect(output.querySelector('option[value="paper"]')?.textContent).toBe(ui.message("sourceLibrary.papers"));
});
