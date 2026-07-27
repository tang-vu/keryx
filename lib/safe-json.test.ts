import { describe, expect, it } from "vitest";
import { safeInlineJson } from "./safe-json";

describe("safeInlineJson", () => {
  it("cannot terminate an inline script with attacker-controlled text", () => {
    const value = { question: "</script><script>globalThis.pwned=true</script>" };
    const encoded = safeInlineJson(value);

    expect(encoded).not.toContain("<");
    expect(encoded).not.toContain("</script>");
    expect(JSON.parse(encoded)).toEqual(value);
  });

  it("escapes HTML-significant and legacy line-separator characters", () => {
    expect(safeInlineJson("<>&\u2028\u2029")).toBe(
      '"\\u003c\\u003e\\u0026\\u2028\\u2029"',
    );
  });
});
