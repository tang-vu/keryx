// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { ResearchTurn } from "@/components/keryx/research-turn";
import { ReasoningConsole } from "@/components/keryx/reasoning-console";
import { FollowUpForm } from "@/components/keryx/follow-up-form";
import type { AskStreamState } from "../hooks/use-ask-stream";
import { extractNamespaceCopy, validateNamespaceDraft } from "../../scripts/check-ui-copy.mjs";
import { UiCopyContext, englishUiCopy } from "./ui-copy-context";
import { createMessages, englishMessages } from "./messages";
import { createRichMessages } from "./rich-messages";
import { loadUiPreview } from "./ui-preview-catalogues";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => { throw Error("No navigation during server rendering"); } }) }));
const added = ["es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id"] as const;
const keys = ["researchChat.label", "researchChat.kicker", "researchChat.title", "researchChat.introduction", "researchChat.turnsLabel",
  "researchChat.followUpContext", "researchChat.newResearch", "researchChat.stopResearch", "researchChat.toolsLabel", "researchChat.savedReports",
  "researchTurn.inProgress", "researchTurn.findingSources", "decisionLog.deciding", "decisionLog.connecting", "decisionLog.newSteps.one",
  "decisionLog.newSteps.other", "decisionLog.steps.one", "decisionLog.steps.other", "followUp.title", "followUp.questionLabel",
  "followUp.placeholder", "followUp.submit"] as const;
const originalQuestion = "Original <question> {count} 日本語 / हिन्दी";
const state: AskStreamState = { status: "streaming", meta: { engine: "synthetic", mode: "offline" }, budget: 0.025,
  steps: [], decisions: [], citations: [], payments: [], run: null, error: null, errorKind: null, retryAfter: null };
const turn = { id: 1, question: originalQuestion, payer: "Original payer {amount}", state };
function element(html: string) { const node = document.createElement("div"); node.innerHTML = html; return node; }

it.each(added)("%s authors the complete22 neutral conversation/continuation leaves with bound count arms", async locale => {
  const path = "locales/en/research-flow.ts", binding = extractNamespaceCopy(path, readFileSync(path, "utf8"));
  const draft = JSON.parse(readFileSync(`locales/${locale}/ui-drafts/research-flow.json`, "utf8"));
  expect(draft.status).toBe("machineDraft"); expect(draft.review).toBeNull(); expect(Object.keys(draft.entries)).toHaveLength(39);
  const valid = validateNamespaceDraft(draft, binding, JSON.parse(readFileSync("locales/glossary/en.json", "utf8")));
  const preview = await loadUiPreview(locale);
  for (const key of keys) {
    expect(valid.coveredKeys).toContain(key); expect(draft.entries[key].source).toBe(englishMessages[key]);
    expect(preview.$messages[key]).toBe(draft.entries[key].text); expect(preview.$messages[key]).not.toBe(englishMessages[key]);
  }
  for (const key of ["followUp.paymentNotice", "followUp.contextNotice", "researchTurn.stoppedNotice", "researchTurn.requestSummary",
    "researchTurn.offlineSummary.other", "researchChat.newQuestionContext", "researchChat.historyNotice", "researchChat.paidResearch", "researchChat.publishSource"] as const)
    expect(preview.$messages[key]).toBeUndefined();
  const message = createMessages(locale, preview.$messages);
  for (const count of [1, 2, 3]) {
    const text = message(count === 1 ? "decisionLog.newSteps.one" : "decisionLog.newSteps.other", { count });
    expect(text).toContain(String(count)); expect(text).not.toContain("{count}");
  }
});

