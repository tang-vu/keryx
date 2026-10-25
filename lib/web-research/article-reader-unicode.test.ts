import { expect, it } from "vitest";
import { extractArticle } from "./article-reader";
import { isWellFormedUtf16 } from "../llm/well-formed-utf16";

it.each(["text/plain", "text/markdown"])("keeps the exact complete Unicode prefix at the %s extraction cap", contentType => {
  const prefix = "a".repeat(59_999), text = prefix + "🧾suffix";
  const extracted = extractArticle(text, "https://example.com/guide", contentType);
  expect(extracted.text.length).toBe(59_999);
  expect(extracted.text).toBe(prefix);
  expect(extracted.truncated).toBe(true);
  expect(isWellFormedUtf16(extracted.text)).toBe(true);
  expect(text.startsWith(extracted.text)).toBe(true);
});

it("retains a complete non-BMP character that exactly fits the existing cap", () => {
  const text = "a".repeat(59_998) + "🧾";
  expect(extractArticle(text, "https://example.com/guide", "text/plain")).toMatchObject({ text, truncated: false });
  expect(extractArticle(text + "tail", "https://example.com/guide", "text/plain")).toMatchObject({ text, truncated: true });
});
