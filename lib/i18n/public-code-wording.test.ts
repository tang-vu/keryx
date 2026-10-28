// @vitest-environment jsdom
import React from "react";
import { readFileSync, readdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import AboutPage from "@/app/about/page";
import { productGuideCopy } from "@/locales/en/product-guide";
import { preparedLocales } from "./locales";
import { loadUiPreview } from "./ui-preview-catalogues";
import { UiCopyContext, englishUiCopy } from "./ui-copy-context";
import { createMessages } from "./messages";
import { createRichMessages } from "./rich-messages";

vi.mock("@/components/keryx/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/keryx/site-footer", () => ({ SiteFooter: () => null }));
vi.mock("@/components/keryx/about-research-story", () => ({ AboutResearchStory: () => null }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => React.createElement("a", props, children) }));

it("describes public code consistently with the owner's current licensing scope", () => {
  const scope = readFileSync("docs/licensing.md", "utf8"), message = createMessages("en");
  expect(scope).toContain("without a repository-wide license");
  expect(readdirSync(".").filter(file => /^(?:LICENSE|LICENCE)(?:\.(?:md|txt))?$/iu.test(file))).toEqual([]);
  expect(productGuideCopy("about.projectTitle")).toBe("Developed in public");
  expect(message("proofDashboard.openSourceBuild")).toBe("Public code");
  expect(message("proofPage.metadataDescription")).not.toMatch(/open.source/iu);
  expect(message("proofPage.metadataDescription")).toContain("Arc registry authority, Circle settlement, and creator cash-outs.");
});

for (const locale of preparedLocales) it(`${locale} renders the native neutral heading with an authoritative English licensing notice and direct scope link`, async () => {
  const preview = await loadUiPreview(locale);
  const html = renderToStaticMarkup(React.createElement(UiCopyContext.Provider, { value: {
    ...englishUiCopy, locale, preview, message: createMessages(locale, preview.$messages), richMessage: createRichMessages(locale, preview.$messages),
  } }, React.createElement(AboutPage)));
  const container = document.createElement("div"); container.lang = "en"; container.innerHTML = html;
  const draft = locale === "en" ? undefined : JSON.parse(readFileSync(`locales/${locale}/ui-drafts/product-guide.json`, "utf8"));
  const title = draft?.entries["about.projectTitle"].text ?? productGuideCopy("about.projectTitle");
  const heading = [...container.querySelectorAll("h2")].find(node => node.textContent === title)!;
  expect(heading).toBeDefined();
  expect((heading.querySelector("[lang]") ?? heading).closest("[lang]")!.getAttribute("lang")).toBe(locale);
  if (draft) {
    expect(draft.status).toBe("machineDraft"); expect(draft.review).toBeNull();
    expect(title).not.toBe(productGuideCopy("about.projectTitle"));
  }
  const notice = [...container.querySelectorAll("p")].find(node => node.textContent === productGuideCopy("about.projectLegalNotice"))!;
  expect(notice).toBeDefined();
  expect((notice.querySelector("[lang]") ?? notice).closest("[lang]")!.getAttribute("lang")).toBe("en");
  const link = container.querySelector('a[href="https://github.com/tang-vu/keryx/blob/main/docs/licensing.md"]')!;
  expect(link).not.toBeNull(); expect(link.textContent).toBe("Licensing scope");
  expect((link.querySelector("[lang]") ?? link).closest("[lang]")!.getAttribute("lang")).toBe("en");
  expect(container.querySelector('a[href="https://github.com/tang-vu/keryx"]')).not.toBeNull();
  expect(container.querySelector('a[href="https://github.com/tang-vu/keryx/issues"]')).not.toBeNull();
  expect(container.textContent).not.toContain("An open-source project");
});
