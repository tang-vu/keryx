// @vitest-environment jsdom
import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider, useLocale } from "./locale-context";
import { preparedLocales, type UiLocale } from "./locales";
import { UiElement, UiMessage, UiText, useUiCopy, useUiMessages, useUiRichMessages } from "./ui-copy";
import { UiCopyProvider } from "./ui-copy-provider";
import { loadUiPreview } from "./ui-preview-catalogues";
import { setupCopy } from "@/locales/en/get-started";
import { englishMessages } from "./messages";
import { PaperCard } from "@/components/keryx/paper-card";
import type { PaperRecord } from "@/lib/papers/types";

vi.mock("@/components/keryx/paper-save-button", () => ({ PaperSaveButton: () => null }));
const paper: PaperRecord = { title: "What do you want to know?", authors: ["What do you want to know?"], authorCount: 1,
  authorsTruncated: false, repository: "arxiv", arxivId: "2601.00001v1", url: "https://arxiv.org/abs/2601.00001v1",
  metadataUrl: "https://arxiv.org/abs/2601.00001v1", metadataObservedAt: "2026-10-16T00:00:00Z", publicationKind: "preprint", peerReview: "unknown" };

let root: Root, container: HTMLDivElement, mounts: number;
const guest = async () => new Response(null, { status: 401 });
const h = React.createElement;
function Probe() {
  const { locale, ready, status, selectLocale } = useLocale(), copy = useUiMessages(), rich = useUiRichMessages();
  const setup = useUiCopy("get-started", setupCopy);
  useEffect(() => { mounts++; }, []);
  return h("section", null,
    h("output", { id: "locale" }, locale), h("output", { id: "status" }, status),
    h("output", { id: "ready" }, String(ready)),
    ...preparedLocales.map(value => h("button", { key: value, id: value, onClick: () => selectLocale(value) }, value)),
    h("p", { id: "message" }, copy("researchEntry.question")),
    h("p", { id: "object" }, setup.start.title),
    h("p", { id: "leaf" }, h(UiText, { source: setupCopy.start.title, namespaces: ["get-started"] })),
    h("p", { id: "original" }, englishMessages["researchEntry.question"]),
    h("div", { id: "paper" }, h(PaperCard, { group: { id: "paper:original", record: paper, records: [paper] } })),
    h("p", { id: "critical" }, h(UiMessage, { messageKey: "account.signatureInstruction" })),
    h("p", { id: "rich" }, rich("archiveIndex.title", { emphasis: h("strong", null, "Original node") })),
    h(UiElement, { as: "input", names: ["placeholder"], attributes: { id: "draft", defaultValue: "Unsent original draft", placeholder: englishMessages["researchEntry.placeholder"] } }));
}
async function mount(prepareLocale: (locale: UiLocale) => Promise<unknown> = loadUiPreview) {
  await act(async () => root.render(h(LocaleProvider, { enabledLocales: preparedLocales, network: "eip155:5042", fetcher: guest, prepareLocale,
    children: h(UiCopyProvider, { children: h(Probe) }) })));
  await vi.waitFor(() => expect(container.querySelector("#ready")!.textContent).toBe("true"));
}
async function select(locale: UiLocale) { await act(async () => container.querySelector<HTMLButtonElement>(`#${locale}`)!.click()); }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear(); mounts = 0;
  Object.defineProperty(navigator, "languages", { configurable: true, value: ["en"] });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it("changes both server leaves and client copy without remounting, changing originals or submitting a request", async () => {
  await mount();
  const input = container.querySelector<HTMLInputElement>("#draft")!;
  input.value = "Exact unsent question <USDC> {count}";
  for (const locale of ["vi", "zh-Hans", "en"] as const) {
    await select(locale);
    await vi.waitFor(() => expect(container.querySelector("#locale")!.textContent).toBe(locale));
    const message = container.querySelector("#message")!.textContent;
    expect(message === englishMessages["researchEntry.question"]).toBe(locale === "en");
    expect(container.querySelector("#object")!.textContent).toBe(container.querySelector("#leaf")!.textContent);
    expect(container.querySelector("#original")!.textContent).toBe(englishMessages["researchEntry.question"]);
    expect(container.querySelector("#paper h3")!.textContent).toBe(paper.title);
    expect(container.querySelector("#paper p.break-words")!.textContent).toBe(paper.authors[0]);
    expect(container.querySelector("#critical")!.textContent).toBe(englishMessages["account.signatureInstruction"]);
    expect(container.querySelector("#critical span")!.getAttribute("lang")).toBe("en");
    expect(input.value).toBe("Exact unsent question <USDC> {count}");
    expect(container.querySelector("#rich strong")!.textContent).toBe("Original node");
  }
  expect(mounts).toBe(1);
});

it("keeps English on chunk failure, permits retry and ignores a superseded slow target", async () => {
  let fail = true, release!: () => void;
  let delayed = false;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await mount(async locale => {
    if (locale === "vi" && fail) throw Error("Synthetic chunk failure");
    if (locale === "vi" && delayed) await waiting;
    return loadUiPreview(locale);
  });
  await select("vi");
  await vi.waitFor(() => expect(container.querySelector("#status")!.textContent).toBe("loadFailed"));
  expect(container.querySelector("#locale")!.textContent).toBe("en");
  expect(container.querySelector("#status")!.textContent).toBe("loadFailed");
  fail = false; delayed = true;
  await select("vi");
  await select("zh-Hans");
  await vi.waitFor(() => expect(container.querySelector("#locale")!.textContent).toBe("zh-Hans"));
  expect(container.querySelector("#locale")!.textContent).toBe("zh-Hans");
  await act(async () => { release(); await waiting; });
  expect(container.querySelector("#locale")!.textContent).toBe("zh-Hans");
  delayed = false; await select("vi");
  await vi.waitFor(() => expect(container.querySelector("#locale")!.textContent).toBe("vi"));
  expect(container.querySelector("#locale")!.textContent).toBe("vi");
});

it("keeps SVG and option copy as text and renders opaque children without inspecting their props", () => {
  const svg = renderToStaticMarkup(h(UiElement, { as: "svg", names: ["aria-label"], attributes: { "aria-label": "Original label" },
    children: h("text", null, h(UiMessage, { messageKey: "launchBadge.brand", plain: true })) }));
  expect(svg).toBe('<svg aria-label="Original label"><text>Product Hunt</text></svg>');
  expect(renderToStaticMarkup(h("option", null, h(UiText, { source: "English", plain: true })))).toBe("<option>English</option>");
});
