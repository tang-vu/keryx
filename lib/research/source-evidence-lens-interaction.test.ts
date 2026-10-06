import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { SourceEvidenceLens } from "../../components/keryx/source-evidence-lens";
import type { EvidenceMatrixInput } from "./evidence-matrix";

describe("source inspection local interaction", () => {
  it("selects, restores and survives changed evidence without a network request or report mutation", async () => {
    const dom = new JSDOM('<div id="root"></div>');
    vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const fetch = vi.fn(() => { throw new Error("No network allowed"); }); vi.stubGlobal("fetch", fetch);
    const container = dom.window.document.getElementById("root")!;
    const root = createRoot(container);
    const run: EvidenceMatrixInput = { subClaims: ["Audit log?"], citations: [{ marker: "A", sourceId: "A", sourceName: "Source A", weight: 1, reward: 0, rationale: "" }],
      evidence: [{ claimIndex: 0, claim: "Audit log?", marker: "A", sourceId: "A", sourceName: "Source A", quote: "Recorded audit excerpt.", support: 0.8, qualifiesForAnswer: true, qualifiesForReward: false }] };
    const original = JSON.stringify(run);
    try {
      await act(async () => { root.render(createElement(SourceEvidenceLens, { run })); });
      const select = container.querySelector("select")!;
      await act(async () => { select.value = "A"; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
      expect(container.textContent).toContain("1 research target loses its last recorded excerpt without Source A");
      const restore = container.querySelector("button") as HTMLButtonElement;
      restore.focus(); expect(dom.window.document.activeElement).toBe(restore);
      await act(async () => { restore.click(); });
      expect(container.textContent).toContain("Showing the original excerpt ledger.");
      expect(container.textContent).toContain("Recorded audit excerpt.");
      expect(container.querySelector("select")!.value).toBe("");
      expect(dom.window.document.activeElement).toBe(select);
      await act(async () => { select.value = "A"; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
      await act(async () => { root.render(createElement(SourceEvidenceLens, { run: { ...run, evidence: [] } })); });
      expect(container.textContent).toContain("No inspectable non-demo excerpts");
      expect(container.querySelector("select")).toBeNull();
      await act(async () => { root.render(createElement(SourceEvidenceLens, { run })); });
      expect(container.querySelector("select")!.value).toBe("");
      expect(container.textContent).toContain("Showing the original excerpt ledger.");
      expect(fetch).not.toHaveBeenCalled(); expect(JSON.stringify(run)).toBe(original);
    } finally {
      await act(async () => { root.unmount(); }); dom.window.close(); vi.unstubAllGlobals();
    }
  });
});
