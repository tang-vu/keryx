import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import AskPage from "../../app/page";
import { ProductHuntBadge } from "../../components/keryx/product-hunt-badge";
import { SiteHeader } from "../../components/keryx/site-header";
import { SiteFooter } from "../../components/keryx/site-footer";

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

  it("keeps root navigation explicit while retaining its destinations", () => {
    const dom = new JSDOM(renderToStaticMarkup(createElement(AskPage)));
    try {
      const links = [...dom.window.document.querySelectorAll("a[data-prefetch]")];
      expect(links.length).toBeGreaterThan(10);
      expect(links.every(link => link.getAttribute("data-prefetch") === "false")).toBe(true);
      const destinations = links.map(link => link.getAttribute("href"));
      for (const href of ["/", "/register", "/dashboard", "/operator", "/sources", "/research", "/walkthrough", "/privacy"])
        expect(destinations).toContain(href);
    } finally { dom.window.close(); }
  });

  it("retains the shared shell's default prefetch behavior outside the root opt-out", () => {
    const dom = new JSDOM(renderToStaticMarkup(createElement("div", null,
      createElement(SiteHeader), createElement(SiteFooter))));
    try {
      const links = [...dom.window.document.querySelectorAll("a[data-prefetch]")];
      expect(links.length).toBeGreaterThan(10);
      expect(links.every(link => link.getAttribute("data-prefetch") === "default")).toBe(true);
    } finally { dom.window.close(); }
  });
});
