// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CitationEvidencePanel } from "../../components/keryx/citation-evidence-panel";
import type { Citation, EvidenceRecord } from "../types";
import { englishMessages } from "../i18n/messages";

const citation: Citation = { marker: "S1", sourceId: "publisher", sourceName: "Publisher", itemId: "paper",
  itemUrl: "https://publisher.example/paper?v=2", contentVersion: "sha256:version-two", weight: 1, reward: 0, rationale: "" };
const excerpt = (fields: Partial<EvidenceRecord> = {}): EvidenceRecord => ({ ...citation,
  claimIndex: 0, claim: "Measured result?", quote: "The exact selected article's excerpt.", support: 0.8,
  qualifiesForAnswer: true, qualifiesForReward: false, ...fields });

let root: Root, container: HTMLDivElement;
const dialogPrototype = HTMLDialogElement.prototype;
const originalMethods = ["showModal", "close"].map(name => [name, Object.getOwnPropertyDescriptor(dialogPrototype, name)] as const);
beforeAll(() => {
  // The native modal and scroll APIs are outside this quote-selection regression.
  Object.defineProperty(dialogPrototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(dialogPrototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.open = false; } });
});
afterAll(() => {
  for (const [name, descriptor] of originalMethods) {
    if (descriptor) Object.defineProperty(dialogPrototype, name, descriptor);
    else Reflect.deleteProperty(dialogPrototype, name);
  }
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("No network admitted in citation inspection tests"); }));
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); }); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function inspect(selected: Citation, evidence: EvidenceRecord[]) {
  const before = JSON.stringify({ selected, evidence });
  await act(async () => { root.render(createElement(CitationEvidencePanel, {
    queryId: "same-report", citation: selected, evidence, payments: [], onClose: () => {},
  })); });
  expect(JSON.stringify({ selected, evidence })).toBe(before);
  return document.querySelector("dialog")!;
}

describe("rendered citation evidence identity", () => {
  it.each([
    { itemId: "another-paper" },
    { itemUrl: "https://publisher.example/paper?v=1" },
    { itemUrl: "https://copied.example/paper?v=2" },
    { contentVersion: "sha256:version-one" },
    { itemUrl: undefined },
    { itemId: undefined },
    { contentVersion: undefined },
    { marker: "S2" },
    { sourceId: "another-publisher" },
  ])("excludes the other article/version when the selected identity is %j", async mismatch => {
    const matching = excerpt(), other = excerpt({ ...mismatch, quote: "A different article or version's excerpt." });
    const dialog = await inspect(citation, [matching, other]);
    expect([...dialog.querySelectorAll("blockquote")].map(row => row.textContent)).toEqual([`“${matching.quote}”`]);
    expect(dialog.textContent).not.toContain(other.quote);
    expect(dialog.querySelector<HTMLAnchorElement>('a[href="https://publisher.example/paper?v=2"]')).not.toBeNull();
  });

  it("shows the existing no-excerpt state instead of borrowing a mismatched quote", async () => {
    const other = excerpt({ contentVersion: "sha256:version-one" });
    const dialog = await inspect(citation, [other]);
    expect(dialog.querySelectorAll("blockquote")).toHaveLength(0);
    expect(dialog.textContent).toContain(englishMessages["citationEvidence.noExcerpt"]);
    expect(dialog.textContent).toContain(englishMessages["citationEvidence.noSettledPayment"]);
  });

  it("preserves old matching records with no article identity on either side", async () => {
    const selected = { ...citation }, matching = excerpt();
    for (const item of [selected, matching]) { delete item.itemId; delete item.itemUrl; delete item.contentVersion; }
    const dialog = await inspect(selected, [matching]);
    expect(dialog.querySelector("blockquote")?.textContent).toBe(`“${matching.quote}”`);
  });

  it("keeps answer-only public evidence and explicit rejection semantics", async () => {
    const matching = excerpt(), rejected = excerpt({ quote: "Rejected excerpt", qualifiesForAnswer: false, qualifiesForReward: true });
    const dialog = await inspect({ ...citation, sourceKind: "public-reference" }, [matching, rejected]);
    expect([...dialog.querySelectorAll("blockquote")].map(row => row.textContent)).toEqual([`“${matching.quote}”`]);
    expect(dialog.textContent).not.toContain(englishMessages["citationEvidence.reward"]);
  });
});
