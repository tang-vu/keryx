import { expect, it, vi } from "vitest";
import { runOwnedHistoryCli } from "./owned-history-cli";

const wallet = "0x" + "a".repeat(40), token = "kx_live_" + "1".repeat(96);
const page = { version: 2, wallet, scope: "wallet-owned-current-store", rows: [], nextCursor: "continue",
  claimsAvailable: false, membershipAvailable: false, scanLimited: true, storeNetwork: "eip155:5042002" };
const exported = { version: 2, wallet, scope: page.scope, rows: [], complete: false, truncated: true, nextCursor: "continue",
  bounds: { maxPages: 20, maxRows: 1000, maxBytes: 2097152 }, pages: 20, claimsAvailable: false, membershipAvailable: false,
  qualification: "Synthetic current-store metadata; not all accounts or archives." };
function fixture(body: unknown = page) {
  const write = vi.fn(), error = vi.fn(), fetcher = vi.fn(async () => Response.json(body));
  return { key: token, baseUrl: "https://synthetic-history.example", fetcher, write, error };
}
it("lists using the same strict GET-only key bridge and retains empty scan continuation without claiming completeness", async () => {
  const io = fixture();
  expect(await runOwnedHistoryCli(["list", "--search", "%_ chữ 😀", "--surface", "api", "--limit", "2"], io)).toBe(0);
  const [url, options] = io.fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.pathname).toBe("/api/me/asks"); expect(url.searchParams.get("search")).toBe("%_ chữ 😀");
  expect(url.searchParams.get("contract")).toBe("owned"); expect(url.searchParams.get("limit")).toBe("2");
  expect(options).toMatchObject({ method: "GET", credentials: "omit", redirect: "error", cache: "no-store", headers: { Authorization: "Bearer " + token } });
  expect(JSON.parse(io.write.mock.calls[0][0])).toEqual(page); expect(io.error).not.toHaveBeenCalled();
});
it.each(["json", "csv"])("preserves explicit bounded export truncation in %s, including zero matching rows", async format => {
  const io = fixture(exported);
  expect(await runOwnedHistoryCli(["export", "--format", format, "--cursor", "continue"], io)).toBe(0);
  expect(io.fetcher).toHaveBeenCalledTimes(1);
  const text = io.write.mock.calls[0][0] as string;
  if (format === "json") expect(JSON.parse(text)).toEqual(exported);
  else { expect(text).toContain('"metadata"'); expect(text).toContain('"false","true","continue"'); }
  expect(text).not.toContain(token);
});
it.each([
  ["list", "--wallet", wallet], ["list", "--key", token], ["list", "--language", "vi"],
  ["list", "--search", "one", "--search", "two"], ["list", "--limit", "51"], ["list", "--limit", "01"],
  ["list", "--network", "arc"], ["list", "--from", "2026-02-30T00:00:00.000Z"],
  ["list", "--format", "csv"], ["export", "--format", "report"], ["erase"], ["list", "--cursor"],
])("refuses unsupported/duplicate/unsafe CLI arguments before transport: %j", async (...args) => {
  const io = fixture();
  expect(await runOwnedHistoryCli(args, io)).toBe(1); expect(io.fetcher).not.toHaveBeenCalled(); expect(io.write).not.toHaveBeenCalled();
  expect(io.error.mock.calls[0][0]).not.toContain(token); expect(io.error.mock.calls[0][0]).not.toContain(wallet);
});
it.each([undefined, "bad-key"])("refuses missing/invalid credentials without fetching or dumping private values", async key => {
  const io = { ...fixture(), key };
  expect(await runOwnedHistoryCli(["list"], io)).toBe(1); expect(io.fetcher).not.toHaveBeenCalled();
  expect(io.write).not.toHaveBeenCalled(); expect(io.error.mock.calls[0][0]).not.toContain(String(key));
});
it.each([401, 403, 503])("refuses HTTP%s once, cancels the private body and never retries or exposes it", async status => {
  const response = Response.json({ private: "PRIVATE BODY", credential: token }, { status });
  const cancel = vi.spyOn(response.body!, "cancel");
  const io = { ...fixture(), fetcher: vi.fn(async () => response) };
  expect(await runOwnedHistoryCli(["list"], io)).toBe(1); expect(io.fetcher).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledTimes(1); expect(io.write).not.toHaveBeenCalled();
});
it("does not echo a thrown provider/transport diagnostic containing a token or private body", async () => {
  const io = { ...fixture(), fetcher: vi.fn(async () => { throw new Error(token + " PRIVATE BODY"); }) };
  expect(await runOwnedHistoryCli(["list"], io)).toBe(1);
  expect(io.error.mock.calls[0][0]).not.toMatch(/kx_live_|PRIVATE BODY/);
});
it("requires the admitted HTTPS origin and refuses malformed successful private envelopes", async () => {
  const insecure = { ...fixture(), baseUrl: "http://synthetic-history.example" };
  expect(await runOwnedHistoryCli(["list"], insecure)).toBe(1); expect(insecure.fetcher).not.toHaveBeenCalled();
  const malformed = fixture({ ...page, ownerSelector: wallet });
  expect(await runOwnedHistoryCli(["list"], malformed)).toBe(1); expect(malformed.write).not.toHaveBeenCalled();
});
it("help needs no key, transport or language authority and does not translate original answer bytes", async () => {
  const io = { ...fixture(), key: undefined };
  expect(await runOwnedHistoryCli(["--help"], io)).toBe(0); expect(io.fetcher).not.toHaveBeenCalled();
  expect(io.write.mock.calls[0][0]).toContain("stored-answer translation");
});
