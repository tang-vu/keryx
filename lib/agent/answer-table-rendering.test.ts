// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AnswerMarkdown } from "../../components/keryx/answer-markdown";
import { answerTableMarkdown } from "../research/answer-table-presentation";

it("renders semantic columns, exact literal source content and only actual evidence controls", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"), root = createRoot(container), click = vi.fn();
  const quote = 'Literal | **bold** `code` [S99] <img src=x> & symbols.';
  const text = answerTableMarkdown({ columns: ["Source", "Finding"], incomplete: false, rows: [[{ kind: "label", text: "A | B" },
    { kind: "facts", statements: [{ claimIndex: 0, marker: "S1", quote, text: "The synthetic source describes literal notation." }] }]] }, "en");
  try {
    await act(async () => root.render(createElement(AnswerMarkdown, { text, citations: [{ marker: "S1", sourceId: "synthetic", sourceName: "Synthetic source", weight: 1, reward: 0, rationale: "Fixture" }], onCitationClick: click })));
    expect(container.querySelectorAll("table")).toHaveLength(1); expect(container.querySelectorAll('th[scope="col"]')).toHaveLength(2);
    expect(container.querySelectorAll("td")).toHaveLength(2); expect(container.querySelector('div[tabindex="0"]')).not.toBeNull();
    expect(container.textContent?.replaceAll("\u200b", "")).toContain(quote); expect(container.querySelectorAll("strong,em,code,img")).toHaveLength(0);
    const buttons = container.querySelectorAll("button"); expect(buttons).toHaveLength(1);
    await act(async () => buttons[0].click()); expect(click).toHaveBeenCalledExactlyOnceWith("S1", buttons[0]);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
