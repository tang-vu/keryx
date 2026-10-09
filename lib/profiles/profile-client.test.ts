import { expect, it, vi } from "vitest";
import { createProfileClient } from "./profile-client";
const key = `kx_live_${"1".repeat(96)}`;
it("profile transport sends a fixed owner endpoint, bounded no-store bearer request, no redirects/retries/signers", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ profile: null, activity: { firstSeenAt: null, questions: 0, surfacesUsed: [], topics: [], creatorsPaid: 0, scope: "attributed-current-store", network: "eip155:5042" } }));
  const client = createProfileClient("https://keryx.cc", () => key, fetcher); await client.read();
  expect(fetcher.mock.calls[0][0].href).toBe("https://keryx.cc/api/me/profile"); expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "error", credentials: "omit", cache: "no-store" });
  fetcher.mockResolvedValue(Response.json({ error: "profile_unavailable" }, { status: 503 })); await expect(client.read()).rejects.toThrow("503"); expect(fetcher).toHaveBeenCalledTimes(2);
});
it("missing profile key or invalid origin refuses before dispatch", async () => { const fetcher = vi.fn(); await expect(createProfileClient("https://keryx.cc", () => undefined, fetcher).read()).rejects.toThrow("KERYX_API_KEY"); expect(fetcher).not.toHaveBeenCalled(); for (const origin of ["https://secret@keryx.cc", "https://keryx.cc/other", "http://evil.org", "https://keryx.cc?wallet=foreign"]) expect(() => createProfileClient(origin, () => key)).toThrow(); });

const owner = `0x${"a".repeat(40)}`;
const identity = { provider: "github", externalId: "123", label: "fixture-user", wallet: owner, verifiedAt: "2026-10-09T00:00:00.000Z" };
const identities = { wallet: owner, identities: [identity] };
it("identity client uses only the fixed owner read endpoint with bounded bearer transport", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(identities));
  expect(await createProfileClient("https://keryx.cc", () => key, fetcher).readIdentities()).toEqual(identities);
  expect(fetcher).toHaveBeenCalledTimes(1); expect(String(fetcher.mock.calls[0][0])).toBe("https://keryx.cc/api/me/profile/identities");
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "error", credentials: "omit", cache: "no-store", headers: { Authorization: `Bearer ${key}` } });
  expect(fetcher.mock.calls[0][1]?.body).toBeUndefined(); expect(fetcher.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
});
it("identity read without a configured key never dispatches", async () => {
  const fetcher = vi.fn<typeof fetch>(); await expect(createProfileClient("https://keryx.cc", () => undefined, fetcher).readIdentities()).rejects.toThrow("KERYX_API_KEY"); expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  { ...identities, access_token: "fixture-secret" }, { wallet: owner, identities: [{ ...identity, email: "fixture-secret" }] },
  { wallet: owner, identities: [{ ...identity, wallet: `0x${"b".repeat(40)}` }] }, { wallet: owner, identities: [identity, identity] },
  { wallet: owner, identities: [{ ...identity, provider: "linkedin" }] }, { wallet: owner, identities: [{ ...identity, label: "fixture/other" }] },
])("identity client refuses extra provider data and malformed snapshots %j", async value => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(value));
  await expect(createProfileClient("https://keryx.cc", () => key, fetcher).readIdentities()).rejects.toThrow("Invalid verified identity response"); expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([302, 403, 503])("identity client refuses HTTP %s without retrying", async status => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("fixture-secret", { status, headers: { Location: "https://foreign.invalid" } }));
  await expect(createProfileClient("https://keryx.cc", () => key, fetcher).readIdentities()).rejects.toThrow(String(status)); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("identity client refuses reported redirected success", async () => {
  const response = Response.json(identities); Object.defineProperty(response, "redirected", { value: true });
  await expect(createProfileClient("https://keryx.cc", () => key, vi.fn<typeof fetch>().mockResolvedValue(response)).readIdentities()).rejects.toThrow("Invalid verified identity response");
});
it("identity response bytes remain bounded before schema parsing", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(" ".repeat(16385)));
  await expect(createProfileClient("https://keryx.cc", () => key, fetcher).readIdentities()).rejects.toThrow("size limit"); expect(fetcher).toHaveBeenCalledTimes(1);
});
