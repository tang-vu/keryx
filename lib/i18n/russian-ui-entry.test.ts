import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { extractNamespaceCopy, validateNamespaceDraft } from "../../scripts/check-ui-copy.mjs";
import { normalizeUiLocale, negotiateUiLocale, preparedLocales, shippedUiLocales, localeDirection } from "./locales";
import { englishMessages, createMessages } from "./messages";
import { emptyUiPreview, previewText } from "./ui-preview";
import { getUiPreview, loadUiPreview } from "./ui-preview-catalogues";
import { validateNamespacePreview } from "./ui-shell-catalogue";

const namespaces = {
  "core-inline": 16, "get-started": 103, "pdf-reading": 5, "product-guide": 95,
  reports: 140, "shared-helpers": 4, "literature-search": 8, "research-flow": 39, shell: 17, "source-directory": 112, "ui-preference": 12,
} as const;
const read = (file: string) => readFileSync(file, "utf8");
const glossary = JSON.parse(read("locales/glossary/en.json"));
const draft = (namespace: string) => JSON.parse(read(`locales/ru/ui-drafts/${namespace}.json`));
const source = (namespace: string) => {
  const sourcePath = namespace === "core-inline" ? "lib/i18n/messages.ts" : `locales/en/${namespace}.ts`;
  return { namespace, ...extractNamespaceCopy(sourcePath, read(sourcePath)) };
};

it("keeps Russian preview admission separate from shipped language and script identity", () => {
  expect(preparedLocales).toContain("ru");
  expect(shippedUiLocales).toEqual(["en"]);
  expect(negotiateUiLocale({ explicit: "ru", stored: "ru-RU", acceptLanguage: "ru" })).toEqual({ locale: "en", source: "default" });
  expect(negotiateUiLocale({ explicit: "ru-Cyrl-RU" }, preparedLocales)).toEqual({ locale: "ru", source: "explicit" });
  expect(negotiateUiLocale({ acceptLanguage: "ru;q=0,ru-RU;q=1,fr;q=0.8" }, preparedLocales)).toEqual({ locale: "fr", source: "header" });
  for (const value of ["ru-Latn", "ru-Arab", "uk", "be", "ru_RU", " ru", { language: "ru" }]) expect(normalizeUiLocale(value)).toBeNull();
  expect(localeDirection("ru")).toBe("ltr");
});

it.each(Object.entries(namespaces))("binds every Russian %s draft leaf to its current English source (%s authored keys)", (namespace, count) => {
  const value = draft(namespace), binding = source(namespace);
  expect(value.status).toBe("machineDraft");
  expect(value.review).toBeNull();
  expect(validateNamespaceDraft(value, binding, glossary).coveredKeys).toHaveLength(count);
  const selected = validateNamespacePreview(value, binding, Object.keys(value.entries));
  for (const [key, text] of Object.entries(selected)) expect(text).toBe(value.entries[key].text);
});

it("loads Russian alone and preserves financial English, original text and namespace boundaries", async () => {
  expect(getUiPreview("ru")).toBe(emptyUiPreview);
  expect(getUiPreview("fr")).toBe(emptyUiPreview);
  const preview = await loadUiPreview("ru");
  expect(await loadUiPreview("ru")).toBe(preview);
  expect(getUiPreview("fr")).toBe(emptyUiPreview);
  expect(previewText(preview, englishMessages["researchEntry.question"], ["core-inline"])).toBe(draft("core-inline").entries["researchEntry.question"].text);
  const critical = ["product.heroBody", "product.faqPublicBody", "pricing.browserBody", "pricing.service", "pricing.reserve",
    "pricing.prepaidTerms", "about.projectLegalNotice", "about.projectLegalLink", "about.contactBody"];
  for (const key of critical) {
    const original = draft("product-guide").entries[key].source;
    expect(previewText(preview, original, ["product-guide"])).toBe(original);
  }
  for (const key of ["account.signatureInstruction", "researchEntry.sessionNotice", "privateProfile.privacyBoundary"] as const)
    expect(previewText(preview, englishMessages[key])).toBe(englishMessages[key]);
  const original = "What do you want to know? Original source <literal> {count} USDC 日本語";
  expect(previewText(preview, original)).toBe(original);
  expect(previewText(preview, englishMessages["researchEntry.question"], ["reports"])).toBe(englishMessages["researchEntry.question"]);
});

it("uses neutral Russian UI counters and interpolates original values once", async () => {
  const preview = await loadUiPreview("ru"), messages = createMessages("ru", preview.$messages);
  const copy = draft("source-directory").entries;
  expect(copy["sourceLibrary.documentsMatched.one"].text).toBe(copy["sourceLibrary.documentsMatched.other"].text);
  for (const count of [0, 1, 2, 4, 5, 11, 21, 22, 25])
    expect(messages("sourceLibrary.documentsMatched.other", { count })).toBe(copy["sourceLibrary.documentsMatched.other"].text.replace("{count}", String(count)));
  const values = { database: "Find a source", domain: "Original <topic> {database} USDC" }, before = JSON.stringify(values);
  const rendered = messages("sourceFilter.placeholder", values);
  expect(rendered).toContain(values.database);
  expect(rendered).toContain(values.domain);
  expect(rendered).not.toContain(copy["sourceFilter.title"].text);
  expect(JSON.stringify(values)).toBe(before);
});
