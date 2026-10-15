import { describe, expect, it } from "vitest";
import { createAssignmentRoutes, readAssignmentBody } from "./http";
describe("owner269 closed ingress (authored UNRUN)", () => {
  const routes = createAssignmentRoutes(async () => { throw new Error("Authentication must not run for rejected ingress"); }, "https://assignment.invalid");
  it.each([
    ["authorization", "Bearer anything", 401], ["origin", "https://attacker.invalid", 403],
    ["sec-fetch-site", "cross-site", 403],
  ] as const)("refuses %s before any account/store access", async (name, value, status) => {
    const request = new Request("https://assignment.invalid/api/me/run-assignments", { method: "POST", headers: { origin: "https://assignment.invalid", [name]: value } });
    expect((await routes.POST(request)).status).toBe(status);
  });
  it("rejects oversized streamed JSON rather than allocating it through req.json", async () => {
    await expect(readAssignmentBody(new Request("https://assignment.invalid", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify("x".repeat(16_384)) }))).rejects.toThrow();
  });
  it("rejects query selectors even on reads", async () => {
    expect((await routes.GET(new Request("https://assignment.invalid/api/me/run-assignments?account=other"))).status).toBe(400);
  });
});
