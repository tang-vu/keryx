import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { extractNamespaceCopy, validateNamespaceDraft } from "../../scripts/check-ui-copy.mjs";
import { literatureSearchCopy } from "../../locales/en/literature-search";
import { loadUiPreview } from "./ui-preview-catalogues";
import { previewCopy, previewText } from "./ui-preview";
import { shippedUiLocales } from "./locales";

const locales = ["es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id", "ru", "ar"] as const;
const keys = ["label", "clear", "empty", "outsideSearch", "sortLabel", "sorts.saved", "sorts.title", "sorts.recent"];
const retained = ["guidance", "scope", "sortNotice", "sorts.year"];
const read = (file: string) => readFileSync(file, "utf8");
const binding = { namespace: "literature-search", ...extractNamespaceCopy("locales/en/literature-search.ts", read("locales/en/literature-search.ts")) };
const glossary = JSON.parse(read("locales/glossary/en.json"));
const draft = (locale: string) => JSON.parse(read(`locales/${locale}/ui-drafts/literature-search.json`));

it.each(locales)("%s binds all eight search/sort draft leaves to English without admitting scope or publication copy", async locale => {
  const value = draft(locale), preview = await loadUiPreview(locale);
  expect(value.status).toBe("machineDraft"); expect(value.review).toBeNull();
  expect(Object.keys(value.entries).sort()).toEqual([...keys].sort());
  expect(validateNamespaceDraft(value, binding, glossary).coveredKeys).toHaveLength(8);
  for (const key of keys) {
    const entry = value.entries[key]; expect(entry.source).toBe(binding.entries[key]); expect(entry.text).not.toBe(entry.source);
    expect(entry.text).not.toMatch(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/u);
    expect(previewText(preview, entry.source, ["literature-search"])).toBe(entry.text);
  }
  expect(Object.keys(preview["literature-search"])).toHaveLength(8);
  for (const key of retained) {
    expect(value.entries[key]).toBeUndefined();
    expect(previewText(preview, binding.entries[key], ["literature-search"])).toBe(binding.entries[key]);
  }
  expect(shippedUiLocales).toEqual(["en"]);
});

it.each(locales)("%s maps only authored search copy and keeps original literal data and unrelated namespaces exact", async locale => {
  const preview = await loadUiPreview(locale), value = draft(locale);
  const copy = previewCopy(preview, "literature-search", literatureSearchCopy);
  expect(copy.label).toBe(value.entries.label.text); expect(copy.clear).toBe(value.entries.clear.text);
  expect(copy.sorts).toEqual({ saved: value.entries["sorts.saved"].text, title: value.entries["sorts.title"].text,
    year: literatureSearchCopy.sorts.year, recent: value.entries["sorts.recent"].text });
  expect(copy.guidance).toBe(literatureSearchCopy.guidance); expect(copy.scope).toBe(literatureSearchCopy.scope);
  expect(copy.sortNotice).toBe(literatureSearchCopy.sortNotice);
  const original = "Title العربية 日本語 <script>literal</script> {count}";
  expect(previewText(preview, original, ["literature-search"])).toBe(original);
  expect(previewText(preview, literatureSearchCopy.clear, ["reports"])).toBe(literatureSearchCopy.clear);
  expect(literatureSearchCopy.label).toBe(binding.entries.label);
});
