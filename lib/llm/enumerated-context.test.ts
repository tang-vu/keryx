import { describe, expect, it } from "vitest";
import { enumeratedContextRange } from "./enumerated-context";
import { sourceTextBlocks } from "./source-text-blocks";

describe("contiguous enumerated context ranges", () => {
  it.each([
    "send: Sends the form. This is the default.\nclear: Restores the controls.\npassive: Waits for a script.\n",
    "1. Sends the form. This is the default.\n2. Restores the controls.\n3. Waits for a script.\n",
    "- Sends the form. This is the default.\n- Restores the controls.\n- Waits for a script.\n",
  ])("keeps short siblings together at their original Unicode offsets: %s", items => {
    const prefix = "🌍 Context.\n";
    const text = prefix + items + "Following prose.\n";
    const blocks = sourceTextBlocks(text);
    for (const index of [1, 2, 3]) {
      const range = enumeratedContextRange(text, blocks, index, 600)!;
      expect(range).toEqual({ start: prefix.length, end: prefix.length + items.length });
      expect(text.slice(range.start, range.end)).toBe(items);
    }
  });

  it.each([
    "left: Unrelated first item.\n\ncenter: Requested item.\n\nright: Unrelated last item.\n",
    "left: Unrelated first item.\nOrdinary intervening prose.\ncenter: Requested item.\nOrdinary intervening prose.\nright: Unrelated last item.\n",
    "  left: Nested item.\ncenter: Requested item.\n  right: Nested item.\n",
    "- First bullet.\ncenter: Requested item.\n* Last bullet.\n",
  ])("stops at a gap, prose, changed indentation or format: %s", text => {
    const blocks = sourceTextBlocks(text);
    const index = blocks.findIndex(block => text.slice(block.start, block.end).startsWith("center:"));
    expect(enumeratedContextRange(text, blocks, index, 600)).toBeUndefined();
  });

  it("stops dense enumeration expansion at eight neighboring items", () => {
    const lines = Array.from({ length: 50 }, (_, index) => `k${index}: Value.\n`);
    const text = lines.join("");
    const blocks = sourceTextBlocks(text);
    const range = enumeratedContextRange(text, blocks, 25, 600)!;
    expect(range).toEqual({ start: blocks[21]!.start, end: blocks[29]!.end });
    expect(text.slice(range.start, range.end)).toBe(lines.slice(21, 30).join(""));
  });

  it("preserves whole items within the character cap and cannot skip an oversized neighbor", () => {
    const text = "previous: " + "x".repeat(600) + "\ncenter: Requested item.\nnext: Short sibling.\nlast: " + "y".repeat(600) + "\n";
    const blocks = sourceTextBlocks(text);
    const range = enumeratedContextRange(text, blocks, 1, 600)!;
    expect(range).toEqual({ start: blocks[1]!.start, end: blocks[2]!.end });
    expect(range.end - range.start).toBeLessThanOrEqual(600);
    expect(enumeratedContextRange(text, blocks, 0, 600)).toBeUndefined();
  });

  it("leaves multiline/preformatted groups and blank separators to their source boundary policy", () => {
    const text = "first: Wrapped text.\n  Continuation.\n\nsecond: Separate paragraph.\n\n";
    const blocks = [{ start: 0, end: text.indexOf("second:") }, { start: text.indexOf("second:"), end: text.length }];
    expect(enumeratedContextRange(text, blocks, 0, 600)).toBeUndefined();
    expect(enumeratedContextRange(text, blocks, 1, 600)).toBeUndefined();
  });

  it("does not promote prose colons or URLs into labeled list items", () => {
    const text = "A sentence with a colon: This is prose.\nhttps://example.test/item\nFollow-up prose: Another sentence.\n";
    const blocks = sourceTextBlocks(text);
    for (const index of [0, 1, 2]) expect(enumeratedContextRange(text, blocks, index, 600)).toBeUndefined();
  });

  it("uses the ordinary interval between multiple observed pre barriers without crossing either edge", () => {
    const text = Array.from({ length: 20 }, (_, index) => `k${index}: Value.\n`).join("");
    const blocks = sourceTextBlocks(text);
    const preformatted = [[2, 4], [9, 11], [16, 18]].map(([first, last]) =>
      ({ start: blocks[first]!.start, end: blocks[last]!.end }));
    expect(enumeratedContextRange(text, blocks, 7, 600, preformatted))
      .toEqual({ start: blocks[5]!.start, end: blocks[8]!.end });
    expect(enumeratedContextRange(text, blocks, 0, 600, preformatted))
      .toEqual({ start: blocks[0]!.start, end: blocks[1]!.end });
    expect(enumeratedContextRange(text, blocks, 10, 600, preformatted)).toBeUndefined();
    expect(enumeratedContextRange(text, blocks, 19, 600, preformatted)).toBeUndefined();
  });
});
