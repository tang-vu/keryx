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
