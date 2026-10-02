import { beforeEach, expect, it, vi } from "vitest";
const fetchText = vi.hoisted(() => vi.fn());
vi.mock("../net/public-fetch", () => ({ fetchPublicText: fetchText }));
import { checkFeedToken, feedContainsToken, verificationToken } from "./feed-verification";
const wallet = `0x${"a".repeat(40)}`;
beforeEach(() => vi.clearAllMocks());
it("matches the deterministic payout token case-insensitively with bounded public fetching", async () => {
  fetchText.mockResolvedValue(`<rss>${verificationToken(wallet).toUpperCase()}</rss>`);
  expect(await checkFeedToken("https://feed.example/rss", wallet)).toBe("present");
  expect(fetchText).toHaveBeenCalledWith("https://feed.example/rss", { timeoutMs: 15000, maxBytes: 5000000, maxHops: 3 });
});
it("distinguishes a missing token from a feed failure while keeping registration fail-closed", async () => {
  fetchText.mockResolvedValue("<rss>published feed</rss>");
  expect(await checkFeedToken("https://feed.example", wallet)).toBe("missing");
  fetchText.mockRejectedValue(new Error("private network details"));
  expect(await checkFeedToken("https://feed.example", wallet)).toBe("unavailable");
  expect(await feedContainsToken("https://feed.example", wallet)).toBe(false);
});
