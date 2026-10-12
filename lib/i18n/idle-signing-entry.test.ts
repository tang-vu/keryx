import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import AskPage from "../../app/page";
import { ProductHuntBadge } from "../../components/keryx/product-hunt-badge";
import { SiteHeader } from "../../components/keryx/site-header";
import { SiteFooter } from "../../components/keryx/site-footer";
import { signingDisplayPrefetchPath } from "../../test-support/signing-display-prefetch";

// Observe the Next Link contract without loading another route or wallet SDK.
// This is SSR source coverage, not the real compiled signing-screen observation.
vi.mock("next/link", () => ({
  default: ({ prefetch, onNavigate, ...props }: ComponentProps<"a"> & {
    prefetch?: boolean | null; onNavigate?: () => void;
  }) => {
    void onNavigate;
    return createElement("a", { ...props, "data-prefetch": prefetch === false ? "false" : "default" });
  },
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/components/keryx/wallet-menu", () => ({ WalletMenu: () => null }));
vi.mock("@/components/keryx/dispatch-wire", () => ({ DispatchWire: () => null }));
vi.mock("@/components/keryx/research-chat", () => ({ ResearchChat: () => null }));
vi.mock("@/components/keryx/activity-ticker", () => ({ ActivityTicker: () => null }));

describe("idle public signing entry", () => {
  it("renders accessible Product Hunt branding without a remote image or resource preload", () => {
    const dom = new JSDOM(renderToStaticMarkup(createElement(ProductHuntBadge)));
    try {
      const document = dom.window.document;
      const link = document.querySelector("a")!;
      expect(link.href).toBe("https://www.producthunt.com/products/keryx-2?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-keryx-2");
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link.getAttribute("aria-label")).toContain("opens in a new tab");
      const image = document.querySelector('svg[role="img"]')!;
      expect(image.getAttribute("aria-label")).toContain("Keryx");
      expect(image.getAttribute("viewBox")).toBe("0 0 250 54");
      expect(image.textContent).toContain("Product Hunt");
      expect(document.querySelectorAll("img, image, use, script, iframe, link, [src]")).toHaveLength(0);
    } finally { dom.window.close(); }
  });

  it("retains root navigation prefetch and the original walkthrough opt-out", () => {
    const dom = new JSDOM(renderToStaticMarkup(createElement(AskPage)));
    try {
      const links = [...dom.window.document.querySelectorAll("a[data-prefetch]")];
      expect(links.length).toBeGreaterThan(10);
      for (const link of links) expect(link.getAttribute("data-prefetch"))
        .toBe(link.getAttribute("href") === "/walkthrough" ? "false" : "default");
      const destinations = links.map(link => link.getAttribute("href"));
      for (const href of ["/", "/register", "/dashboard", "/operator", "/sources", "/research", "/walkthrough", "/privacy"])
        expect(destinations).toContain(href);
    } finally { dom.window.close(); }
  });

  it("retains the shared shell's default prefetch behavior", () => {
    const dom = new JSDOM(renderToStaticMarkup(createElement("div", null,
      createElement(SiteHeader), createElement(SiteFooter))));
    try {
      const links = [...dom.window.document.querySelectorAll("a[data-prefetch]")];
      expect(links.length).toBeGreaterThan(10);
      expect(links.every(link => link.getAttribute("data-prefetch") === "default")).toBe(true);
    } finally { dom.window.close(); }
  });
});

describe("idle signing prefetch isolation", () => {
  const origin = "http://127.0.0.1:13960";
  const original = { url: `${origin}/sources?_rsc=fixture_1`, method: "GET", resourceType: "fetch", navigation: false,
    headers: { rsc: "1", "next-router-prefetch": "1" } };
  it("recognises finite Next RSC prefetch markers on fixed root-link paths", () => {
    for (const marker of ["1", "2", "3"]) expect(signingDisplayPrefetchPath({ ...original,
      headers: { ...original.headers, "next-router-prefetch": marker } }, origin)).toBe("/sources");
    expect(signingDisplayPrefetchPath({ ...original, url: `${origin}/research?_rsc=fixture_1` }, origin)).toBe("/research");
  });
  it("never isolates external, non-GET or actual navigation requests", () => {
    for (const value of [{ ...original, url: "https://external.invalid/sources?_rsc=fixture_1" },
      { ...original, method: "POST" }, { ...original, navigation: true }, { ...original, resourceType: "document" }])
      expect(signingDisplayPrefetchPath(value, origin)).toBeNull();
  });
  it("never isolates API, wallet, signing, recovery, assets or arbitrary paths", () => {
    for (const path of ["/api/ask", "/api/auth/session", "/api/session/status", "/api/agent/ask", "/api/ask/sign",
      "/api/withdrawals", "/me/withdrawals", "/recovery", "/", "/icon.svg", "/_next/static/asset.js", "/dispatch/private-id"])
      expect(signingDisplayPrefetchPath({ ...original, url: `${origin}${path}?_rsc=fixture_1` }, origin)).toBeNull();
  });
  it("requires both exact RSC and finite prefetch markers", () => {
    for (const headers of [{}, { rsc: "1" }, { "next-router-prefetch": "1" }, { rsc: "0", "next-router-prefetch": "1" },
      { rsc: "1", "next-router-prefetch": "0" }, { rsc: "1", "next-router-prefetch": "true" }])
      expect(signingDisplayPrefetchPath({ ...original, headers }, origin)).toBeNull();
  });
  it("never isolates credential, wallet-precondition or payment-header requests", () => {
    for (const name of ["authorization", "cookie", "payment-signature", "x-payment", "x-keryx-expected-wallet"])
      expect(signingDisplayPrefetchPath({ ...original, headers: { ...original.headers, [name]: "private" } }, origin)).toBeNull();
  });
  it("rejects credentials, fragments, traversal and extra or oversized query inputs", () => {
    for (const url of [`http://user:secret@127.0.0.1:13960/sources?_rsc=fixture_1`, `${original.url}#private`,
      `${origin}/private/../sources?_rsc=fixture_1`, `${origin}/%73ources?_rsc=fixture_1`, `${origin}/sources`,
      `${origin}/sources?_rsc=fixture_1&token=private`, `${origin}/sources?_rsc=a&_rsc=b`, `${origin}/sources?_rsc=`,
      `${origin}/sources?_rsc=${"a".repeat(129)}`, `${origin}/sources?question=private`])
      expect(signingDisplayPrefetchPath({ ...original, url }, origin)).toBeNull();
  });
});
