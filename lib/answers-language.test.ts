import { describe, expect, it } from "vitest";
import type { ArchiveEntry } from "./answers-archive";
import { archiveAnswerLanguage, archiveLanguagePath, archiveLanguages, filterArchiveLanguage, parseArchiveLanguage } from "./answers-language";

function entry(id: string, answerLanguage?: string): ArchiveEntry {
  return { id, answerLanguage, question: "Vietnamese-looking question is not proof", answerSnippet: "中文 is not proof", citationCount: 1,
    totalSpent: 0, toCreators: 0, sourceNames: [], createdAt: "2026-10-12T00:00:00Z", confidence: null };
}

describe("recorded archive language browsing", () => {
  it("keeps unknown separate from known languages without inspecting question or snippet", () => {
    const entries = [entry("unknown"), entry("vi", "vi"), entry("zh", "zh-Hans"), entry("region", "vi-VN")];
    expect(filterArchiveLanguage(entries, "vi").map(row => row.id)).toEqual(["vi"]);
    expect(filterArchiveLanguage(entries, "und").map(row => row.id)).toEqual(["unknown"]);
    expect(filterArchiveLanguage(entries, null)).toEqual(entries);
    expect(archiveLanguages(entries)).toEqual([{ language: "und", count: 1 }, { language: "vi", count: 1 },
      { language: "vi-VN", count: 1 }, { language: "zh-Hans", count: 1 }]);
  });
  it("canonicalizes safe tags and refuses arrays, injection and unsupported syntax", () => {
    expect(parseArchiveLanguage("ZH-hans")).toBe("zh-Hans");
    for (const input of [["vi", "en"], "vi\nX-Header", "../vi", "vi<script>", "x".repeat(100), "", null]) expect(parseArchiveLanguage(input)).toBeNull();
    expect(archiveAnswerLanguage(entry("invalid", "vi\nX-Header"))).toBe("und");
  });
  it("keeps existing indexed URLs and carries the language through pagination", () => {
    expect(archiveLanguagePath(1, null)).toBe("/answers");
    expect(archiveLanguagePath(2, null)).toBe("/answers/page/2");
    expect(archiveLanguagePath(1, "zh-Hans")).toBe("/answers?language=zh-Hans");
    expect(archiveLanguagePath(2, "vi")).toBe("/answers/page/2?language=vi");
  });
});
