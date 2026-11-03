import { afterEach, expect, it, vi } from "vitest";
const { fetchBytes, html, pdf, UnsafeTargetError } = vi.hoisted(() => ({ fetchBytes: vi.fn(), html: vi.fn(), pdf: vi.fn(), UnsafeTargetError: class UnsafeTargetError extends Error {} }));
vi.mock("../net/public-fetch", () => ({ fetchPublicBytes: fetchBytes, UnsafeTargetError }));
vi.mock("./html-reader", () => ({ extractHtml: html }));
vi.mock("./pdf-reader", () => ({ extractPdfText: pdf }));
import { readArticle, ArticleReadError, articleExtractionDiagnostic, articleReadDiagnostic } from "./article-reader";
import { rememberExtractionFailure, extractionFailure } from "./extraction-failure";

afterEach(() => vi.resetAllMocks());
const url = "https://example.org/original";
async function drive(format: "html" | "pdf", error: unknown, signal?: AbortSignal) {
  fetchBytes.mockResolvedValueOnce({ finalUrl: url, contentType: format === "html" ? "text/html" : "application/pdf", bytes: new TextEncoder().encode("Synthetic body") });
  (format === "html" ? html : pdf).mockRejectedValueOnce(error);
  try { await readArticle(url, signal);throw new Error("Expected refusal"); } catch (failure) { return failure; }
}
it.each(["html", "pdf"] as const)("carries only a trusted extraction-stage observation through the sanitized %s article error", async format => {
  const original = new Error("NEVER_STORE_PRIVATE_BODY /system/private/worker.mjs");rememberExtractionFailure(original, { format, reason: "deadline" });
  const error = await drive(format, original);
  expect(error).toBeInstanceOf(ArticleReadError);expect(error).toMatchObject({ code: `${format}-extraction-unavailable`, message: `${format}-extraction-unavailable` });
  expect(articleExtractionDiagnostic(error)).toEqual({ format, reason: "deadline" });expect(articleReadDiagnostic(error)).toBeUndefined();
  expect(JSON.stringify(error)).not.toContain("NEVER_STORE");
  if (format === "pdf") expect(pdf).toHaveBeenCalledWith(expect.any(Uint8Array), { signal: undefined, maxPages: 20, maxChars: 60000, timeoutMs: 5000 });
  expect(fetchBytes.mock.calls[0][1]).toMatchObject({ maxBytes: 2097152, timeoutMs: 8000, maxHops: 3, httpsOnly: true });
});
it("does not restore observations from error strings, JSON or a forged diagnostic property", async () => {
  const fake = Object.assign(new Error("deadline"), { extractionDiagnostic: { format: "html", reason: "deadline" } });
  expect(articleExtractionDiagnostic(await drive("html", fake))).toBeUndefined();
  expect(articleExtractionDiagnostic(new ArticleReadError("html-extraction-unavailable"))).toBeUndefined();
  expect(articleExtractionDiagnostic({ code: "html-extraction-unavailable", diagnostic: { format: "html", reason: "deadline" } })).toBeUndefined();
});
it("does not attach a wrong-format observation or promote a transport failure into extraction failure", async () => {
  const error = new Error("NEVER_STORE");rememberExtractionFailure(error, { format: "pdf", reason: "worker-exit" });
  expect(articleExtractionDiagnostic(await drive("html", error))).toBeUndefined();
  fetchBytes.mockRejectedValueOnce(error);
  try { await readArticle(url);throw new Error("Expected failure"); }
  catch (wrapped) { expect(articleExtractionDiagnostic(wrapped)).toBeUndefined();expect(wrapped).toMatchObject({ code: "transport-unavailable" }); }
});
it("keeps cancellation dominant and leaves the original tagged exception untouched", async () => {
  const controller = new AbortController();controller.abort();
  const error = new Error("NEVER_STORE");rememberExtractionFailure(error, { format: "html", reason: "deadline" });
  const wrapped = await drive("html", error, controller.signal);
  expect(wrapped).toMatchObject({ code: "cancelled" });expect(articleExtractionDiagnostic(wrapped)).toBeUndefined();
  expect(extractionFailure(error)).toEqual({ format: "html", reason: "deadline" });
});
