// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EvidenceDraftRestore } from "@/components/keryx/evidence-draft-restore";
import { CompletedEvidenceDraftSelector } from "@/components/keryx/completed-evidence-draft-selector";
import { CompletedEvidenceDraftImport } from "@/components/keryx/completed-evidence-draft-import";
import { evidenceDraftRestoreCopy as restore } from "@/locales/en/evidence-draft-restore";
import { completedEvidenceDraftSelectionCopy as selection, completedEvidenceDraftImportCopy as importer } from "@/locales/en/completed-evidence-draft-selection";
import { evidenceDraftFixture } from "@/lib/research/fixtures/evidence-draft";
import { UiCopyContext, englishUiCopy } from "./ui-copy-context";
import type { UiLocale } from "./locales";

let root: Root, container: HTMLDivElement;
const workspace = evidenceDraftFixture().workspace;
const owner = `0x${"1".repeat(40)}`, id = `prv_${"a".repeat(64)}`;
const onImport = vi.fn(() => true), onRestore = vi.fn(() => true);
const messages = { "evidence-draft-restore": Object.values(restore), "completed-evidence-draft-selection": [...Object.values(selection), ...Object.values(importer)] };
function preview(locale: UiLocale) {
  return locale === "en" ? {} : Object.fromEntries(Object.entries(messages).map(([namespace, values]) =>
    [namespace, Object.fromEntries(values.filter(text => !text.includes("{")).map(text => [text, `${locale}: ${text}`]))]));
}
async function render(child: ReactNode, locale: UiLocale = "en") {
  await act(async () => root.render(createElement(UiCopyContext.Provider, { value: { ...englishUiCopy, locale, preview: preview(locale) } }, child)));
}
const restoreChild = (context = workspace) => createElement(EvidenceDraftRestore, { context, onRestore, onSave: vi.fn(), canSave: true });
const selectorChild = () => createElement(CompletedEvidenceDraftSelector, { workspace, onImport });
const importChild = () => createElement(CompletedEvidenceDraftImport, { workspace, onImport, currentOwner: owner, baseUrl: window.location.origin, network: "eip155:5042",
  selection: { id, savedAt: "2026-10-12T02:00:00Z", snapshotSha256: `sha256:${"b".repeat(64)}`, question: "Exact original question", budget: 0.05, researchMode: "deep",
    sources: [{ sourceId: "paper", itemId: "v1", itemUrl: workspace.entries[0].paper.url, contentVersion: `sha256:${"c".repeat(64)}` }] } });
async function click() { await act(async () => container.querySelector("button")!.click()); }
async function job() {
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, id);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function choose(read: Promise<ArrayBuffer>) {
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.defineProperty(input, "files", { configurable: true, value: [{ name: "Original العربية {title}.json", size: 2, arrayBuffer: () => read }] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const status = () => container.querySelector('[role="status"]')!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No request admitted without an explicit action"); }));
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

it("translates a delayed backup refusal at render and retranslates the retained status", async () => {
  const read = deferred<ArrayBuffer>();
  await render(restoreChild()); await choose(read.promise); await render(restoreChild(), "de");
  await act(async () => read.resolve(new TextEncoder().encode("{}").buffer));
  expect(status().textContent).toBe(`de: ${restore.refused}`);
  await render(restoreChild(), "ar"); expect(status().textContent).toBe(`ar: ${restore.refused}`);
  expect(onRestore).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

it("translates stale-context refusal after a delayed file read without restoring", async () => {
  const read = deferred<ArrayBuffer>();
  await render(restoreChild()); await choose(read.promise); await render(restoreChild({ ...workspace }), "ar");
  await act(async () => read.resolve(new TextEncoder().encode(JSON.stringify(evidenceDraftFixture())).buffer));
  expect(status().textContent).toBe(`ar: ${restore.stale}`); expect(onRestore).not.toHaveBeenCalled();
});

it("uses the current locale for an auth listener installed in an earlier locale, without reading", async () => {
  await render(selectorChild()); await render(selectorChild(), "ar");
  await act(async () => window.dispatchEvent(new Event("keryx:auth")));
  expect(status().textContent).toBe(`ar: ${selection.changed}`); expect(fetch).not.toHaveBeenCalled();
  await render(selectorChild(), "de"); expect(status().textContent).toBe(`de: ${selection.changed}`);
});

it("translates a metadata refusal after switching locale without restarting the private read", async () => {
  const response = deferred<Response>(); vi.mocked(fetch).mockReturnValue(response.promise);
  await render(selectorChild()); await job(); await click(); await render(selectorChild(), "de");
  await act(async () => response.resolve(new Response(null, { status: 401 })));
  expect(status().textContent).toBe(`de: ${selection.signIn}`); expect(fetch).toHaveBeenCalledTimes(1);
  expect(onImport).not.toHaveBeenCalled();
});

it("translates a timed-out metadata read after switching locale", async () => {
  vi.useFakeTimers(); vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  await render(selectorChild()); await job(); await click(); await render(selectorChild(), "ar");
  await act(async () => vi.advanceTimersByTimeAsync(15001));
  expect(status().textContent).toBe(`ar: ${selection.timedOut}`); expect(fetch).toHaveBeenCalledTimes(1);
});

it("translates a delayed private import refusal and retained status without importing", async () => {
  const response = deferred<Response>(); vi.mocked(fetch).mockReturnValue(response.promise);
  await render(importChild()); await click(); await render(importChild(), "ar");
  await act(async () => response.resolve(new Response(null, { status: 403 })));
  expect(status().textContent).toBe(`ar: ${importer.unavailable}`);
  await render(importChild(), "de"); expect(status().textContent).toBe(`de: ${importer.unavailable}`);
  expect(onImport).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(1);
});

it("marks held English fallback and original backup data independently inside Arabic", async () => {
  await render(restoreChild(), "ar"); await choose(Promise.resolve(new TextEncoder().encode(JSON.stringify(evidenceDraftFixture())).buffer));
  const summary = [...container.querySelectorAll("p")].find(node => node.textContent?.includes("included papers"))!;
  expect(summary.querySelector('[lang="en"][dir="ltr"]')).not.toBeNull();
  const filename = container.querySelector('bdi[translate="no"]');
  expect(filename?.textContent).toBe(workspace.title);
  expect(container.textContent).toContain("Original العربية {title}.json"); expect(fetch).not.toHaveBeenCalled();
});

it("marks private job IDs as original left-to-right technical data", async () => {
  await render(selectorChild(), "ar"); await job(); const input = container.querySelector("input")!;
  expect(input.value).toBe(id); expect(input.dir).toBe("ltr"); expect(input.translate).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
