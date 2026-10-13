// @vitest-environment jsdom
// Real React editor state; synthetic supplied report, no Next server or external I/O.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvidenceDraftWorkspace } from "@/components/keryx/evidence-draft-workspace";
import { downloadBrowserText } from "@/lib/browser-text-download";
import { evidenceDraftFixture } from "@/lib/research/fixtures/evidence-draft";
import { buildEvidenceDraft } from "@/lib/research/evidence-draft";
import { evidenceDraftCopy as copy } from "@/lib/research/evidence-draft-copy";

let workspace = evidenceDraftFixture().workspace;
vi.mock("@/lib/papers/literature-browser-store", () => ({ useLiteratureWorkspace: () => ({ ready: true, workspace }) }));
vi.mock("@/lib/browser-text-download", () => ({ downloadBrowserText: vi.fn() }));

let root: Root, container: HTMLDivElement;
const articles = () => [...container.querySelectorAll("article")];
const control = <T extends HTMLElement>(scope: ParentNode, label: string) => {
  const row = [...scope.querySelectorAll("label")].find(row => row.textContent?.trim().startsWith(label));
  if (!row) throw new Error(`Missing control: ${label}`);
  return row.querySelector<T>("input, textarea, select")!;
};
const group = (scope: ParentNode, legend: string) => {
  const row = [...scope.querySelectorAll("fieldset")].find(row => row.querySelector("legend")?.textContent === legend);
  if (!row) throw new Error(`Missing group: ${legend}`);
  return row;
};
const click = async (scope: ParentNode, name: string) => {
  const button = [...scope.querySelectorAll("button")].find(row => row.textContent === name);
  if (!button) throw new Error(`Missing button: ${name}`);
  expect(button.disabled).toBe(false);
  await act(async () => { button.click(); });
};
const fill = async (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
};
const check = async (element: HTMLInputElement) => { await act(async () => { element.click(); }); expect(element.checked).toBe(true); };

beforeEach(async () => {
  workspace = evidenceDraftFixture().workspace;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No I/O admitted in the editor regression"); }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(<EvidenceDraftWorkspace />); });
  await fill(control<HTMLTextAreaElement>(container, copy.import.label), JSON.stringify(evidenceDraftFixture().reports[0]));
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(container.textContent).toContain("matching retained excerpts: 1");
});
afterEach(async () => {
  await act(async () => { root.unmount(); }); container.remove(); vi.clearAllMocks(); vi.unstubAllGlobals();
});

describe("unfinished non-target editor statements", () => {
  for (const mode of ["append", "regenerate"] as const) it.each(["", " \n\t "])(`${mode} preserves an unfinished row with text %j`, async unfinishedText => {
    await fill(control<HTMLTextAreaElement>(container, copy.claim.passage), "Preserve these passage bytes.");
    await fill(control<HTMLTextAreaElement>(articles()[0], copy.theme.notes), "Keep other human notes.");
    await click(container, copy.theme.add);
    await click(articles()[0], copy.statement.add);
    await fill(control<HTMLSelectElement>(articles()[0], copy.statement.kind), "gap");
    await fill(control<HTMLTextAreaElement>(articles()[0], copy.statement.text), unfinishedText);
    await check(group(articles()[0], copy.statement.papers).querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    await check(group(articles()[0], copy.statement.excerpts).querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    if (mode === "regenerate") {
      await check(articles()[1].querySelector<HTMLInputElement>('input[type="checkbox"]')!);
      await click(articles()[1], copy.theme.regenerate);
    } else await click(container, copy.theme.assemble);
    expect(articles()).toHaveLength(mode === "append" ? 3 : 2);
    expect(control<HTMLTextAreaElement>(articles()[0], copy.statement.text).value).toBe(unfinishedText);
    expect(control<HTMLSelectElement>(articles()[0], copy.statement.kind).value).toBe("gap");
    expect(group(articles()[0], copy.statement.papers).querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
    expect(group(articles()[0], copy.statement.excerpts).querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
    expect(control<HTMLTextAreaElement>(articles()[0], copy.theme.notes).value).toBe("Keep other human notes.");
    expect(control<HTMLTextAreaElement>(container, copy.claim.passage).value).toBe("Preserve these passage bytes.");
    await click(container, copy.download.backup);
    const packet = JSON.parse(vi.mocked(downloadBrowserText).mock.calls.at(-1)![0]);
    expect(packet.themes[0]).not.toHaveProperty("statements");
    expect(packet.reports).toEqual(evidenceDraftFixture().reports);
    expect(buildEvidenceDraft(packet).references).toHaveLength(1);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
