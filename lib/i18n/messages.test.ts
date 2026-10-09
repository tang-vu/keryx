import { describe, expect, it, vi } from "vitest";
import { createMessages, englishMessages, validateMessageCatalogue } from "./messages";

describe("typed English catalogue and selected translations", () => {
  it("validates the complete English catalogue", () => {
    expect(validateMessageCatalogue(englishMessages)).toEqual({ missing: [], invalid: [] });
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
