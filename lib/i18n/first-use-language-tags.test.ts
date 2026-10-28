// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ResearchChat } from "@/components/keryx/research-chat";
import { LanguageSwitcher } from "@/components/keryx/language-switcher";
import { LocaleProvider } from "./locale-context";
import { UiCopyProvider } from "./ui-copy-provider";
import { loadUiPreview } from "./ui-preview-catalogues";
import { preparedLocales } from "./locales";
import { englishMessages } from "./messages";
import { productGuideCopy } from "@/locales/en/product-guide";

// Keep the real composer, visibility and stream hooks. Unrelated wallet/tour
// panels are absent, and every HTTP request is a bounded synthetic GET.
vi.mock("@/lib/hooks/use-research-availability", () => ({ useResearchAvailability: () => ({
  availability: { state: "not-paused" }, checking: false, refresh: async () => ({ state: "not-paused" }),
}) }));
vi.mock("@/components/keryx/session-grant-panel", () => ({ SessionGrantPanel: () => null }));
vi.mock("@/components/keryx/onboarding-tour", () => ({ OnboardingTour: () => null }));
vi.mock("@/components/keryx/globe-watermark", () => ({ GlobeWatermark: () => null }));
vi.mock("@/components/keryx/sponsored-trial-notice", () => ({ SponsoredTrialNotice: () => null }));
vi.mock("@/components/keryx/product-hunt-badge", () => ({ ProductHuntBadge: () => null }));
vi.mock("@/components/keryx/research-turn", () => ({ ResearchTurn: () => null }));

let root: Root, container: HTMLDivElement;
let requests: Array<{ path: string; method: string }>;
class Channel { onmessage = null; close() {} postMessage() {} }
const h = React.createElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("BroadcastChannel", Channel);
  localStorage.clear(); window.history.replaceState(null, "", "/"); requests = [];
  Object.defineProperty(navigator, "languages", { configurable: true, value: ["en"] });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input); requests.push({ path, method: init.method ?? "GET" });
    if (path === "/api/auth/session") return new Response(null, { status: 401 });
    if (path === "/api/ask/visibility") return Response.json({ wallet: null, defaultVisibility: "public", privacyActive: true });
    if (path === "/api/models") return Response.json({ models: [
      { id: "deepseek", label: "Exact default model", note: "Original model note" },
      { id: "synthetic-alternative", label: "Original alternative model", note: "Original model note" },
    ] });
    if (path === "/api/sources") return Response.json({ sources: [] });
    throw Error(`Unexpected synthetic request: ${path}`);
  }));
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("marks real first-use translations with their language while preserving English fallback and the exact unsent question", async () => {
  await act(async () => root.render(h(LocaleProvider, { enabledLocales: preparedLocales, prepareLocale: loadUiPreview,
    network: "eip155:5042", children: h(UiCopyProvider, { children: h(React.Fragment, null,
      h(LanguageSwitcher), h(ResearchChat, { introduceProduct: true })) }) })));
  await vi.waitFor(() => expect(container.querySelector("select")!.disabled).toBe(false));
  const input = container.querySelector("textarea")!, select = container.querySelector<HTMLSelectElement>("[data-language-switcher] select")!;
  const original = "What do you want to know? 原文 हिन्दी <USDC> {count}";
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, original);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  for (const locale of preparedLocales.filter(value => value !== "en")) {
    await act(async () => { select.value = locale; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await vi.waitFor(() => expect(document.documentElement.lang).toBe(locale));
    for (const [selector, english] of [['label[for="ask-question"]', englishMessages["researchEntry.question"]],
      ["h1", productGuideCopy("product.heroTitle")], ["fieldset legend", englishMessages["researchEntry.depth"]],
      ['[data-tour="dispatch-btn"]', englishMessages["researchEntry.ask"]], ["summary", englishMessages["researchEntry.moreOptions"]]]) {
      const element = container.querySelector(selector)!;
      const actualLanguage = element.textContent?.trim() === english ? "en" : locale;
      expect(element.querySelector(`[lang="${actualLanguage}"]`), `${locale} ${selector} must expose its actual authored language`).not.toBeNull();
    }
    const introduction = container.querySelector(".kx-research-intro")!;
    expect(introduction.textContent).toBe(productGuideCopy("product.heroBody"));
    expect(introduction.querySelector('[lang="en"]')).not.toBeNull();
    const payer = container.querySelector('[data-testid="composer-payer-notice"]')!;
    expect(payer.textContent).toBe(englishMessages["researchEntry.freeTrialNotice"]);
    expect(payer.querySelector('[lang="en"]')).not.toBeNull();
    const defaultModel = container.querySelector('option[value=""]')!;
    expect(defaultModel.children.length).toBe(0); // Native options must contain text, never nested spans.
    expect(defaultModel.getAttribute("lang")).toBe(defaultModel.textContent === englishMessages["researchEntry.defaultModel"] ? "en" : locale);
    expect(container.querySelector("textarea")).toBe(input); expect(input.value).toBe(original);
  }
  await act(async () => { select.value = "en"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await vi.waitFor(() => expect(document.documentElement.lang).toBe("en"));
  expect(container.querySelector('label[for="ask-question"]')!.textContent).toBe(englishMessages["researchEntry.question"]);
  expect(input.value).toBe(original);
  expect(requests.every(request => request.method === "GET" &&
    ["/api/auth/session", "/api/ask/visibility", "/api/models", "/api/sources"].includes(request.path))).toBe(true);
});
