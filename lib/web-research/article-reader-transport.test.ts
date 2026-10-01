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
