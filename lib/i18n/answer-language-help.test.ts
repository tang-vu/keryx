// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AskForm } from "@/components/keryx/ask-form";
import { ResearchChat } from "@/components/keryx/research-chat";
import { UiCopyContext, englishUiCopy } from "./ui-copy-context";
import { loadUiPreview } from "./ui-preview-catalogues";
import { preparedLocales, type UiLocale } from "./locales";
import { uiPreferenceMessages } from "@/locales/en/ui-preference";
import { answerLanguageInstructions } from "@/shared/i18n/answer-language-instructions";
import { canonicalPresentationLanguages } from "@/shared/i18n/presentation-language";
import { answerPresentation } from "@/lib/research/answer-presentation";

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
let visibility: "public" | "private" | "unlisted" | "unavailable";
let requests: Array<{ path: string; method: string }>;
class Channel { onmessage = null; close() {} postMessage() {} }
const h = React.createElement;
const original = "Original question 日本語 <source> {count} USDC — do not edit";
function draft(locale: UiLocale) {
  if (locale === "en") return { entries: Object.fromEntries(Object.entries(uiPreferenceMessages).map(([key, source]) => [key, { source, text: source }])) };
  return JSON.parse(readFileSync(`locales/${locale}/ui-drafts/ui-preference.json`, "utf8"));
}
async function value(locale: UiLocale) {
  return { ...englishUiCopy, locale, preview: await loadUiPreview(locale) };
}
async function render(locale: UiLocale, props: Partial<React.ComponentProps<typeof AskForm>> = {}) {
  const onAsk = vi.fn();
  const copy = await value(locale);
  await act(async () => root.render(h(UiCopyContext.Provider, { value: copy, children: h(AskForm, { onAsk, showAnswerLanguageHelp: true, ...props }) })));
  await vi.waitFor(() => expect(requests.some(request => request.path === "/api/ask/visibility")).toBe(true));
  return onAsk;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("BroadcastChannel", Channel);
  visibility = "public"; requests = []; window.history.replaceState(null, "", "/");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input); requests.push({ path, method: init.method ?? "GET" });
    if (path === "/api/models") return Response.json({ models: [] });
    if (path === "/api/sources") return Response.json({ sources: [] });
    if (path === "/api/ask/visibility") return visibility === "unavailable" ? new Response(null, { status: 503 }) : Response.json({
      wallet: visibility === "private" ? "0x" + "1".repeat(40) : null, defaultVisibility: visibility, privacyActive: true,
    });
    throw Error(`Unexpected request: ${path}`);
  }));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("offers exactly the finite native instructions accepted by the actual original-question parser", () => {
  expect(answerLanguageInstructions.map(row => row.language)).toEqual(canonicalPresentationLanguages);
  for (const row of answerLanguageInstructions) {
    const question = row.instruction + " " + original;
    expect(answerPresentation(question).requestedLanguage).toBe(row.language);
    expect(question).toBe(row.instruction + " " + original);
  }
});

it.each(preparedLocales)("%s disclosure exposes native examples and preserves the actual unsubmitted question", async locale => {
  const onAsk = await render(locale);
  await vi.waitFor(() => expect(container.querySelector("[data-answer-language-help] button")).not.toBeNull());
  const input = container.querySelector<HTMLTextAreaElement>("#ask-question")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, original);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const button = container.querySelector<HTMLButtonElement>("[data-answer-language-help] button")!;
  const primaryAction = container.querySelector<HTMLButtonElement>('[data-tour="dispatch-btn"]')!;
  expect(primaryAction.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
  expect(button.type).toBe("button"); expect(button.getAttribute("aria-expanded")).toBe("false"); expect(panel.hidden).toBe(true);
  expect(button.textContent).toBe(draft(locale).entries.answerLanguageTitle.text);
  await act(async () => button.click());
  expect(panel.hidden).toBe(false); expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(panel.textContent).toContain(draft(locale).entries.answerLanguageBody.text);
  if (locale !== "en") expect(panel.querySelector(`p [lang="${locale}"]`)).not.toBeNull();
  for (const row of answerLanguageInstructions) {
    expect(panel.querySelector(`code[lang="${row.language}"]`)?.textContent).toBe(row.instruction);
    expect(panel.querySelector(`li > span[lang="${row.language}"]`)?.textContent).toBe(row.name);
    const direction = row.language === "ar" ? "rtl" : "ltr";
    expect(panel.querySelector(`code[lang="${row.language}"]`)?.getAttribute("dir")).toBe(direction);
    expect(panel.querySelector(`li > span[lang="${row.language}"]`)?.parentElement?.getAttribute("dir")).toBe(direction);
  }
  await act(async () => button.click());
  expect(panel.hidden).toBe(true); expect(input.value).toBe(original); expect(onAsk).not.toHaveBeenCalled();
  expect(requests.every(request => request.method === "GET" && ["/api/models", "/api/ask/visibility"].includes(request.path))).toBe(true);
});

it.each(["private", "unlisted", "unavailable"] as const)("does not offer public answer-language support in a %s context", async state => {
  visibility = state; await render("fr");
  await vi.waitFor(() => expect(container.querySelector('[data-testid="composer-publication-notice"]') ??
    container.querySelector('[role="status"]')).not.toBeNull());
  expect(container.querySelector("[data-answer-language-help]")).toBeNull();
  expect(requests.every(request => request.method === "GET")).toBe(true);
});

it.each([{ conversation: true }, { parentId: "11111111-1111-4111-8111-111111111111" }])(
  "does not promise the first-question contract to a follow-up %j", async props => {
    await render("fr", props);
    expect(container.querySelector("[data-answer-language-help]")).toBeNull();
  });

it.each([false, true])("actual ResearchChat privateClaims=%s qualifies its caller separately from public publication preference", async privateClaims => {
  const copy = await value("fr");
  await act(async () => root.render(h(UiCopyContext.Provider, { value: copy, children: h(ResearchChat, { privateClaims, introduceProduct: true }) })));
  await vi.waitFor(() => expect(container.querySelector('[data-testid="composer-publication-notice"]')).not.toBeNull());
  expect(container.querySelector("[data-answer-language-help]") !== null).toBe(!privateClaims);
  if (!privateClaims) {
    const input = container.querySelector<HTMLTextAreaElement>("#ask-question")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, original);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector<HTMLButtonElement>("[data-answer-language-help] button")!.click();
    });
    expect(input.value).toBe(original);
  }
  expect(requests.every(request => request.method === "GET" && ["/api/models", "/api/ask/visibility", "/api/sources"].includes(request.path))).toBe(true);
});
