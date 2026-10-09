import { beforeEach, expect, it, vi } from "vitest";
import { evidenceDraftFixture } from "./fixtures/evidence-draft";
const authentication = vi.hoisted(() => ({ session: vi.fn(), key: vi.fn() }));
const configuration = vi.hoisted(() => ({ baseUrl: "https://keryx.cc" }));
vi.mock("../auth", () => ({ getSession: authentication.session }));
vi.mock("../api-keys", () => ({ verifyApiKey: authentication.key }));
vi.mock("../config", () => ({ config: configuration }));
import { POST } from "../../app/api/research/evidence-draft/route";
const key = `kx_live_${"a".repeat(96)}`;
const request = (headers: Record<string, string> = {}, url = "https://keryx.cc/api/research/evidence-draft") => new Request(url, {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(evidenceDraftFixture()),
});
beforeEach(() => { vi.resetAllMocks(); configuration.baseUrl = "https://keryx.cc"; authentication.session.mockResolvedValue({ address: "0xwallet" }); authentication.key.mockResolvedValue({ scopes: "export" }); });
it("accepts export-scoped verified keys without cookie fallback or new spend authority", async () => {
  const response = await POST(request({ Authorization: `Bearer ${key}` })); expect(response.status).toBe(200);
  expect(authentication.key).toHaveBeenCalledWith(key); expect(authentication.session).not.toHaveBeenCalled();
});
it("refuses malformed, revoked and ask-only bearer keys before reading the body", async () => {
  for (const [authorization, record, status] of [["Bearer bad", { scopes: "export" }, 401], [`Bearer ${key}`, null, 401], [`Bearer ${key}`, { scopes: "ask" }, 403]] as const) {
    authentication.key.mockResolvedValue(record); const input = request({ Authorization: authorization });
    expect((await POST(input)).status).toBe(status); expect(input.bodyUsed).toBe(false);
  }
  expect(authentication.session).not.toHaveBeenCalled();
});
it("uses active same-origin sessions and refuses absent sessions/cross-origin requests", async () => {
  expect((await POST(request({ Origin: "https://other.example" }))).status).toBe(403);
  expect(authentication.session).not.toHaveBeenCalled();
  expect((await POST(request({ Origin: "https://keryx.cc" }))).status).toBe(200);
  authentication.session.mockResolvedValue(null); const input = request({ Origin: "https://keryx.cc" });
  expect((await POST(input)).status).toBe(401); expect(input.bodyUsed).toBe(false);
});
it("accepts the configured public Origin despite Next internal URL canonicalization", async () => {
  const input = request({ Origin: "https://keryx.cc", "Sec-Fetch-Site": "same-origin", Host: "attacker.example", "X-Forwarded-Host": "other.example", "X-Forwarded-Proto": "http" }, "http://localhost:3939/api/research/evidence-draft");
  expect((await POST(input)).status).toBe(200); expect(authentication.session).toHaveBeenCalledOnce();
});
it("refuses missing, foreign or malformed Origins and cross-site hints before reading private bytes", async () => {
  for (const headers of [{}, ...["null", "https://other.example", "http://keryx.cc", "https://keryx.cc:8443", "https://keryx.cc/path", "https://user@keryx.cc"].map(Origin => ({ Origin })),
    ...["cross-site", "same-site", "none"].map(site => ({ Origin: "https://keryx.cc", "Sec-Fetch-Site": site }))]) {
    const input = request({ Host: "other.example", "X-Forwarded-Host": "keryx.cc", "X-Forwarded-Proto": "https", ...headers });
    expect((await POST(input)).status).toBe(403); expect(input.bodyUsed).toBe(false);
  }
  expect(authentication.session).not.toHaveBeenCalled(); expect(authentication.key).not.toHaveBeenCalled();
});
it("fails closed for invalid deployment origin while retaining the separate bearer path", async () => {
  for (const baseUrl of ["", "not-a-url", "ftp://keryx.cc", "https://user:password@keryx.cc"]) {
    configuration.baseUrl = baseUrl; const input = request({ Origin: "https://keryx.cc" });
    expect((await POST(input)).status).toBe(403); expect(input.bodyUsed).toBe(false);
  }
  expect(authentication.session).not.toHaveBeenCalled();
  expect((await POST(request({ Authorization: `Bearer ${key}` }))).status).toBe(200);
});
