import { expect, it } from "vitest";
import { ArticleReadError, articleFailureCode, readArticle } from "./article-reader";
it("exposes fixed read categories without hostile error details", async () => {
  expect(articleFailureCode(new Error("secret-token publisher-response"))).toBe("transport-unavailable");
  expect(articleFailureCode(new ArticleReadError("pdf-extraction-unavailable"))).toBe("pdf-extraction-unavailable");
  expect(articleFailureCode(new DOMException("private query", "AbortError"))).toBe("cancelled");
  await expect(readArticle("http://127.0.0.1/private")).rejects.toMatchObject({ code: "invalid-url", message: "invalid-url" });
});
