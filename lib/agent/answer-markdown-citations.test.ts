// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnswerMarkdown } from "@/components/keryx/answer-markdown";
import type { Citation } from "@/lib/types";

const citation: Citation = {
  marker: "S1", sourceId: "inline-fixture", sourceName: "Inline fixture",
  weight: 1, reward: 0, rationale: "Synthetic rendering fixture, no payment authority.",
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

async function render(text: string) {
  const onCitationClick = vi.fn();
  await act(async () => {
    root.render(createElement(AnswerMarkdown, { text, citations: [citation], language: "en", onCitationClick }));
  });
  return onCitationClick;
}

describe("inline citations and formatting", () => {
  it.each(["[S1]", "const marker = '[S1]';", "**literal** *literal* [S999]"])(
    "keeps citation-like code literal: %j", async code => {
      const onCitationClick = await render(`Use \`${code}\` as literal text; evidence [S1].`);
      expect(container.querySelector("code")?.textContent).toBe(code);
      expect(container.querySelectorAll("button")).toHaveLength(1);
      expect(container.querySelectorAll("strong, em")).toHaveLength(0);
      const button = container.querySelector("button")!;
      await act(async () => { button.click(); });
      expect(onCitationClick).toHaveBeenCalledExactlyOnceWith("S1", button);
    },
  );

  it.each([
    { text: "**Supported [S1] statement**", tag: "strong", expected: "Supported [1] statement" },
    { text: "*Supported [S1] statement*", tag: "em", expected: "Supported [1] statement" },
    { text: "**[S1]**", tag: "strong", expected: "[1]" },
    { text: "*First [S1], second [S1]*", tag: "em", expected: "First [1], second [1]" },
  ])("keeps evidence controls inside $tag", async ({ text, tag, expected }) => {
    const onCitationClick = await render(text);
    const wrapper = container.querySelector(tag)!;
    expect(wrapper?.textContent).toBe(expected);
    expect(container.textContent).toBe(expected);
    const buttons = wrapper.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.getAttribute("aria-label")).toContain(citation.sourceName);
      await act(async () => { button.click(); });
      expect(onCitationClick).toHaveBeenLastCalledWith("S1", button);
    }
    expect(onCitationClick).toHaveBeenCalledTimes(buttons.length);
  });

  it("preserves literal grounded quotes and their language around formatted citations", async () => {
    await render("**Review [S1]** before “Use *\u200bliteral*\u200b and [\u200bS99]”.");
    expect(container.querySelector("strong")?.textContent).toBe("Review [1]");
    expect(container.querySelector('[lang="und"]')?.textContent).toBe("“Use *\u200bliteral*\u200b and [\u200bS99]”");
    expect(container.firstElementChild?.getAttribute("lang")).toBe("en");
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.querySelectorAll("em, code")).toHaveLength(0);
  });

  it("keeps compact references readable without exposing inert evidence controls", async () => {
    await act(async () => {
      root.render(createElement(AnswerMarkdown, { text: "**Finding [S1]**; literal `[S1]`.", citations: [citation] }));
    });
    expect(container.querySelector("strong")?.textContent).toBe("Finding [1]");
    expect(container.querySelector("code")?.textContent).toBe("[S1]");
    expect(container.querySelector('[title]')?.getAttribute("title")).toContain(citation.sourceName);
    expect(container.querySelectorAll("button, a, [tabindex]")).toHaveLength(0);
  });
});
