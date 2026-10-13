import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { PublicResearcherProfile } from "../../components/keryx/public-researcher-profile";
import type { PublicProfileSnapshot } from "./public-profile";

const profile: PublicProfileSnapshot = { version: 1, handle: "alice", displayName: "<script>owner text</script>",
  publishedAt: "2026-10-12T00:00:00.000Z", ownershipBasis: "signed-wallet-publication-existing-run-proof",
  ledgers: [{ network: "eip155:5042", readerPaidMicros: "1000000001", creatorEarnedMicros: "1", sponsoredCreatorPaymentsMicros: "0" },
    { network: "eip155:5042002", readerPaidMicros: null, creatorEarnedMicros: "0", sponsoredCreatorPaymentsMicros: "2000000" }],
  ledgerBasis: "wallet-wide-recorded-settled-creator-events", runs: [{ id: "run", question: "Which report?", createdAt: "2026-10-12T00:00:00.000Z", surface: "stdio-mcp",
    network: "eip155:5042002", funding: "sponsored", ownership: "claimed", citations: [{ marker: "S1", sourceName: "Source" }], reportPath: "/dispatch/run", receiptsPath: "/api/dispatch/run/receipt" }] };
describe("#264 public view semantics (SSR, not compiled phone evidence)", () => {
  it("escapes owner text, uses accessible named regions, keeps exact amounts and truthful ownership/funding labels", () => {
    const dom = new JSDOM(renderToStaticMarkup(createElement(PublicResearcherProfile, { profile }))), document = dom.window.document;
    try {
      expect(document.querySelectorAll("main")).toHaveLength(1); expect(document.querySelectorAll("h1")).toHaveLength(1); expect(document.querySelectorAll("script")).toHaveLength(0);
      for (const section of document.querySelectorAll("section")) expect(document.getElementById(section.getAttribute("aria-labelledby")!)?.textContent).toBeTruthy();
      const text = document.body.textContent!; expect(text).toContain("1000.000001 USDC"); expect(text).toContain("0.000001 USDC"); expect(text).toContain("Unavailable");
      expect(text).toContain("Arc mainnet"); expect(text).toContain("Arc testnet"); expect(text).toContain("Treasury sponsored"); expect(text).toContain("Claimed through the original receipt");
      expect(document.querySelector('a[href="/api/u/alice"]')).not.toBeNull(); expect(document.querySelector('a[href="/api/dispatch/run/receipt"]')).not.toBeNull();
      expect(document.querySelector("time")?.getAttribute("datetime")).toBe(profile.runs[0].createdAt);
    } finally { dom.window.close(); }
  });
});
