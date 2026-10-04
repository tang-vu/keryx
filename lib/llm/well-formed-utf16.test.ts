import { describe, expect, it } from "vitest";
import { isWellFormedUtf16 } from "./well-formed-utf16";

describe("portable UTF-16 validation", () => {
  it.each([
    ["", true], ["plain ASCII\0", true], ["Tiếng Việt", true],
    ["e\u0301", true], ["\ufffd\uffff", true], ["😀𝄞", true],
    ["\ud800", false], ["\udbff", false], ["\udc00", false], ["\udfff", false],
    ["\udc00\ud800", false], ["\ud800\ud800", false], ["\udc00\udc00", false],
    ["\ud800A\udc00", false], ["😀\ud800", false], ["\udfff😀", false],
    ["\ud800\udc00\udbff\udfff", true],
  ])("validates %j as %s without normalization", (value, expected) => {
    expect(isWellFormedUtf16(value)).toBe(expected);
    expect(isWellFormedUtf16(value)).toBe(value.isWellFormed());
  });

  it("agrees with native validation for every individual BMP code unit", () => {
    for (let unit = 0; unit <= 0xffff; unit++) {
      const value = String.fromCharCode(unit);
      if (isWellFormedUtf16(value) !== value.isWellFormed()) {
        throw new Error(`BMP mismatch at ${unit.toString(16)}`);
      }
    }
  });

  it("agrees for every possible valid surrogate pair in surrounding BMP text", () => {
    for (let high = 0xd800; high <= 0xdbff; high++) {
      for (let low = 0xdc00; low <= 0xdfff; low++) {
        const value = `prefix${String.fromCharCode(high, low)}suffix`;
        if (!isWellFormedUtf16(value) || !value.isWellFormed()) {
          throw new Error(`Pair mismatch at ${high.toString(16)},${low.toString(16)}`);
        }
      }
    }
  });

  it("checks malformed pair transitions and both ends of a bounded source", () => {
    const units = [0, 0x61, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xffff];
    for (const first of units) {
      for (const second of units) {
        for (const third of units) {
          const value = String.fromCharCode(first, second, third);
          expect(isWellFormedUtf16(value)).toBe(value.isWellFormed());
        }
      }
    }
    const body = "a".repeat(199_998);
    for (const value of [body + "😀", body + "\ud800", "\udc00" + body, "😀" + body]) {
      expect(isWellFormedUtf16(value)).toBe(value.isWellFormed());
    }
  });
});
