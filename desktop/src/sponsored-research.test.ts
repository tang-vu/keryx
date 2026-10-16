import { JSDOM } from "jsdom";
import React, { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopAPI, SponsoredResearchOutcome, SponsoredResearchResult, WorkspaceView } from "./contracts";
import { SponsoredResearch, sponsoredReportUrl, SPONSORED_WAIT_NOTICE_MS } from "./sponsored-research";

const mounted = vi.hoisted(() => ({ root: null as Root | null }));
vi.mock("react-dom/client", async importOriginal => {
  const original = await importOriginal<typeof import("react-dom/client")>();
  return { ...original, createRoot: (...args: Parameters<typeof original.createRoot>) => {
    const root = original.createRoot(...args); mounted.root = root; return root;
  } };
});

const queryId = "11111111-1111-4111-8111-111111111111";
const result: SponsoredResearchResult = {
  answer: 'Plain answer <img src="https://other.invalid/pixel"> [1]', queryId,
  dispatchUrl: `https://keryx.cc/dispatch/${queryId}`,
  citations: [{ sourceName: "Public source", sourceUrl: "https://example.org/source" }],
  paymentMode: "real", creatorRewardAllocations: [{ status: "pending", amount: 0.01 }],
};

describe("native sponsored research UI", () => {
  let dom: JSDOM;
  let api: DesktopAPI;
  let research: ReturnType<typeof vi.fn<DesktopAPI["researchSponsored"]>>;
  beforeEach(() => {
    vi.resetModules();
    dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/" });
    vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    research = vi.fn<DesktopAPI["researchSponsored"]>(async () => ({ ok: true, result }));
    api = { researchSponsored: research, refresh: vi.fn(async () => null),
      chooseWorkspace: vi.fn(async () => null), createWorkspace: vi.fn(async () => null),
      createTask: vi.fn(async () => { throw Error("No local creation"); }),
      resumeTask: vi.fn(async () => { throw Error("No local resume"); }), readResult: vi.fn(async () => null),
      exportBrief: vi.fn(async () => false), exportTask: vi.fn(async () => false), importReference: vi.fn(async () => null) };
    (dom.window as unknown as Window).keryxDesktop = api;
  });
  afterEach(async () => {
    await act(async () => mounted.root?.unmount()); mounted.root = null;
    dom.window.close(); vi.useRealTimers(); vi.unstubAllGlobals();
  });
  const find = <T extends Element>(selector: string) => dom.window.document.querySelector<T>(selector)!;
  async function mount() {
    const { createRoot } = await import("react-dom/client");
    await act(async () => createRoot(find("#root")).render(React.createElement(SponsoredResearch, { api })));
  }
  async function type(selector: string, value: string) {
    const element = find<HTMLInputElement | HTMLTextAreaElement>(selector);
    const prototype = element.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
      element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  }
  async function consent() { await act(async () => find<HTMLInputElement>('input[type="checkbox"]').click()); }
  function submit() { find(".sponsored-screen form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); }
  async function fill() { await type(".sponsored-screen textarea", "A public question"); await type('input[type="number"]', "0"); await consent(); }

  it("requires a typed shareable question and explicit public intent, preserving zero budget and Deep", async () => {
    await mount();
    expect(find<HTMLTextAreaElement>("textarea").value).toBe("");
    expect(find<HTMLInputElement>('input[type="number"]').value).toBe("0.05");
    expect(find<HTMLInputElement>('input[type="checkbox"]').checked).toBe(false);
    await act(async () => submit()); expect(research).not.toHaveBeenCalled();
    await type("textarea", "A public question");
    await type('input[type="number"]', "0");
    await act(async () => submit()); expect(research).not.toHaveBeenCalled();
    await consent();
    await act(async () => find<HTMLInputElement>('input[value="deep"]').click());
    await act(async () => submit());
    expect(research).toHaveBeenCalledExactlyOnceWith({ question: "A public question", mode: "deep", budget: 0, publicReport: true });
    expect(find<HTMLInputElement>('input[type="checkbox"]').checked).toBe(false);
  });

  it("locks synchronously against duplicate submissions and retains the lock at a renderer deadline", async () => {
    let finish!: (outcome: SponsoredResearchOutcome) => void;
    research.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await mount(); await fill(); vi.useFakeTimers();
    await act(async () => { submit(); submit(); });
    expect(research).toHaveBeenCalledTimes(1);
    expect(find<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    await act(async () => { vi.advanceTimersByTime(SPONSORED_WAIT_NOTICE_MS); submit(); });
    expect(research).toHaveBeenCalledTimes(1);
    expect(dom.window.document.body.textContent).toContain("hosted request may still be running");
    await act(async () => finish({ ok: true, result }));
    expect(find<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true); // New explicit public intent required.
    expect(dom.window.document.body.textContent).not.toContain("Still waiting for confirmation");
    await consent(); expect(find<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
  });

  it("shows plain text, canonical public URLs and honest receipt labels without claiming settlement", async () => {
    await mount(); await fill(); await act(async () => submit());
    expect(find(".sponsored-result .answer p").textContent).toBe(result.answer);
    expect(dom.window.document.querySelector(".sponsored-result img")).toBeNull();
    const urls = [...dom.window.document.querySelectorAll<HTMLInputElement>(".sponsored-url input")].map(input => input.value);
    expect(urls).toEqual(["https://example.org/source", result.dispatchUrl]);
    expect(dom.window.document.body.textContent).toContain("Pending or planned rewards are not settled payments");
    const report = find<HTMLInputElement>(".sponsored-report input");
    await act(async () => find<HTMLButtonElement>(".sponsored-report button").click());
    expect(report.selectionStart).toBe(0); expect(report.selectionEnd).toBe(result.dispatchUrl.length);
    for (const [name, call] of Object.entries(api)) if (name !== "researchSponsored") expect(call).not.toHaveBeenCalled();
  });

  it("shows a confirmed refusal and requires new public intent before a deliberate fresh request", async () => {
    research.mockResolvedValue({ ok: false, uncertain: false, message: "Sponsored quota is exhausted (HTTP 429)." });
    await mount(); await fill(); await act(async () => submit());
    expect(find('[role="alert"]').textContent).toContain("Sponsored quota is exhausted");
    expect(dom.window.document.body.textContent).not.toContain("Completion is uncertain");
    expect(find<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    await consent(); expect(find<HTMLButtonElement>('button[type="submit"]').disabled).toBe(false);
    expect(research).toHaveBeenCalledTimes(1);
  });

  it.each(["helper rejection", "uncertain response"])("keeps uncertain %s locked, retaining the original report when known", async kind => {
    if (kind === "helper rejection") research.mockRejectedValue("Helper did not confirm this operation");
    else research.mockResolvedValue({ ok: false, uncertain: true, message: "Watching timed out", queryId, dispatchUrl: result.dispatchUrl });
    await mount(); await fill(); await act(async () => submit());
    expect(dom.window.document.body.textContent).toContain("Completion is uncertain");
    expect(find<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    await act(async () => submit()); expect(research).toHaveBeenCalledTimes(1);
    if (kind !== "helper rejection") expect(find<HTMLInputElement>(".sponsored-report input").value).toBe(result.dispatchUrl);
  });

  it("rejects blank and out-of-range budgets even on direct form submission", async () => {
    await mount(); await fill();
    for (const amount of ["", "-0.01", "0.081", "999"]) {
      await type('input[type="number"]', amount); await act(async () => submit());
      expect(research).not.toHaveBeenCalled();
    }
  });

  it("uses the real sidebar switch without prefilling or submitting private task contents, preserving locks across navigation", async () => {
    const privateQuestion = "PRIVATE TASK CONTENT: never upload";
    const view = { name: "Private workspace", path: "C:\\private\\workspace", references: [], invalidDirectories: 0,
      tasks: [{ handle: "private-task", question: privateQuestion, mode: "quick", status: { stage: "ready" } }] } as unknown as WorkspaceView;
    vi.mocked(api.refresh).mockResolvedValue(view);
    research.mockResolvedValue({ ok: false, uncertain: true, message: "Connection lost" });
    await act(async () => { await import("./renderer"); });
    const switchTo = async (label: string) => { await act(async () => {
      [...dom.window.document.querySelectorAll<HTMLButtonElement>(".sponsored-navigation button")].find(button => button.textContent === label)!.click();
    }); };
    expect(dom.window.document.body.textContent).toContain(privateQuestion);
    await switchTo("Sponsored research");
    expect(find<HTMLTextAreaElement>(".sponsored-screen textarea").value).toBe("");
    await fill(); await act(async () => submit());
    expect(research).toHaveBeenCalledExactlyOnceWith({ question: "A public question", mode: "quick", budget: 0, publicReport: true });
    expect(JSON.stringify(research.mock.calls)).not.toContain("PRIVATE");
    await switchTo("Local tasks"); await switchTo("Sponsored research");
    expect(find<HTMLButtonElement>('.sponsored-screen button[type="submit"]').disabled).toBe(true);
    await act(async () => submit()); expect(research).toHaveBeenCalledTimes(1);
    expect(api.createTask).not.toHaveBeenCalled(); expect(api.readResult).not.toHaveBeenCalled(); expect(api.exportTask).not.toHaveBeenCalled();
  });

  it("works without a selected workspace even when local refresh fails", async () => {
    vi.mocked(api.refresh).mockRejectedValue(Error("Private workspace unavailable"));
    await act(async () => { await import("./renderer"); });
    await act(async () => find<HTMLButtonElement>(".sponsored-navigation button").click());
    await fill(); await act(async () => submit());
    expect(research).toHaveBeenCalledTimes(1);
    expect(find(".sponsored-result").textContent).toContain("Plain answer");
  });

  it("waits for initial refresh to release the serial helper before enabling a sponsored submission", async () => {
    let finishRefresh!: (view: WorkspaceView | null) => void;
    vi.mocked(api.refresh).mockImplementation(() => new Promise(resolve => { finishRefresh = resolve; }));
    await act(async () => { await import("./renderer"); });
    await act(async () => find<HTMLButtonElement>(".sponsored-navigation button").click());
    expect(find<HTMLFieldSetElement>(".sponsored-fields").disabled).toBe(true);
    expect(dom.window.document.body.textContent).toContain("Waiting for the desktop helper to become available");
    expect(find<HTMLButtonElement>('.sponsored-screen button[type="submit"]').disabled).toBe(true);
    await act(async () => submit()); expect(research).not.toHaveBeenCalled();
    await act(async () => finishRefresh(null));
    expect(find<HTMLFieldSetElement>(".sponsored-fields").disabled).toBe(false);
    expect(dom.window.document.body.textContent).not.toContain("Waiting for the desktop helper to become available");
    await fill(); await act(async () => submit());
    expect(research).toHaveBeenCalledTimes(1);
    expect(dom.window.document.body.textContent).not.toContain("Completion is uncertain");
  });

  it("admits only the fixed-host canonical report matching the query ID", () => {
    expect(sponsoredReportUrl(result.dispatchUrl, queryId)).toBe(result.dispatchUrl);
    expect(sponsoredReportUrl(`https://keryx.cc/ask/${queryId}`, queryId)).toBe(`https://keryx.cc/ask/${queryId}`);
    expect(sponsoredReportUrl("https://keryx.cc/dispatch/arbitrary", "arbitrary")).toBeUndefined();
    for (const url of ["https://other.invalid/dispatch/" + queryId, result.dispatchUrl + "?ticket=private", "javascript:alert(1)", "https://keryx.cc/dispatch/other"]) {
      expect(sponsoredReportUrl(url, queryId)).toBeUndefined();
    }
  });
});
