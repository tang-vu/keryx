// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import IntegrationsPage from "@/app/integrations/page";
import { setupCopy } from "@/locales/en/get-started";
import { setupExamples, installationLinks } from "@/lib/public-installation";
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
const guide = setupCopy.integrations;
const examples = [
  [guide.remoteEndpoint, setupExamples.remoteEndpoint], [guide.stdioConfig, setupExamples.stdio],
  [guide.apiReadOnly, setupExamples.models], [guide.apiExample, setupExamples.chat], [guide.cliSetup, setupExamples.cli],
] as const;
const critical = [guide.body, guide.remoteBody, guide.remoteStep, guide.stdioBody, guide.stdioRequirements,
  guide.stdioGuide, guide.stdioPackage, guide.stdioStep, guide.apiBody, ...guide.apiSteps.slice(1),
  guide.apiExample, guide.apiExampleNotice, guide.a2aBody, guide.a2aAction, guide.cliBoundary, guide.botsBody];

it.each(partialLocales)("%s supplies neutral integration guidance without approving payment, custody or privacy copy", async locale => {
  const value = draft(locale);
  expect(value.status).toBe("machineDraft"); expect(value.review).toBeNull();
  expect(validateNamespaceDraft(value, source, glossary).coveredKeys).toHaveLength(101);
  const entries = Object.entries(value.entries).filter(([key]) => key.startsWith("integrations.")) as Array<[string, { source: string; text: string }]>;
  expect(entries).toHaveLength(25);
  const preview = await loadUiPreview(locale);
  for (const [, entry] of entries) expect(previewText(preview, entry.source, ["get-started"])).toBe(entry.text);
  for (const original of critical) expect(previewText(preview, original, ["get-started"])).toBe(original);
  expect(value.entries["integrations.telegramBody"].text).toContain("/ask");
  expect(shippedUiLocales).toEqual(["en"]);
});

it.each(preparedLocales.filter(locale => locale !== "en"))("%s renders actual integration headings, accessible examples and exact commands independently of other namespaces", async locale => {
  const preview = await loadUiPreview(locale);
  const unrelated = Object.fromEntries(Object.values(source.entries).map(text => [text, "Unrelated setup meaning"]));
  const html = renderToStaticMarkup(React.createElement(UiCopyContext.Provider, {
    value: { ...englishUiCopy, locale, preview: { ...preview, unrelated } },
  }, React.createElement(IntegrationsPage)));
  const root = document.createElement("div"); root.lang = locale; root.dir = localeDirection(locale); root.innerHTML = html;
  const translated = (text: string) => previewText(preview, text, ["get-started"]);
  const heading = root.querySelector("h1 span")!;
  expect(heading.textContent).toBe(translated(guide.title));
  expect(heading.getAttribute("lang")).toBe(locale);
  expect(root.textContent).not.toContain("Unrelated setup meaning");
  const codes = root.querySelectorAll("pre"); expect(codes).toHaveLength(examples.length);
  for (const [index, [title, command]] of examples.entries()) {
    const code = codes[index], header = code.previousElementSibling!;
    expect(code.textContent).toBe(command);
    expect(code.querySelector("code")?.getAttribute("lang")).toBe("en"); expect(code.getAttribute("dir")).toBe("ltr");
    expect(code.getAttribute("translate")).toBe("no");
    expect(header.querySelector("p")?.id).toBeTruthy();
    expect(code.getAttribute("aria-labelledby")).toBe(header.querySelector("p")?.id);
    expect(header.querySelector("p span")?.textContent).toBe(translated(title));
    expect(header.querySelector("p span")?.getAttribute("lang")).toBe(translated(title) === title ? "en" : locale);
    expect(header.querySelector("button")?.getAttribute("aria-label")).toBe(`${translated(setupCopy.common.copy)} ${translated(title)}`);
  }
  const body = root.querySelector("#bots article p > span")!;
  expect(body.textContent).toBe(translated(guide.telegramBody));
  const command = body.querySelector("bdi")!;
  expect(command.textContent).toBe("/ask"); expect(command.getAttribute("dir")).toBe("ltr");
  expect(command.getAttribute("lang")).toBe("en"); expect(command.style.whiteSpace).toBe("nowrap");
  const requirements = root.querySelectorAll("#cli > p > span")[1];
  const packageName = root.querySelector<HTMLElement>("#cli > p > span bdi")!;
  expect(packageName.textContent).toBe("keryx-mcp"); expect(packageName.getAttribute("dir")).toBe("ltr");
  expect(packageName.style.whiteSpace).toBe("nowrap");
  expect(requirements.textContent).toBe(translated(guide.cliRequirements));
  expect([...requirements.querySelectorAll("bdi")].map(token => token.textContent)).toEqual(["22.19+", "24+", "11.19.0"]);
  for (const token of requirements.querySelectorAll("bdi")) expect(token.getAttribute("dir")).toBe("ltr");
  expect(root.querySelector('nav a[aria-current="page"]')?.getAttribute("href")).toBe("/integrations");
  expect([...root.querySelectorAll("#bots article > a:first-of-type")].map(link => link.getAttribute("href"))).toEqual([
    installationLinks.telegram, installationLinks.discord, `${installationLinks.docs}slack-bot-setup.md`,
  ]);
  expect(root.querySelector("form")).toBeNull();
});
