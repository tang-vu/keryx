// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import GetStartedPage from "@/app/get-started/page";
import { setupCopy } from "@/locales/en/get-started";
import { extractNamespaceCopy, validateNamespaceDraft } from "../../scripts/check-ui-copy.mjs";
import { UiCopyContext, englishUiCopy } from "./ui-copy-context";
import { preparedLocales, shippedUiLocales } from "./locales";
import { loadUiPreview } from "./ui-preview-catalogues";
import { previewText } from "./ui-preview";
import { validateNamespacePreview } from "./ui-shell-catalogue";

vi.mock("@/components/keryx/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/keryx/site-footer", () => ({ SiteFooter: () => null }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => React.createElement("a", props, children) }));

const partialLocales = ["es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id", "ru", "ar"] as const;
const sourcePath = "locales/en/get-started.ts";
const source = { namespace: "get-started", ...extractNamespaceCopy(sourcePath, readFileSync(sourcePath, "utf8")) };
const glossary = JSON.parse(readFileSync("locales/glossary/en.json", "utf8"));
const draft = (locale: string) => JSON.parse(readFileSync(`locales/${locale}/ui-drafts/get-started.json`, "utf8"));

it.each(partialLocales)("%s supplies every neutral surface title, purpose and action without approving critical copy", async locale => {
  const catalogue = draft(locale);
  expect(catalogue.status).toBe("machineDraft");
  expect(catalogue.review).toBeNull();
  expect(validateNamespaceDraft(catalogue, source, glossary).coveredKeys).toHaveLength(76);
  const selected = validateNamespacePreview(catalogue, source, Object.keys(catalogue.entries));
  expect(Object.keys(selected)).toHaveLength(76);
  const preview = await loadUiPreview(locale);
  for (const [index, surface] of setupCopy.surfaces.entries()) {
    for (const field of ["title", "tag", "action"] as const)
      expect(previewText(preview, surface[field], ["get-started"])).toBe(catalogue.entries[`surfaces.${index}.${field}`].text);
    if (surface.id !== "desktop")
      expect(previewText(preview, surface.body, ["get-started"])).toBe(catalogue.entries[`surfaces.${index}.body`].text);
  }
  for (const original of [setupCopy.start.firstBody, setupCopy.start.accountBody, ...setupCopy.start.steps,
    setupCopy.start.faq[1].answer, setupCopy.start.faq[3].answer, setupCopy.common.helpBody,
    setupCopy.surfaces[0].detail, setupCopy.surfaces[1].body, setupCopy.surfaces[1].detail,
    setupCopy.surfaces[2].detail, setupCopy.surfaces[3].detail, setupCopy.surfaces[4].detail,
    setupCopy.surfaces[5].detail, setupCopy.surfaces[6].detail])
    expect(previewText(preview, original, ["get-started"])).toBe(original);
  expect(shippedUiLocales).toEqual(["en"]);
});

it.each(preparedLocales.filter(locale => locale !== "en"))("%s renders the seven setup choices with exact destinations and independent language leaves", async locale => {
  const preview = await loadUiPreview(locale);
  // A second namespace may use the same English label for another purpose.
  // Setup leaves must still resolve through their own namespace.
  const conflicting = Object.fromEntries(setupCopy.surfaces.flatMap(surface =>
    ["title", "tag", "body", "detail", "action"].map(field => [surface[field as keyof typeof surface], "Unrelated namespace text"])));
  const html = renderToStaticMarkup(React.createElement(UiCopyContext.Provider, {
    value: { ...englishUiCopy, locale, preview: { ...preview, unrelated: conflicting } },
  }, React.createElement(GetStartedPage)));
  const root = document.createElement("div"); root.lang = "en"; root.innerHTML = html;
  const articles = root.querySelectorAll('[aria-labelledby="choose-keryx"] article');
  expect(articles).toHaveLength(7);
  for (const [index, surface] of setupCopy.surfaces.entries()) {
    const article = articles[index];
    expect(article.querySelector("a")?.getAttribute("href")).toBe(surface.href);
    const title = article.querySelector("h3 span")!;
    const expected = previewText(preview, surface.title, ["get-started"]);
    expect(title.textContent).toBe(expected);
    expect(title.getAttribute("lang")).toBe(expected === surface.title ? "en" : locale);
    if (locale === "ar") expect(title.getAttribute("dir")).toBe(expected === surface.title ? "ltr" : "rtl");
    expect(article.querySelector("a")?.textContent).toBe(previewText(preview, surface.action, ["get-started"]));
    expect(article.textContent).not.toContain("Unrelated namespace text");
  }
  const platformAnswer = root.querySelectorAll("details")[2].querySelector("p span")!;
  expect(platformAnswer.textContent).toBe(draft(locale).entries["start.faq.2.answer"].text);
  expect(platformAnswer.getAttribute("lang")).toBe(locale);
  const desktopBody = articles[1].querySelector("p span")!;
  expect(desktopBody.textContent).toBe(setupCopy.surfaces[1].body);
  expect(desktopBody.getAttribute("lang")).toBe("en");
  expect(root.querySelector('nav a[aria-current="page"]')?.getAttribute("href")).toBe("/get-started");
});
