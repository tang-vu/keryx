// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { UiText } from "./ui-copy";
import { UiCopyContext, englishUiCopy } from "./ui-copy-context";
import type { UiLocale } from "./locales";

function render(source: string, text: string, literals: readonly string[], locale: UiLocale = "ar", plain = false) {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(React.createElement(UiCopyContext.Provider,
    { value: { ...englishUiCopy, locale, preview: { setup: { [source]: text } } } },
    React.createElement(UiText, { source, namespaces: ["setup"], literals, plain })));
  return root;
}

it("isolates repeated authored installation tokens without changing translated text", () => {
  const source = "Open -setup.exe or inspect -setup.exe.", text = "افتح -setup.exe أو افحص -setup.exe.";
  const root = render(source, text, ["-setup.exe", "-setup.exe", ""]);
  expect(root.textContent).toBe(text);
  expect(root.firstElementChild?.getAttribute("lang")).toBe("ar");
  expect(root.firstElementChild?.getAttribute("dir")).toBe("rtl");
  const tokens = [...root.querySelectorAll("bdi")];
  expect(tokens.map(token => token.textContent)).toEqual(["-setup.exe", "-setup.exe"]);
  for (const token of tokens) {
    expect(token.getAttribute("lang")).toBe("en"); expect(token.getAttribute("dir")).toBe("ltr");
    expect(token.style.display).toBe("inline-block"); expect(token.style.whiteSpace).toBe("nowrap");
  }
});

it("accepts only source tokens, prefers complete overlapping tokens and escapes literal markup", () => {
  const source = "Open [x].json <literal>.", text = "افتح [x].json <literal> و injected.exe.";
  const root = render(source, text, ["x].json", "[x].json", "<literal>", "injected.exe"]);
  expect(root.textContent).toBe(text);
  expect([...root.querySelectorAll("bdi")].map(token => token.textContent)).toEqual(["[x].json", "<literal>"]);
  expect(root.querySelector("literal")).toBeNull();
});

it("keeps original English fallback intact without parsing its literal tokens", () => {
  const source = "Open manifest.json.";
  const root = render(source, source, ["manifest.json"]);
  expect(root.textContent).toBe(source); expect(root.querySelector("bdi")).toBeNull();
  expect(root.firstElementChild?.getAttribute("lang")).toBe("en");
  expect(root.firstElementChild?.getAttribute("dir")).toBe("ltr");
});

it("preserves plain and English rendering without introducing element wrappers", () => {
  const source = "Open manifest.json.", translated = "افتح manifest.json.";
  for (const [locale, plain, expected] of [["en", false, translated], ["ar", true, translated]] as const) {
    const root = render(source, translated, ["manifest.json"], locale, plain);
    expect(root.textContent).toBe(expected); expect(root.children).toHaveLength(0);
  }
});
