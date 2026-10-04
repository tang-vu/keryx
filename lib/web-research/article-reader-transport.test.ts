import { expect, it, vi } from "vitest";
const { transport, UnsafeTargetError } = vi.hoisted(() => ({ transport: vi.fn(), UnsafeTargetError: class UnsafeTargetError extends Error {} }));
vi.mock("../net/public-fetch", () => ({ fetchPublicBytes: transport, UnsafeTargetError }));
import { readArticle } from "./article-reader";
it("reports byte-cap refusal as a fixed category and never exposes vendor details", async () => {
  transport.mockRejectedValueOnce(new UnsafeTargetError("that file is too large to read"));
  await expect(readArticle("https://arxiv.org/pdf/1706.03762v7")).rejects.toMatchObject({ code: "article-byte-limit", message: "article-byte-limit" });
  transport.mockRejectedValueOnce(new UnsafeTargetError("private publisher response"));
  await expect(readArticle("https://example.org/paper")).rejects.toMatchObject({ code: "transport-unavailable", message: "transport-unavailable" });
  const controller = new AbortController(); controller.abort(); transport.mockRejectedValueOnce(new Error("private query"));
  await expect(readArticle("https://example.org/paper", controller.signal)).rejects.toMatchObject({ code: "cancelled", message: "cancelled" });
});

it("admits original markdown as inert text while preserving URL and bounds", async () => {
  const text = "# Original pricing\n\nThe selected plan does not include backups.\n\n".repeat(1200);
  transport.mockResolvedValueOnce({ contentType: "text/markdown", finalUrl: "https://example.org/pricing", bytes: new TextEncoder().encode(text) });
  const result = await readArticle("https://example.org/pricing");
  expect(result).toMatchObject({ finalUrl: "https://example.org/pricing", kind: "text", truncated: true });
  expect(result.text).toHaveLength(60000);
  expect(result.text).toContain("does not include backups");
  expect(transport).toHaveBeenLastCalledWith("https://example.org/pricing", expect.objectContaining({ maxBytes: 2 * 1024 * 1024, timeoutMs: 8000, maxHops: 3, httpsOnly: true, allowedContentTypes: expect.arrayContaining(["text/markdown"]) }));
  transport.mockResolvedValueOnce({ contentType: "text/markdown", finalUrl: "https://example.org/pricing", bytes: new Uint8Array(500001) });
  await expect(readArticle("https://example.org/pricing")).rejects.toMatchObject({ code: "article-byte-limit" });
});
