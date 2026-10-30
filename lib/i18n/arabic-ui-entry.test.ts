import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { extractNamespaceCopy, validateNamespaceDraft } from "../../scripts/check-ui-copy.mjs";
import { normalizeUiLocale, negotiateUiLocale, preparedLocales, shippedUiLocales, localeDirection } from "./locales";
import { englishMessages, createMessages } from "./messages";
import { emptyUiPreview, previewText } from "./ui-preview";
import { getUiPreview, loadUiPreview } from "./ui-preview-catalogues";

const namespaces = { "core-inline": 16, "get-started": 76, "pdf-reading": 5, "product-guide": 95,
  reports: 55, "research-flow": 39, shell: 17, "source-directory": 112, "ui-preference": 12 };
const read = (path: string) => readFileSync(path, "utf8");
const glossary = JSON.parse(read("locales/glossary/en.json"));
const draft = (namespace: string) => JSON.parse(read(`locales/ar/ui-drafts/${namespace}.json`));

it("admits only the Arabic preview and compatible script while keeping the shipped default English", () => {
  expect(shippedUiLocales).toEqual(["en"]);
  expect(preparedLocales).toContain("ar");
  for (const code of ["ar", "ar-SA", "ar-EG", "ar-Arab", "ar-Arab-MA"]) expect(normalizeUiLocale(code)).toBe("ar");
  for (const value of ["ar-Latn", "ar-Cyrl", "fa", "fa-Arab", "ur", "ar_SA", " ar", "constructor", { language: "ar" }]) expect(normalizeUiLocale(value)).toBeNull();
  expect(negotiateUiLocale({ explicit: "ar", stored: "ar-SA", acceptLanguage: "ar" })).toEqual({ locale: "en", source: "default" });
  expect(negotiateUiLocale({ explicit: "ar-Arab-SA" }, preparedLocales)).toEqual({ locale: "ar", source: "explicit" });
  expect(negotiateUiLocale({ explicit: "ar-Latn", stored: "fr" }, preparedLocales)).toEqual({ locale: "fr", source: "stored" });
  expect(negotiateUiLocale({ acceptLanguage: "ar;q=0,ar-SA;q=1,fr;q=0.8" }, preparedLocales)).toEqual({ locale: "fr", source: "header" });
  expect(localeDirection("ar")).toBe("rtl");
  for (const locale of preparedLocales.filter(locale => locale !== "ar")) expect(localeDirection(locale)).toBe("ltr");
});

it.each(Object.entries(namespaces))("binds all %s Arabic draft entries (%s) to their current English source", (namespace, count) => {
  const value = draft(namespace), sourcePath = namespace === "core-inline" ? "lib/i18n/messages.ts" : `locales/en/${namespace}.ts`;
  expect(value.status).toBe("machineDraft"); expect(value.review).toBeNull();
  expect(validateNamespaceDraft(value, { namespace, ...extractNamespaceCopy(sourcePath, read(sourcePath)) }, glossary).coveredKeys).toHaveLength(count);
  for (const entry of Object.values(value.entries) as Array<{ text: string }>) expect(entry.text).not.toMatch(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/u);
});

it("loads the selected Arabic chunk while keeping originals and unreviewed critical text exact", async () => {
  expect(getUiPreview("ar")).toBe(emptyUiPreview); expect(getUiPreview("de")).toBe(emptyUiPreview);
  const preview = await loadUiPreview("ar"); expect(await loadUiPreview("ar")).toBe(preview); expect(getUiPreview("de")).toBe(emptyUiPreview);
  expect(previewText(preview, englishMessages["researchEntry.question"], ["core-inline"])).toBe(draft("core-inline").entries["researchEntry.question"].text);
  for (const key of ["product.heroBody", "product.faqPublicBody", "pricing.browserBody", "pricing.service", "pricing.reserve", "pricing.prepaidTerms", "about.projectLegalNotice", "about.contactBody"]) {
    const original = draft("product-guide").entries[key].source;
    expect(previewText(preview, original, ["product-guide"])).toBe(original);
  }
  for (const key of ["account.signatureInstruction", "researchEntry.sessionNotice", "privateProfile.privacyBoundary"] as const) expect(previewText(preview, englishMessages[key])).toBe(englishMessages[key]);
  const original = "Exact original نص عربي <literal> {count} USDC https://original.test/";
  expect(previewText(preview, original)).toBe(original);
  expect(previewText(preview, englishMessages["researchEntry.question"], ["reports"])).toBe(englishMessages["researchEntry.question"]);
});

it("keeps original interpolated values exact and uses neutral UI count labels for all Arabic plural categories", async () => {
  const preview = await loadUiPreview("ar"), message = createMessages("ar", preview.$messages), copy = draft("source-directory").entries;
  expect(copy["sourceLibrary.documentsMatched.one"].text).toBe(copy["sourceLibrary.documentsMatched.other"].text);
  for (const count of [0, 1, 2, 3, 10, 11, 99, 100, 101]) expect(message("sourceLibrary.documentsMatched.other", { count })).toBe(copy["sourceLibrary.documentsMatched.other"].text.replace("{count}", String(count)));
  const values = { database: "Original <database> USDC", domain: "https://original.test/{database}" }, before = JSON.stringify(values);
  const text = message("sourceFilter.placeholder", values); expect(text).toContain(values.database); expect(text).toContain(values.domain); expect(JSON.stringify(values)).toBe(before);
});
