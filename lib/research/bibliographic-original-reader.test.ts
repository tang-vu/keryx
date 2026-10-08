import { beforeEach, describe, expect, it, vi } from "vitest";
const fetched = vi.hoisted(() => vi.fn());
vi.mock("../net/public-fetch", () => ({ fetchPublicBytes: fetched }));
import { readBibliographicOriginalBody } from "./bibliographic-original-reader";

const arxiv = "https://arxiv.org/abs/2005.11401v4";
const doi = "https://api.crossref.org/works/10.1038%2Fs41586-021-03819-2";
beforeEach(() => { fetched.mockReset(); });

describe("bounded raw original metadata reader", () => {
  it.each([[arxiv, "text/html"], [doi, "application/json"]])("reads exact metadata body without generic article extraction", async (url, mediaType) => {
    const body = '<html><head><meta name="citation_title" content="Observed title"></head><body>Observed page.</body></html>';
    fetched.mockResolvedValue({ bytes: new TextEncoder().encode(body), finalUrl: url, contentType: mediaType });
    const signal = new AbortController().signal;
    const read = await readBibliographicOriginalBody(url!, signal);
    expect(read).toMatchObject({ requestedUrl: url, finalUrl: url, mediaType, body, truncated: false });
    expect(new Date(read.observedAt).toISOString()).toBe(read.observedAt);
    expect(fetched).toHaveBeenCalledExactlyOnceWith(url, { maxBytes: 250000, timeoutMs: 8000, maxHops: 0, signal,
      httpsOnly: true, allowedContentTypes: [mediaType], requireFullResponse: true });
  });

  it.each(["https://example.com/abs/2005.11401v4", "https://arxiv.org/pdf/2005.11401v4", "https://arxiv.org/abs/2005.11401", arxiv + "?x=1", arxiv + "#title", "http://arxiv.org/abs/2005.11401v4", "https://api.crossref.org/works/10.1038/s41586-021-03819-2", "https://user@arxiv.org/abs/2005.11401v4"])("refuses unsupported URL before transport: %s", async url => {
    await expect(readBibliographicOriginalBody(url)).rejects.toMatchObject({ code: "invalid-metadata-read" });
    expect(fetched).not.toHaveBeenCalled();
  });

  it("refuses substituted identities, mismatched media, oversized bytes and invalid UTF-8", async () => {
    for (const response of [
      { bytes: new Uint8Array([65]), finalUrl: "https://arxiv.org/abs/2005.11401v5", contentType: "text/html" },
      { bytes: new Uint8Array([65]), finalUrl: arxiv, contentType: "application/pdf" },
      { bytes: new Uint8Array(250001), finalUrl: arxiv, contentType: "text/html" },
      { bytes: new Uint8Array([0xc3, 0x28]), finalUrl: arxiv, contentType: "text/html" },
    ]) {
      fetched.mockResolvedValueOnce(response);
      await expect(readBibliographicOriginalBody(arxiv)).rejects.toThrow();
    }
  });

  it("propagates cancellation and never substitutes another supplier", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(readBibliographicOriginalBody(arxiv, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetched).not.toHaveBeenCalled();
    fetched.mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    await expect(readBibliographicOriginalBody(arxiv)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetched).toHaveBeenCalledTimes(1);
  });
});
