// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import AboutPage from "@/app/about/page";
import { productGuideCopy } from "@/locales/en/product-guide";
import { extractNamespaceCopy, validateNamespaceDraft } from "../../scripts/check-ui-copy.mjs";
import { shippedUiLocales } from "./locales";
import { loadUiPreview } from "./ui-preview-catalogues";
import { previewText } from "./ui-preview";
import { UiCopyContext, englishUiCopy } from "./ui-copy-context";
import { createMessages } from "./messages";
import { createRichMessages } from "./rich-messages";

vi.mock("@/components/keryx/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/keryx/site-footer", () => ({ SiteFooter: () => null }));
vi.mock("@/components/keryx/about-research-story", () => ({ AboutResearchStory: () => null }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => React.createElement("a", props, children) }));

const locales = ["es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id"] as const;
const sourcePath = "locales/en/product-guide.ts";
const binding = extractNamespaceCopy(sourcePath, readFileSync(sourcePath, "utf8"));
const glossary = JSON.parse(readFileSync("locales/glossary/en.json", "utf8"));

it.each(locales)("%s covers every product-guide leaf and renders neutral explanations without approving financial or legal drafts", async locale => {
  const draft = JSON.parse(readFileSync(`locales/${locale}/ui-drafts/product-guide.json`, "utf8"));
  const validation = validateNamespaceDraft(draft, binding, glossary);
  expect(validation.uncoveredKeys).toEqual([]);
  expect(validation.coveredKeys).toHaveLength(95);
  expect(draft.status).toBe("machineDraft");
  expect(draft.review).toBeNull();
  expect(shippedUiLocales).toEqual(["en"]);

  const preview = await loadUiPreview(locale);
  for (const key of ["product.researchersBody", "about.title", "about.projectBody", "about.github", "about.issues"] as const) {
    expect(draft.entries[key].text).not.toBe(productGuideCopy(key));
    expect(previewText(preview, productGuideCopy(key), ["product-guide"])).toBe(draft.entries[key].text);
  }
  for (const key of ["pricing.browserBody", "pricing.prepaidTerms", "product.faqPublicBody", "about.projectLegalNotice", "about.projectLegalLink", "about.contactBody"] as const) {
    expect(draft.entries[key].text).not.toBe(productGuideCopy(key));
    expect(previewText(preview, productGuideCopy(key), ["product-guide"])).toBe(productGuideCopy(key));
  }

  const html = renderToStaticMarkup(React.createElement(UiCopyContext.Provider, { value: {
    ...englishUiCopy, locale, preview, message: createMessages(locale, preview.$messages), richMessage: createRichMessages(locale, preview.$messages),
  } }, React.createElement(AboutPage)));
  const container = document.createElement("div"); container.lang = "en"; container.innerHTML = html;
  const headline = container.querySelector("h1 [lang]")!;
  expect(headline.textContent).toBe(draft.entries["about.title"].text);
  expect(headline.getAttribute("lang")).toBe(locale);
  const explanation = [...container.querySelectorAll("p [lang]")].find(node => node.textContent === draft.entries["about.projectBody"].text)!;
  expect(explanation).toBeDefined();
  expect(explanation.getAttribute("lang")).toBe(locale);
  const legal = [...container.querySelectorAll("p [lang]")].find(node => node.textContent === productGuideCopy("about.projectLegalNotice"))!;
  expect(legal).toBeDefined();
  expect(legal.getAttribute("lang")).toBe("en");
  expect(container.querySelector('a[href="https://github.com/tang-vu/keryx/blob/main/docs/licensing.md"]')!.textContent).toBe("Licensing scope");
  expect(container.querySelector('a[href="https://github.com/tang-vu/keryx"]')!.textContent).toBe(draft.entries["about.github"].text);
  expect(container.querySelector('a[href="https://github.com/tang-vu/keryx/issues"]')!.textContent).toBe(draft.entries["about.issues"].text);
});
