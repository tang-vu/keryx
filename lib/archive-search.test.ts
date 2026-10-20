import { describe, expect, it } from "vitest";
import { archiveSearchWords, matchesArchiveSearch, normalizeArchiveSearch } from "./archive-search";

const matches = (text: string, query: string) => matchesArchiveSearch(normalizeArchiveSearch(text), archiveSearchWords(query));

describe("archive search", () => {
  it("finds Vietnamese questions and sources with or without accents", () => {
    const text = "ĐÁNH GIÁ đám mây — Nguồn nghiên cứu";
    expect(matches(text, "danh gia dam may")).toBe(true);
    expect(matches(text, "NGUỒN mây")).toBe(true);
    expect(matches(text.normalize("NFD"), "nghien cuu")).toBe(true);
    expect(matches(text, "đám".normalize("NFD"))).toBe(true);
  });

  it("matches every word across question and publisher, independently of order and spacing", () => {
    expect(matches("How does Arc settle? Circle Gateway", "  gateway\tARC\n settle  ")).toBe(true);
    expect(matches("How does Arc settle? Circle Gateway", "Arc missing")).toBe(false);
    expect(archiveSearchWords("ARC arc circle")).toEqual(["arc", "circle"]);
  });

  it("keeps technical punctuation meaningful", () => {
    expect(matches("C++ and C# on .NET", "c++ .net")).toBe(true);
    expect(matches("C and NET", "c++")).toBe(false);
    expect(matches("Gateway v2.1 x402", "v2.1 x402")).toBe(true);
  });

  it("keeps non-Latin writing searchable across Unicode representations", () => {
    for (const text of ["中文研究", "한국어 연구", "ガイド", "العربية"]) {
      expect(matches(text.normalize("NFD"), text)).toBe(true);
    }
    expect(matches("Arc 中文研究", "研究 arc")).toBe(true);
    expect(matches("カイド", "ガイド")).toBe(false);
  });

  it("treats blank search as unfiltered and input as literal text", () => {
    expect(archiveSearchWords(" \n\t ")).toEqual([]);
    expect(matches("Any question", "")).toBe(true);
    expect(matches("Any question", ".*")).toBe(false);
    expect(matches("Any question", "[invalid")).toBe(false);
  });
});
