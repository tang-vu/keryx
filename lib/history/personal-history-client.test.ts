import { expect, it, vi } from "vitest";
import { createHistoryClient } from "./personal-history-client";
const wallet = `0x${"a".repeat(40)}`, key = `kx_live_${"1".repeat(96)}`;
const page = { version: 1, wallet, scope: "attributed-current-store", storeNetwork: "eip155:5042002", rows: [], nextCursor: null };
it("stdio's history client sends only the key to the deployment's fixed HTTPS read endpoint", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(page));
  expect(await createHistoryClient("https://synthetic.example", () => key, fetcher).read({ search: "%_" })).toEqual(page);
  const [url, options] = fetcher.mock.calls[0]; expect(String(url)).toBe("https://synthetic.example/api/me/history?limit=25&search=%25_");
  expect(options).toMatchObject({ method: "GET", headers: { Authorization: `Bearer ${key}` }, credentials: "omit", redirect: "error", cache: "no-store" });
});
it("refuses invalid origins, absent keys, selectors, redirects/errors and overlarge/unknown response fields without retry", async () => {
  for (const url of ["http://synthetic.example", "https://user@synthetic.example", "https://synthetic.example/path", "https://synthetic.example?wallet=other"]) expect(() => createHistoryClient(url, () => key)).toThrow();
  const fetcher = vi.fn(); await expect(createHistoryClient("https://synthetic.example", () => undefined, fetcher).read()).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockResolvedValue(Response.json({}, { status: 403 })); await expect(createHistoryClient("https://synthetic.example", () => key, fetcher).read()).rejects.toThrow("403"); expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockResolvedValue(Response.json({ ...page, answer: "private" })); await expect(createHistoryClient("https://synthetic.example", () => key, fetcher).read()).rejects.toThrow();
  fetcher.mockResolvedValue(new Response("x".repeat(2 * 1024 * 1024 + 1))); await expect(createHistoryClient("https://synthetic.example", () => key, fetcher).read()).rejects.toThrow();
});
