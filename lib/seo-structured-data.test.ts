/**
 * Breadcrumb structured data. What matters here is what a search engine reads: positions start at
 * 1 and stay in order, links are absolute, and the page you're on carries no link of its own.
 */

import { describe, expect, it } from "vitest";
import { breadcrumbJsonLd, crumbLabel } from "./seo-structured-data";

const BASE = "https://keryx.cc";

describe("breadcrumbJsonLd", () => {
  it("numbers the trail from one, in order", () => {
    const ld = breadcrumbJsonLd(BASE, [
      { name: "Keryx", path: "/" },
      { name: "The Archive", path: "/answers" },
      { name: "A question" },
    ]);
    const items = ld.itemListElement as { position: number; name: string }[];
    expect(items.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(items.map((i) => i.name)).toEqual(["Keryx", "The Archive", "A question"]);
  });

  it("makes links absolute and leaves the current page unlinked", () => {
    const ld = breadcrumbJsonLd(BASE, [{ name: "Keryx", path: "/" }, { name: "Here" }]);
    const items = ld.itemListElement as { item?: string }[];
    expect(items[0]!.item).toBe("https://keryx.cc/");
    expect(items[1]!.item).toBeUndefined();
  });
});

describe("crumbLabel", () => {
  it("collapses whitespace", () => {
    expect(crumbLabel("  How   does\nx402 settle? ")).toBe("How does x402 settle?");
  });

  it("truncates a long question to a label", () => {
    const label = crumbLabel("x".repeat(200));
    expect(label).toHaveLength(70);
    expect(label.endsWith("…")).toBe(true);
  });

  it("leaves a short label alone", () => {
    expect(crumbLabel("The Registry")).toBe("The Registry");
  });
});
