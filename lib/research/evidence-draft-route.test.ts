import { expect, it, vi } from "vitest";
import { createEvidenceDraftRoute } from "./evidence-draft-route";
import { evidenceDraftFixture } from "./fixtures/evidence-draft";

const request = (body: unknown, headers = { "Content-Type": "application/json" }) => new Request("https://keryx.cc/api/research/evidence-draft", { method: "POST", headers, body: JSON.stringify(body) });
it("authenticates before reading private request bytes and makes denial noncacheable", async () => {
  const input = request(evidenceDraftFixture()), authorize = vi.fn(async () => Response.json({ error: "unauthenticated" }, { status: 401 }));
  const response = await createEvidenceDraftRoute(authorize)(input);
  expect(response.status).toBe(401); expect(input.bodyUsed).toBe(false);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("returns a stateless shared draft contract with private no-store headers", async () => {
  const response = await createEvidenceDraftRoute(async () => null)(request(evidenceDraftFixture()));
  expect(response.status).toBe(200); const result = await response.json();
  expect(result.draft.scope).toBe("private-evidence-draft"); expect(result.draft.claims[0].status).toBe("assessment-pending");
  expect(response.headers.get("vary")).toBe("Authorization, Cookie"); expect(response.headers.get("cache-control")).toContain("no-store");
});
it.each([{ start: 0, end: 1 }, { start: 1, end: 2 }])("API refuses a split UTF-16 claim at $start..$end without echoing draft text", async span => {
  const input = evidenceDraftFixture(); input.passage = "\u{1F600}x"; Object.assign(input.claims[0], span);
  const response = await createEvidenceDraftRoute(async () => null)(request(input));
  expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "invalid_or_changed_draft" });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("API returns a complete UTF-16 scalar unchanged", async () => {
  const input = evidenceDraftFixture(); input.passage = "\u{1F600}x"; input.claims[0].end = 2;
  const response = await createEvidenceDraftRoute(async () => null)(request(input));
  expect(response.status).toBe(200); expect((await response.json()).draft.claims[0].text).toBe("\u{1F600}");
});
it("bounds actual streamed bytes and refuses non-JSON, invalid data and URL selectors without echo", async () => {
  const handler = createEvidenceDraftRoute(async () => null);
  for (const input of [request({ passage: "SECRET_DRAFT" }), request(evidenceDraftFixture(), { "Content-Type": "text/plain" }), request({ passage: "x".repeat(65537) })]) {
    const response = await handler(input); expect(response.status).toBe(400); expect(await response.text()).not.toContain("SECRET_DRAFT");
  }
  const selected = new Request("https://keryx.cc/api/research/evidence-draft?wallet=other", { method: "POST", body: "private" });
  expect((await handler(selected)).status).toBe(400); expect(selected.bodyUsed).toBe(false);
});
it("denies on authentication outage before reading or classifying private content", async () => {
  const input = request(evidenceDraftFixture()), response = await createEvidenceDraftRoute(async () => { throw new Error("unavailable"); })(input);
  expect(response.status).toBe(503); expect(input.bodyUsed).toBe(false);
});