it.each(added)("%s renders native live/follow-up controls and attributes retained financial warnings to English", async locale => {
  const preview = await loadUiPreview(locale), message = createMessages(locale, preview.$messages);
  const context = { ...englishUiCopy, locale, preview, message, richMessage: createRichMessages(locale, preview.$messages) };
  const render = (child: React.ReactElement) => element(renderToStaticMarkup(React.createElement(UiCopyContext.Provider, { value: context }, child)));
  const before = JSON.stringify(turn), live = render(React.createElement(ResearchTurn, { turn }));
  expect(live.querySelector(".kx-research-live")?.textContent).toContain(message("researchTurn.inProgress"));
  expect(live.querySelector(".kx-research-live")?.textContent).toContain(message("researchTurn.findingSources"));
  expect(live.querySelector(`.kx-research-live [lang="${locale}"]`)).not.toBeNull();
  expect(live.querySelector(".kx-research-request p:last-child")?.textContent).toBe(originalQuestion);
  expect(live.querySelector(".kx-research-request p:last-child")?.getAttribute("lang")).toBe("und");
  expect(live.querySelector('.kx-research-request [lang="en"]')).not.toBeNull();
  expect(live.querySelector('summary [lang="en"]')).not.toBeNull();
  const stopped = render(React.createElement(ResearchTurn, { turn: { ...turn, stopped: true } }));
  expect(stopped.querySelector('[role="status"] [lang="en"]')?.textContent).toBe(englishMessages["researchTurn.stoppedNotice"]);
  const form = render(React.createElement(FollowUpForm, { parentId: "11111111-2222-4333-8444-555555555555" }));
  expect(form.querySelector("textarea")?.getAttribute("placeholder")).toBe(message("followUp.placeholder"));
  expect(form.querySelector("button")?.textContent).toBe(message("followUp.submit"));
  expect(form.querySelector(`button [lang="${locale}"]`)).not.toBeNull();
  expect(form.querySelectorAll('[lang="en"]').length).toBeGreaterThanOrEqual(2);
  expect(form.textContent).toContain(englishMessages["followUp.paymentNotice"]); expect(form.textContent).toContain(englishMessages["followUp.contextNotice"]);
  expect(JSON.stringify(turn)).toBe(before);
});

it("uses an observable English waiting description only for an empty active log", () => {
  const active = element(renderToStaticMarkup(React.createElement(ReasoningConsole, { steps: [], streaming: true, budget: 0 })));
  expect(active.textContent).toContain("Waiting for research updates…"); expect(active.textContent).not.toContain("herald");
  const idle = element(renderToStaticMarkup(React.createElement(ReasoningConsole, { steps: [], streaming: false, budget: 0 })));
  expect(idle.textContent).not.toContain("Waiting for research updates…");
});

it("never translates an original trace string that happens to equal an authored UI label", async () => {
  const preview = await loadUiPreview("fr"), message = createMessages("fr", preview.$messages);
  const original = { ...turn, state: { ...state, steps: [{ phase: "discover" as const, ts: 1, message: "New research" }] } };
  const before = JSON.stringify(original);
  const output = element(renderToStaticMarkup(React.createElement(UiCopyContext.Provider, { value: {
    ...englishUiCopy, locale: "fr", preview, message, richMessage: createRichMessages("fr", preview.$messages),
  } }, React.createElement(ResearchTurn, { turn: original }))));
  expect(output.querySelector(".kx-research-live p:last-child")?.textContent).toBe("New research");
  expect(output.querySelector('.kx-research-live [lang="und"]')?.textContent).toBe("New research");
  expect(JSON.stringify(original)).toBe(before);
});

it.each([
  ["settled", 0.000001, true, "real", "0.000001 USDC settled"],
  ["pending", 0.000002, false, "real", "0.000002 pending"],
  ["simulated", 0.000008, false, "offline", "0.000008 simulated"],
  ["conflict", 0.000003, true, "real", "0.000003 unverified"],
  ["failed", 0.000004, false, "real", "0.000004 failed"],
] as const)("keeps the original %s financial summary English and distinct under native UI", async (status, amountUsdc, settled, mode, expected) => {
  const preview = await loadUiPreview("ja"), message = createMessages("ja", preview.$messages);
  const detail = { kind: "fetch" as const, queryId: "synthetic-summary", sourceId: "original-source", sourceName: "Original source {count}",
    payer: "synthetic-payer", payee: "synthetic-payee", amountUsdc, settled,
    settlementStatus: status === "conflict" ? "pending" as const : status, network: "synthetic-renderer-fixture-only", createdAt: "2026-10-29T00:00:00Z" };
  const captured = { ...turn, state: { ...state, status: "done" as const, meta: { engine: "synthetic", mode },
    steps: [{ phase: "fetch" as const, ts: 1, message: "Original financial fixture, no executed transfer", detail }] } };
  const before = JSON.stringify(captured);
  const output = element(renderToStaticMarkup(React.createElement(UiCopyContext.Provider, { value: {
    ...englishUiCopy, locale: "ja", preview, message, richMessage: createRichMessages("ja", preview.$messages),
  } }, React.createElement(ResearchTurn, { turn: captured }))));
  const summary = output.querySelector("summary")!;
  expect(summary.textContent).toContain(expected); expect(summary.textContent).toContain("0.025 cap");
  expect(summary.querySelector('[lang="en"]')).not.toBeNull();
  if (status !== "settled") expect(summary.textContent).not.toContain(`${amountUsdc} USDC settled`);
  expect(summary.textContent?.includes("offline simulation")).toBe(mode === "offline");
  expect(JSON.stringify(captured)).toBe(before);
});
