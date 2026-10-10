import { describe, expect, it } from "vitest";
import { replayExtensionPopup } from "./extension-popup.test-fixture";

function bindings() {
  return ["document", "location", "chrome", "KERYX_API", "fetch"]
    .map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
}
function chunk(reward: unknown) {
  return { choices: [{ delta: {}, finish_reason: "stop" }],
    keryx: { citations: [{ source: "<b>Fixture creator</b>", reward }], totalToCreators: reward,
    dispatchUrl: "https://extension.example/dispatch/12345678-1234-1234-1234-123456789abc", paymentMode: "offline" } };
}

describe("actual popup module replay isolation", () => {
  it("binds each new DOM and renders exact or unavailable amounts without interpreting creator markup", async () => {
    const before = bindings();
    for (const [reward, expected] of [[0.000001, "$0.000001"], [0.0000001, "Amount unavailable"]] as const) {
      await replayExtensionPopup([chunk(reward)], (document, requests) => {
        expect(document.querySelector("#paid-list .amt")!.textContent).toBe(expected);
        expect(document.getElementById("paid-total-usd")!.textContent).toBe(expected);
        expect(document.querySelector("#paid-list .src")!.textContent).toBe("<b>Fixture creator</b>");
        expect(document.querySelector("#paid-list b")).toBeNull();
        expect(document.getElementById("status")!.textContent).toMatch(/offline.*not settlement proof/);
        expect((document.getElementById("dispatch-link") as HTMLAnchorElement).href)
          .toBe("https://extension.example/dispatch/12345678-1234-1234-1234-123456789abc");
        expect(requests).toHaveLength(1);
      });
      expect(bindings()).toEqual(before);
    }
  });

  it("restores the previous globals when an assertion fails and permits a later isolated replay", async () => {
    const before = bindings();
    await expect(replayExtensionPopup([chunk(undefined)], () => {
      throw new Error("Deliberate fixture inspection failure");
    })).rejects.toThrow("Deliberate fixture inspection failure");
    expect(bindings()).toEqual(before);
    await replayExtensionPopup([chunk(undefined)], document => {
      expect(document.getElementById("paid-total-usd")!.textContent).toBe("Amount unavailable");
    });
    expect(bindings()).toEqual(before);
  });

  it("forwards zero, depth and scholarly opt-in without silently including the source page", async () => {
    let body: Record<string, unknown> | undefined;
    await replayExtensionPopup([chunk(0)], () => {
      expect(body).toMatchObject({ budget: 0, mode: "deep", scholarly: true });
    }, { pageUrl: "https://example.com/article", onRequest: value => { body = value; }, prepare(document) {
      (document.getElementById("budget") as HTMLInputElement).value = "0";
      (document.getElementById("mode") as HTMLSelectElement).value = "deep";
      (document.getElementById("scholarly") as HTMLInputElement).checked = true;
    } });
  });

  it("never reports stream failures as completed and never saves their reports", async () => {
    for (const response of [
      new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "[keryx error] Source selection failed" } }], keryx_error: { code: "selection" } })}\n\n`),
      new Response(`data: ${JSON.stringify(chunk(0))}\n\n`),
      Response.json({ error: "sponsored_rate_limit", message: "Sponsored capacity full" }, { status: 429 }),
    ]) {
      const saved: unknown[] = [];
      await replayExtensionPopup([], document => {
        expect(document.getElementById("error-panel")!.hidden).toBe(false);
        expect(document.getElementById("error")!.textContent).toMatch(/failed|before completion|capacity full/);
        expect(document.getElementById("exports")!.hidden).toBe(true);
        expect(saved).toHaveLength(0);
      }, { response: () => response, expectedStatus: /^failed/, onStored: value => saved.push(value) });
    }
  });

  it("prevents repeated keyboard submissions and describes an abort as stopping observation", async () => {
    await replayExtensionPopup([], (document, requests) => {
      expect(requests).toHaveLength(1);
      expect(document.getElementById("error")!.textContent).toContain("server may still finish research or payments");
    }, { expectedStatus: /^stopped/, response(init) {
      return new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("Abort", "AbortError")), { once: true }));
    }, afterClick(document) {
      document.getElementById("question")!.dispatchEvent(new document.defaultView!.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }));
      document.getElementById("stop")!.click();
    } });
  });

  it("refuses invalid budgets before HTTP and preserves safe report-only device history", async () => {
    await replayExtensionPopup([], () => {}, { expectedStatus: /^failed/, expectedRequests: 0, prepare(document) {
      (document.getElementById("budget") as HTMLInputElement).value = "-1";
    } });
    const saved: unknown[] = [];
    await replayExtensionPopup([chunk(0)], document => {
      expect(document.querySelectorAll("#recent-list a")).toHaveLength(1);
      const reports = (saved[0] as { keryx_recent_reports_v1: unknown[] }).keryx_recent_reports_v1;
      expect(reports).toHaveLength(1);
      expect(Object.keys(reports[0] as object).sort()).toEqual(["at", "url"]);
    }, { savedReports: [{ url: "javascript:alert(1)", at: Date.now() }], onStored: value => saved.push(value) });
  });
});
