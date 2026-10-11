import { beforeEach, expect, it, vi } from "vitest";
import { draftCheckFixture } from "./fixtures/draft-check";
const authentication = vi.hoisted(() => ({ session: vi.fn(), key: vi.fn() }));
const configuration = vi.hoisted(() => ({ baseUrl: "https://keryx.cc" }));
vi.mock("../auth", () => ({ getSession: authentication.session }));
vi.mock("../api-keys", () => ({ verifyApiKey: authentication.key }));
vi.mock("../config", () => ({ config: configuration }));
import { POST } from "../../app/api/research/draft-check/route";
import { createDraftCheckRoute } from "./draft-check-route";
import { buildDraftCheck } from "./draft-check";

const key = `kx_live_${"a".repeat(96)}`, url = "https://keryx.cc/api/research/draft-check";
const request = (headers: Record<string, string> = {}, body: unknown = draftCheckFixture(), target = url) => new Request(target, {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});
beforeEach(() => { vi.resetAllMocks(); configuration.baseUrl = "https://keryx.cc"; authentication.session.mockResolvedValue({ address: "0xwallet" }); authentication.key.mockResolvedValue({ scopes: "export" }); });

it("returns the shared contract with private no-store headers for an export-scoped key", async () => {
  const response = await POST(request({ Authorization: `Bearer ${key}` }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ check: buildDraftCheck(draftCheckFixture()) });
  expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("vary")).toBe("Authorization, Cookie");
  expect(authentication.session).not.toHaveBeenCalled();
});
it("refuses malformed, revoked and ask-only keys before reading the private body", async () => {
  for (const [authorization, record, status] of [["Bearer bad", { scopes: "export" }, 401], [`Bearer ${key}`, null, 401], [`Bearer ${key}`, { scopes: "ask" }, 403]] as const) {
    authentication.key.mockResolvedValue(record); const input = request({ Authorization: authorization }), response = await POST(input);
    expect(response.status).toBe(status); expect(input.bodyUsed).toBe(false); expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
});
it("accepts only an active session from the configured public origin", async () => {
  expect((await POST(request({ Origin: "https://keryx.cc", "Sec-Fetch-Site": "same-origin" }))).status).toBe(200);
  const denied: Array<Record<string, string>> = [{}, { Origin: "https://other.example" }, { Origin: "https://keryx.cc", "Sec-Fetch-Site": "cross-site" }];
  for (const headers of denied) {
    const input = request({ Host: "other.example", "X-Forwarded-Host": "keryx.cc", ...headers });
    expect((await POST(input)).status).toBe(403); expect(input.bodyUsed).toBe(false);
  }
  authentication.session.mockResolvedValue(null); const input = request({ Origin: "https://keryx.cc" });
  expect((await POST(input)).status).toBe(401); expect(input.bodyUsed).toBe(false);
});
it("answers invalid, oversized, non-JSON and selector requests with fixed errors that never echo the draft", async () => {
  const handler = createDraftCheckRoute(async () => null);
  for (const input of [request({}, { ...draftCheckFixture(), passage: "SECRET_DRAFT", extra: true }), request({ "Content-Type": "text/plain" }, { passage: "SECRET_DRAFT" }),
    request({}, { ...draftCheckFixture(), passage: "SECRET_DRAFT ".repeat(6000) })]) {
    const response = await handler(input); expect(response.status).toBe(400); expect(await response.text()).not.toContain("SECRET_DRAFT");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
  const selected = request({}, draftCheckFixture(), `${url}?wallet=other`);
  expect((await handler(selected)).status).toBe(400); expect(selected.bodyUsed).toBe(false);
});
it("denies on authentication outage before reading private content", async () => {
  const input = request(), response = await createDraftCheckRoute(async () => { throw new Error("unavailable"); })(input);
  expect(response.status).toBe(503); expect(input.bodyUsed).toBe(false);
});
