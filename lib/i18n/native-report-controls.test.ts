// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { ReportActions } from "@/components/keryx/report-actions";
import { extractNamespaceCopy, validateNamespaceDraft } from "../../scripts/check-ui-copy.mjs";
import { UiCopyContext, englishUiCopy } from "./ui-copy-context";
import { createMessages, englishMessages } from "./messages";
import { createRichMessages } from "./rich-messages";
import { loadUiPreview } from "./ui-preview-catalogues";
import { researchReportMarkdown } from "../research-report-export";
import type { QueryRun } from "../types";

const added = ["es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id", "ru", "ar"] as const;
const keys = ["reportActions.copy", "reportActions.download", "reportActions.openSaved",
  "reportActions.copyUnavailable", "reportActions.downloadUnavailable"] as const;
const run: QueryRun = { id: "original/record?x=1", question: "Original <question> {count} 日本語 / हिन्दी",
  answer: "Original answer [S1].", createdAt: "2026-10-29T00:00:00Z", engine: "synthetic", budget: 0,
  totalSpent: 0, totalToCreators: 0, subClaims: [], decisions: [], citations: [], trace: [] };
let root: Root | undefined, container: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; container?.remove(); container = undefined; vi.unstubAllGlobals(); });

it.each(added)("%s binds all5 neutral report controls while keeping financial success notices excluded", async locale => {
  const sourcePath = "locales/en/reports.ts";
  const binding = extractNamespaceCopy(sourcePath, readFileSync(sourcePath, "utf8"));
  const draft = JSON.parse(readFileSync(`locales/${locale}/ui-drafts/reports.json`, "utf8"));
  expect(draft.status).toBe("machineDraft"); expect(draft.review).toBeNull();
  const checked = validateNamespaceDraft(draft, binding, JSON.parse(readFileSync("locales/glossary/en.json", "utf8")));
  const preview = await loadUiPreview(locale);
  for (const key of keys) {
    expect(checked.coveredKeys).toContain(key);
    expect(draft.entries[key].source).toBe(englishMessages[key]);
    expect(draft.entries[key].text).not.toBe(englishMessages[key]);
    expect(preview.$messages[key]).toBe(draft.entries[key].text);
  }
  expect(preview.$messages["reportActions.copied"]).toBeUndefined();
  expect(preview.$messages["reportActions.downloaded"]).toBeUndefined();
  const context = { ...englishUiCopy, locale, preview, message: createMessages(locale, preview.$messages), richMessage: createRichMessages(locale, preview.$messages) };
  const html = renderToStaticMarkup(React.createElement(UiCopyContext.Provider, { value: context }, React.createElement(ReportActions, { run, meta: null, payments: [] })));
  const output = document.createElement("div"); output.innerHTML = html;
  expect([...output.querySelectorAll("button")].map(button => button.textContent)).toEqual(keys.slice(0, 2).map(key => draft.entries[key].text));
  expect(output.querySelector('a[href="/dispatch/original%2Frecord%3Fx%3D1"]')?.textContent).toBe(`${draft.entries["reportActions.openSaved"].text}→`);
  for (const button of output.querySelectorAll("button")) expect(button.querySelector("[lang]")?.getAttribute("lang")).toBe(locale);
});

it("marks the actual financial clipboard confirmation English without changing original report bytes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const writeText = vi.fn(async (_text: string) => {}); vi.stubGlobal("navigator", { clipboard: { writeText } });
  const preview = await loadUiPreview("ja"), before = JSON.stringify(run);
  const context = { ...englishUiCopy, locale: "ja" as const, preview, message: createMessages("ja", preview.$messages), richMessage: createRichMessages("ja", preview.$messages) };
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(React.createElement(UiCopyContext.Provider, { value: context }, React.createElement(ReportActions, { run, meta: null, payments: [] }))));
  await act(async () => container!.querySelector("button")!.click());
  expect(writeText).toHaveBeenCalledOnce(); expect(writeText.mock.calls[0][0]).toBe(researchReportMarkdown(run, null, []));
  const notice = container.querySelector('[role="status"]')!;
  expect(notice.textContent).toBe(englishMessages["reportActions.copied"]);
  expect(notice.querySelector('[lang="en"]')).not.toBeNull();
  expect(JSON.stringify(run)).toBe(before);
});
