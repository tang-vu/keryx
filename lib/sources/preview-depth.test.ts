/**
 * Preview-depth tests. The guarantee: the free surface reveals exactly what the creator chose —
 * full summary, a bounded teaser, or nothing but the title — and never leaks more under a bad value.
 */

import { describe, it, expect } from "vitest";
import { normalizePreviewDepth, previewSummary, DEFAULT_PREVIEW_DEPTH } from "./preview-depth";

const LONG =
  "Autonomous agents settle sub-cent USDC payments over x402 on Arc, paying creators per citation " +
  "instead of per click, which rewires the web's economics for machine readers.";

describe("normalizePreviewDepth", () => {
  it("passes through the three valid levels", () => {
    expect(normalizePreviewDepth("full")).toBe("full");
    expect(normalizePreviewDepth("excerpt")).toBe("excerpt");
    expect(normalizePreviewDepth("locked")).toBe("locked");
  });

  it("falls back to the default for null / unknown / undefined (grandfathers old rows)", () => {
    expect(normalizePreviewDepth(null)).toBe(DEFAULT_PREVIEW_DEPTH);
    expect(normalizePreviewDepth(undefined)).toBe(DEFAULT_PREVIEW_DEPTH);
    expect(normalizePreviewDepth("wide-open")).toBe(DEFAULT_PREVIEW_DEPTH);
    expect(DEFAULT_PREVIEW_DEPTH).toBe("full");
  });
});

describe("previewSummary", () => {
  it("full returns the whole summary untouched", () => {
    expect(previewSummary(LONG, "full")).toBe(LONG);
  });

  it("locked withholds the summary entirely (title-only surface)", () => {
    expect(previewSummary(LONG, "locked")).toBe("");
  });

  it("excerpt truncates to a bounded teaser with an ellipsis, cut at a word boundary", () => {
    const teaser = previewSummary(LONG, "excerpt");
    expect(teaser.length).toBeLessThan(LONG.length);
    expect(teaser.length).toBeLessThanOrEqual(121); // ~120 chars + the ellipsis
    expect(teaser.endsWith("…")).toBe(true);
    expect(teaser).not.toMatch(/\s…$/); // no dangling space before the ellipsis
    // Word-boundary cut: the teaser (minus the ellipsis) is a prefix of the original by whole words.
    expect(LONG.startsWith(teaser.slice(0, -1))).toBe(true);
  });

  it("excerpt leaves a short summary alone (no ellipsis when nothing was cut)", () => {
    const short = "A brief note.";
    expect(previewSummary(short, "excerpt")).toBe(short);
  });

  it("tolerates an empty / undefined summary at every level", () => {
    expect(previewSummary(undefined, "full")).toBe("");
    expect(previewSummary("", "excerpt")).toBe("");
    expect(previewSummary(undefined, "locked")).toBe("");
  });
});
