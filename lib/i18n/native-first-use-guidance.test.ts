// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OnboardingTour } from "@/components/keryx/onboarding-tour";
import { extractNamespaceCopy, validateNamespaceDraft } from "../../scripts/check-ui-copy.mjs";
import { UiCopyContext, englishUiCopy } from "./ui-copy-context";
import { createMessages, englishMessages } from "./messages";
import { createRichMessages } from "./rich-messages";
import { loadUiPreview } from "./ui-preview-catalogues";
import { UiText } from "./ui-copy";

const added = ["es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id"] as const;
const coreKeys = ["researchEntry.keyboardHint", "researchEntry.metadataLookup", "researchEntry.metadataLookupLabel",
  "researchEntry.quickHint", "researchEntry.deepHint", "researchEntry.examplesLabel"] as const;
const flowKeys = ["researchTour.open", "researchTour.label", "researchTour.questionTitle", "researchTour.questionBody",
  "researchTour.startTitle", "researchTour.closeLabel", "researchTour.close", "researchTour.back", "researchTour.done",
  "researchTour.next", "researchTour.step", "decisionLog.jumpToLatest", "decisionLog.followingLatest",
  "decisionLog.readingEarlier", "decisionLog.scrollHint", "decisionLog.title", "decisionLog.label"] as const;
let root: Root | undefined, container: HTMLDivElement | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; container?.remove(); container = undefined;
  document.documentElement.lang = "en"; vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it.each(added)("%s authors and compiles complete neutral first-use instructions with bound placeholders", async locale => {
  const preview = await loadUiPreview(locale);
  const glossary = JSON.parse(readFileSync("locales/glossary/en.json", "utf8"));
  for (const [namespace, sourcePath, keys] of [["core-inline", "lib/i18n/messages.ts", coreKeys],
    ["research-flow", "locales/en/research-flow.ts", flowKeys]] as const) {
    const binding = extractNamespaceCopy(sourcePath, readFileSync(sourcePath, "utf8"));
    const draft = JSON.parse(readFileSync(`locales/${locale}/ui-drafts/${namespace}.json`, "utf8"));
    expect(draft.status).toBe("machineDraft"); expect(draft.review).toBeNull();
    const validated = validateNamespaceDraft(draft, binding, glossary);
    for (const key of keys) {
      expect(validated.coveredKeys).toContain(key);
      expect(draft.entries[key].source).toBe(englishMessages[key]);
      expect(draft.entries[key].text).not.toBe(englishMessages[key]);
      expect(preview.$messages[key]).toBe(draft.entries[key].text);
    }
  }
  for (const key of ["researchTour.budgetTitle", "researchTour.budgetBody", "researchTour.capTitle", "researchTour.capBody",
    "researchTour.startBody", "researchEntry.sessionNotice", "researchVisibility.publicNotice", "researchEntry.searchNotice"] as const)
    expect(preview.$messages[key]).toBeUndefined();
  const message = createMessages(locale, preview.$messages);
  const step = message("researchTour.step", { number: 2, total: 4 });
  expect(step).not.toMatch(/\{(?:number|total)\}/u);
  expect(step).toContain("2"); expect(step).toContain("4");
});

it.each([["fr", "Poser une question"], ["de", "Frage stellen"]] as const)("keeps the existing %s question label translated across catalogue aliases", async (locale, expected) => {
  const preview = await loadUiPreview(locale);
  const html = renderToStaticMarkup(React.createElement(UiCopyContext.Provider, { value: {
    ...englishUiCopy, locale, preview, message: createMessages(locale, preview.$messages),
    richMessage: createRichMessages(locale, preview.$messages),
  } }, React.createElement(UiText, { source: "Ask a question" })));
  const output = document.createElement("div"); output.innerHTML = html;
  expect(output.textContent).toBe(expected);
  expect(output.querySelector("[lang]")?.getAttribute("lang")).toBe(locale);
});

it("marks the actual English spending explanation explicitly when a native-language tour opens", async () => {
  const preview = await loadUiPreview("fr");
  document.documentElement.lang = "fr";
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(React.createElement(UiCopyContext.Provider, { value: {
    ...englishUiCopy, locale: "fr", preview, message: createMessages("fr", preview.$messages),
    richMessage: createRichMessages("fr", preview.$messages),
  } }, React.createElement(OnboardingTour))));
  await act(async () => container!.querySelector("button")!.click());
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
  const title = document.querySelector('[role="dialog"] h2')!;
  const body = document.querySelector('[role="dialog"] [role="region"] p')!;
  expect(title.textContent).toBe(englishMessages["researchTour.budgetTitle"]);
  expect(body.textContent).toBe(englishMessages["researchTour.budgetBody"]);
  expect(title.querySelector('[lang="en"]')).not.toBeNull();
  expect(body.querySelector('[lang="en"]')).not.toBeNull();
});
