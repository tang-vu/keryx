import { beforeEach, expect, it, vi } from "vitest";
import { evidenceDraftFixture } from "./fixtures/evidence-draft";
const authentication = vi.hoisted(() => ({ session: vi.fn(), key: vi.fn() }));
vi.mock("../auth", () => ({ getSession: authentication.session }));
vi.mock("../api-keys", () => ({ verifyApiKey: authentication.key }));
import { POST } from "../../app/api/research/evidence-draft/route";
const key = `kx_live_${"a".repeat(96)}`;
const request = (headers: Record<string, string> = {}) => new Request("https://keryx.cc/api/research/evidence-draft", {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(evidenceDraftFixture()),
});
beforeEach(() => { vi.resetAllMocks(); authentication.session.mockResolvedValue({ address: "0xwallet" }); authentication.key.mockResolvedValue({ scopes: "export" }); });
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
