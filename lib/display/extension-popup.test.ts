import { describe, expect, it } from "vitest";
import { replayExtensionPopup } from "./extension-popup.test-fixture";

function bindings() {
  return ["document", "location", "chrome", "KERYX_API", "fetch"]
    .map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
}
function chunk(reward: unknown) {
  return { keryx: { citations: [{ source: "<b>Fixture creator</b>", reward }], totalToCreators: reward,
    dispatchUrl: "https://keryx.example/dispatch/fixture", paymentMode: "offline" } };
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
          .toBe("https://keryx.example/dispatch/fixture");
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
});
