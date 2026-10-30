// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import DownloadPage from "@/app/download/page";
import { setupCopy } from "@/locales/en/get-started";
import { installationLinks } from "@/lib/public-installation";
import { extractNamespaceCopy, validateNamespaceDraft } from "../../scripts/check-ui-copy.mjs";
import { UiCopyContext, englishUiCopy } from "./ui-copy-context";
import { preparedLocales, localeDirection, shippedUiLocales } from "./locales";
import { loadUiPreview } from "./ui-preview-catalogues";
import { previewText } from "./ui-preview";

vi.mock("@/components/keryx/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/keryx/site-footer", () => ({ SiteFooter: () => null }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => React.createElement("a", props, children) }));

const partialLocales = ["es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id", "ru", "ar"] as const;
const sourcePath = "locales/en/get-started.ts";
const source = { namespace: "get-started", ...extractNamespaceCopy(sourcePath, readFileSync(sourcePath, "utf8")) };
const glossary = JSON.parse(readFileSync("locales/glossary/en.json", "utf8"));
const draft = (locale: string) => JSON.parse(readFileSync(`locales/${locale}/ui-drafts/get-started.json`, "utf8"));
const literalTokens = /-setup\.exe|-win32-x64\.zip|-release\.json|-SHA256SUMS\.txt|manifest\.json|chrome:\/\/extensions|edge:\/\/extensions|Developer mode|Load unpacked/gu;
const literals = (text: string) => [...text.matchAll(literalTokens)].map(match => match[0]).sort();

it.each(partialLocales)("%s supplies neutral installation guidance with exact file and browser literals", async locale => {
  const value = draft(locale);
  expect(value.status).toBe("machineDraft"); expect(value.review).toBeNull();
  expect(validateNamespaceDraft(value, source, glossary).coveredKeys).toHaveLength(101);
  const entries = Object.entries(value.entries).filter(([key]) => key.startsWith("download.")) as Array<[string, { source: string; text: string }]>;
  expect(entries).toHaveLength(20);
  const preview = await loadUiPreview(locale);
  for (const [, entry] of entries) {
    expect(previewText(preview, entry.source, ["get-started"])).toBe(entry.text);
    expect(literals(entry.text)).toEqual(literals(entry.source));
  }
  for (const original of [setupCopy.download.body, setupCopy.download.desktopBody, setupCopy.download.desktopBoundary,
    ...setupCopy.download.desktopSteps.slice(2), setupCopy.download.extensionVersion,
    setupCopy.download.extensionSteps[3], setupCopy.download.extensionBoundary, setupCopy.common.copyFailed])
    expect(previewText(preview, original, ["get-started"])).toBe(original);
  expect(shippedUiLocales).toEqual(["en"]);
});

it.each(preparedLocales.filter(locale => locale !== "en"))("%s renders real download actions and step language without changing installation destinations", async locale => {
  const preview = await loadUiPreview(locale);
  const unrelated = Object.fromEntries(Object.values(source.entries).map(text => [text, "Wrong install instruction"]));
  const html = renderToStaticMarkup(React.createElement(UiCopyContext.Provider, {
    value: { ...englishUiCopy, locale, preview: { ...preview, unrelated } },
  }, React.createElement(DownloadPage)));
  const root = document.createElement("div"); root.lang = "en"; root.innerHTML = html;
  const copy = setupCopy.download;
  const leaf = (selector: string, original: string) => {
    const span = root.querySelector(selector)!;
    const expected = previewText(preview, original, ["get-started"]);
    expect(span.textContent).toBe(expected);
    expect(span.getAttribute("lang")).toBe(expected === original ? "en" : locale);
    expect(span.getAttribute("dir")).toBe(locale === "ar" ? localeDirection(expected === original ? "en" : locale) : null);
  };
  leaf("main h1 span", copy.title);
  leaf("main header > p:last-child span", copy.body);
  leaf("#desktop-title span", copy.desktopTitle);
  leaf("#extension-title span", copy.extensionTitle);
  const sections = [["desktop", copy.desktopSteps], ["extension", copy.extensionSteps]] as const;
  for (const [id, steps] of sections) {
    const rendered = root.querySelectorAll(`#${id} ol li span`);
    expect(rendered).toHaveLength(steps.length);
    for (const [index, original] of steps.entries()) {
      leaf(`#${id} ol li:nth-child(${index + 1}) span`, original);
      const text = previewText(preview, original, ["get-started"]);
      const tokens = [...rendered[index].querySelectorAll("bdi")];
      expect(tokens.map(token => token.textContent).sort()).toEqual(text === original ? [] : literals(original).filter(token => text.includes(token)));
      for (const token of tokens) {
        expect(token.getAttribute("dir")).toBe("ltr");
        expect(token.getAttribute("lang")).toBe("en");
        expect((token as HTMLElement).style.whiteSpace).toBe("nowrap");
      }
    }
  }
  leaf("#desktop > p:last-of-type span", copy.desktopBoundary);
  leaf("#extension > p:last-of-type span", copy.extensionBoundary);
  expect([...root.querySelectorAll("#desktop a")].map(link => link.getAttribute("href"))).toEqual([
    installationLinks.installer, installationLinks.portable, installationLinks.release,
    installationLinks.manifest, installationLinks.webview, `${installationLinks.docs}desktop-alpha.md`,
  ]);
  expect([...root.querySelectorAll("#extension a")].map(link => link.getAttribute("href"))).toEqual([
    installationLinks.extensionSource, installationLinks.extensionStore,
    "https://github.com/tang-vu/keryx/blob/main/extension/README.md",
  ]);
  expect(root.querySelector('nav a[aria-current="page"]')?.getAttribute("href")).toBe("/download");
  expect(root.querySelector("form")).toBeNull();
  expect(root.textContent).not.toContain("Wrong install instruction");
  expect(root.lang).toBe("en");
});
