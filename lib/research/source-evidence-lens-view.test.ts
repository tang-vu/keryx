import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceEvidenceLensView } from "../../components/keryx/source-evidence-lens";
import type { SourceEvidenceLensModel } from "./source-evidence-lens";

const model = (): SourceEvidenceLensModel => ({ available: true, omittedSourceId: "A", sources: [{ sourceId: "A", sourceName: "Source A" }],
  newlyMissingTargets: 1, alreadyMissingTargets: 1, rows: [
    { claimIndex: 0, claim: "Export?", originalExcerpts: 1, remaining: [], state: "lost-last-excerpt" },
    { claimIndex: 1, claim: "Pricing?", originalExcerpts: 0, remaining: [], state: "already-missing" },
  ] });
const render = (value: SourceEvidenceLensModel) => renderToStaticMarkup(createElement(SourceEvidenceLensView, { model: value, selectId: "lens", onOmit: () => {} }));

describe("source inspection presentation", () => {
  it("labels local omission and old gaps without declaring assertions false", () => {
    const html = render(model());
    expect(html).toContain("1 research target loses its last recorded excerpt without Source A.");
    expect(html).toContain("1 target already had no inspectable excerpts.");
    expect(html).toContain("No excerpts remain in this view.");
    expect(html).toContain("No inspectable excerpts in the original report.");
    expect(html).toContain('for="lens"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("answer, confidence and payments unchanged");
  });
  it("selects and resets the local source without a browser, request or payment call", () => {
    const values: (string | null)[] = [];
    const tree = SourceEvidenceLensView({ model: model(), selectId: "lens", onOmit: value => values.push(value) });
    const controls: { type: unknown; props: Record<string, unknown> }[] = [];
    function visit(node: unknown) {
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (!node || typeof node !== "object" || !("props" in node)) return;
      const element = node as { type: unknown; props: Record<string, unknown> };
      controls.push(element); visit(element.props.children);
    }
    visit(tree);
    const select = controls.find(element => element.type === "select")!;
    (select.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "A" } });
    (select.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "" } });
    const button = controls.find(element => element.type === "button")!;
    (button.props.onClick as () => void)();
    expect(values).toEqual(["A", null, null]);
  });
  it("shows unavailable and empty states without selectable source controls", () => {
    const unavailable = render({ ...model(), available: false });
    expect(unavailable).toContain("no stored excerpt ledger"); expect(unavailable).not.toContain("<select");
    const empty = render({ ...model(), sources: [] });
    expect(empty).toContain("No inspectable non-demo excerpts"); expect(empty).not.toContain("<select");
  });
  it("escapes recorded content instead of rendering source markup", () => {
    const value = model(); value.sources[0].sourceName = "<script>attack()</script>";
    value.rows[0].claim = "<img onerror=attack()>";
    const html = render(value);
    expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img"); expect(html).not.toContain("<img");
  });
});
