// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageSwitcher } from "@/components/keryx/language-switcher";
import { setupCopy } from "@/locales/en/get-started";
import { LocaleProvider, useLocale } from "./locale-context";
import { preparedLocales, uiLocaleNames } from "./locales";
import { englishMessages } from "./messages";
import { UiCopyProvider } from "./ui-copy-provider";
import { UiMessage, useUiCopy, useUiMessages } from "./ui-copy";
import { getUiPreview, loadUiPreview } from "./ui-preview-catalogues";
import { formatLocalizedUsdc, formatSigningUsdc, formatLocalizedInstant, formatLocalizedNumber } from "./format";

const added = ["es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id", "ru", "ar"] as const;
const h = React.createElement;
let root: Root, container: HTMLDivElement;
const fetcher = vi.fn(async (_path: RequestInfo | URL) => new Response(null, { status: 401 }));
function Probe() {
  const { locale, message } = useLocale(), copy = useUiMessages(), setup = useUiCopy("get-started", setupCopy);
  return h("section", null, h(LanguageSwitcher), h("output", { id: "locale" }, locale),
    h("a", { id: "ask", href: "/#dispatch" }, message("shellNavigation.ask")),
    h("p", { id: "question" }, copy("researchEntry.question")),
    h("h1", null, setup.start.title),
    h("p", { id: "critical" }, h(UiMessage, { messageKey: "account.signatureInstruction" })),
    h("p", { id: "original" }, englishMessages["researchEntry.question"]),
    h("textarea", { defaultValue: "Exact original <question> {count} USDC" }));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear(); fetcher.mockClear();
  Object.defineProperty(navigator, "languages", { configurable: true, value: ["en"] });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it("switches every added native-language option and preserves originals, drafts, links and critical English", async () => {
  await act(async () => root.render(h(LocaleProvider, { enabledLocales: preparedLocales, prepareLocale: loadUiPreview,
    fetcher, network: "eip155:5042", children: h(UiCopyProvider, { children: h(Probe) }) })));
  await vi.waitFor(() => expect(container.querySelector("select")!.disabled).toBe(false));
  const input = container.querySelector("textarea")!, select = container.querySelector("select")!;
  input.value = "Unsent 日本語 हिन्दी <original> {count} USDC";
  for (const locale of [...added, "en"] as const) {
    expect([...select.options].find(option => option.value === locale)?.textContent).toBe(uiLocaleNames[locale]);
    await act(async () => { select.value = locale; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await vi.waitFor(() => expect(container.querySelector("#locale")!.textContent).toBe(locale));
    const draft = locale === "en" ? null : JSON.parse(readFileSync(`locales/${locale}/ui-drafts/core-inline.json`, "utf8"));
    expect(container.querySelector("#question")!.textContent).toBe(draft?.entries["researchEntry.question"].text ?? englishMessages["researchEntry.question"]);
    expect(container.querySelector("#ask")!.textContent === englishMessages["shellNavigation.ask"]).toBe(locale === "en");
    expect(container.querySelector("h1")!.textContent === setupCopy.start.title).toBe(locale === "en");
    expect(container.querySelector("#original")!.textContent).toBe(englishMessages["researchEntry.question"]);
    expect(container.querySelector("#critical")!.textContent).toBe(englishMessages["account.signatureInstruction"]);
    expect(container.querySelector("#ask")!.getAttribute("href")).toBe("/#dispatch");
    expect(container.querySelector("textarea")).toBe(input);
    expect(input.value).toBe("Unsent 日本語 हिन्दी <original> {count} USDC");
    if (locale !== "en") {
      const preview = getUiPreview(locale);
      expect(preview["ui-preference"]["Preview: machine draft, not human reviewed. Some interface text remains in English. Critical payment, consent and legal text stays in English."]).toBeTruthy();
      expect(preview.$messages["account.signatureInstruction"]).toBeUndefined();
      expect(preview.$messages["researchEntry.sessionNotice"]).toBeUndefined();
    }
  }
  expect(fetcher.mock.calls.every(args => String(args[0]) === "/api/auth/session")).toBe(true);
});

it.each(added)("formats %s without changing monetary precision, signing text or time evidence", locale => {
  const decimal = ["es", "pt-BR", "fr", "de", "id", "ru"].includes(locale) ? "," : ".";
  expect(formatLocalizedUsdc("9007199254740991", locale)).toMatch(/740991 USDC$/u);
  expect(formatLocalizedUsdc(1, locale)).toBe(`0${decimal}000001 USDC`);
  expect(formatLocalizedUsdc(49, locale)).toBe(`0${decimal}000049 USDC`);
  expect(formatLocalizedUsdc("9007199254740992", locale)).toBe("Amount unavailable");
  expect(formatSigningUsdc("9007199254740991")).toBe("9007199254.740991 USDC");
  expect(formatLocalizedInstant("2026-10-28T12:34:56Z", locale)).not.toBe("Unavailable");
  expect(formatLocalizedNumber(1234567.5, locale)).not.toBe("Unavailable");
});

it("binds every generated preview and shell chunk to the actual source and draft inputs", () => {
  expect(() => execFileSync(process.execPath, ["scripts/generate-ui-previews.mjs", "--check"], { stdio: "pipe" })).not.toThrow();
});
