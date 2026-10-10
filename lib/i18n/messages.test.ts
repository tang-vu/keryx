import { describe, expect, it, vi } from "vitest";
import { createMessages, englishMessages, validateMessageCatalogue } from "./messages";
import { selectPlural } from "./format";

describe("typed English catalogue and selected translations", () => {
  it("validates the complete English catalogue", () => {
    expect(validateMessageCatalogue(englishMessages)).toEqual({ missing: [], invalid: [] });
  });

  it("selects account count forms while preserving the existing English and allowing distinct translated grammar", () => {
    const copy = createMessages("en");
    for (const count of [0, 1, 2]) {
      const one = selectPlural(count, "en") === "one";
      expect(copy(one ? "apiKeys.callsOnDay.one" : "apiKeys.callsOnDay.other", { day: "2026-10-11", count }))
        .toBe(`2026-10-11: ${count} calls`);
      expect(copy(one ? "apiKeys.pinnedSources.one" : "apiKeys.pinnedSources.other", { count }))
        .toBe(` · ${count} pinned source(s)`);
    }
    const translated = createMessages("vi", {
      "apiKeys.callsOnDay.one": "{day}: {count} single call",
      "apiKeys.callsOnDay.other": "{day}: {count} several calls",
      "apiKeys.pinnedSources.one": "{count} single pinned source",
      "apiKeys.pinnedSources.other": "{count} several pinned sources",
    });
    expect(translated("apiKeys.callsOnDay.one", { day: "day", count: 1 })).toBe("day: 1 single call");
    expect(translated("apiKeys.callsOnDay.other", { day: "day", count: 2 })).toBe("day: 2 several calls");
    expect(translated("apiKeys.pinnedSources.one", { count: 1 })).toBe("1 single pinned source");
    expect(translated("apiKeys.pinnedSources.other", { count: 2 })).toBe("2 several pinned sources");
  });

  it("renders missing translations in English and reports the locale/key only", () => {
    const report = vi.fn();
    const messages = createMessages("vi", { "navigation.home": "Trang chủ" }, report);
    expect(messages("navigation.home")).toBe("Trang chủ");
    expect(messages("report.question", { question: "Nghiên cứu?" })).toBe("Question: Nghiên cứu?");
    expect(report).toHaveBeenCalledExactlyOnceWith("vi", "report.question");
    expect(validateMessageCatalogue({ "navigation.home": "Trang chủ" }).missing).toContain("report.question");
  });

  it("does not evaluate parameter values as translation templates or markup", () => {
    expect(createMessages("en")("report.question", { question: "<script>{count}</script>" }))
      .toBe("Question: <script>{count}</script>");
  });

  it("rejects unknown keys, missing named interpolation and invalid translation placeholders", () => {
    expect(() => createMessages("vi", { "report.question": "Câu hỏi: {other}" })).toThrow("Invalid message");
    expect(validateMessageCatalogue({ "navigation.home": "\u0000" }).invalid).toContain("navigation.home");
    // @ts-expect-error Uncatalogued source keys must fail TypeScript.
    expect(() => createMessages("en")("navigation.hmoe")).toThrow("Unknown English");
    // @ts-expect-error Named interpolation is mandatory.
    expect(() => createMessages("en")("report.question")).toThrow("Missing message parameter");
  });

  it("does not admit prototype inherited translations", () => {
    const inherited = Object.create({ "navigation.home": "Wrong inherited home" });
    expect(createMessages("vi", inherited)("navigation.home")).toBe("Home");
    expect(validateMessageCatalogue(inherited).missing).toContain("navigation.home");
  });

  it("keeps the validated selected catalogue independent of caller mutation", () => {
    const catalogue = { "navigation.home": "Trang chủ" };
    const messages = createMessages("vi", catalogue);
    catalogue["navigation.home"] = "Changed after validation";
    expect(messages("navigation.home")).toBe("Trang chủ");
    expect(Object.isFrozen(englishMessages)).toBe(true);
    const accessor = Object.defineProperty({}, "navigation.home", { get() { throw new Error("unexpected getter"); }, enumerable: true });
    expect(() => createMessages("vi", accessor)).toThrow("Invalid message catalogue properties");
  });
});
