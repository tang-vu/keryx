import { describe, expect, it } from "vitest";
import { normalizeSearchText } from "./normalize-search-text";

describe("metadata search normalization", () => {
  it("folds Latin accents and Vietnamese d-stroke in either case", () => {
    expect(normalizeSearchText("ĐỖ THỊ LAN — đánh giá Café")).toBe("do thi lan — danh gia cafe");
    expect(normalizeSearchText("Đỗ".normalize("NFD"))).toBe("do");
  });

  it("preserves compatibility matching for width variants and Latin ligatures", () => {
    expect(normalizeSearchText("ＡＲＣ ２０２６ ﬃ")).toBe("arc 2026 ffi");
  });

  it.each([["ガイド", "カイド"], ["Йога", "Иога"], ["أبحاث", "ابحاث"], ["क़", "क"]])(
    "preserves the distinction between %s and %s", (marked, unmarked) => {
      expect(normalizeSearchText(marked)).not.toBe(normalizeSearchText(unmarked));
      expect(normalizeSearchText(marked.normalize("NFD"))).toBe(normalizeSearchText(marked));
    },
  );

  it("keeps Korean and Japanese Unicode-equivalent forms equal", () => {
    for (const value of ["한국어 연구", "ガイド"]) {
      expect(normalizeSearchText(value.normalize("NFD"))).toBe(normalizeSearchText(value));
    }
  });

  it("keeps punctuation literal and leaves original text intact", () => {
    const original = "Đỗ C++ .NET [.*]";
    expect(normalizeSearchText(original)).toBe("do c++ .net [.*]");
    expect(original).toBe("Đỗ C++ .NET [.*]");
  });
});
