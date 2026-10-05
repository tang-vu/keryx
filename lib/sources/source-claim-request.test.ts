import { expect, it } from "vitest";
import { assertSourceClaimRequest, sourceClaimPath } from "./source-claim-request";
const claim = { id: "a".repeat(64), revision: 2, mode: "paid" as const,
  verifiedAt: "2026-10-05T00:00:00.000Z", effectiveAt: "2026-10-05T00:00:00.000Z" };
it("pins the exact policy while retaining article and offer parameters", () => {
  const path = sourceClaimPath("/api/source/owned/item/article?version=sha256%3Aabc&offer=xyz", claim);
  const params = new URL(path, "https://keryx.test").searchParams;
  expect(params.get("version")).toBe("sha256:abc"); expect(params.get("offer")).toBe("xyz");
  expect(() => assertSourceClaimRequest(params, claim)).not.toThrow();
});
it.each(["", `claimId=${claim.id}`, `claimId=${claim.id}&claimRevision=3`,
  `claimId=${claim.id}&claimRevision=02`, `claimId=${claim.id}&claimRevision=2&claimRevision=2`,
  `claimId=${claim.id}&claimId=${claim.id}&claimRevision=2`])("refuses missing, changed or ambiguous managed policy %s", query => {
  expect(() => assertSourceClaimRequest(new URLSearchParams(query), claim)).toThrow();
});
it("keeps legacy requests unchanged but refuses a forged managed context", () => {
  expect(sourceClaimPath("/api/source/legacy")).toBe("/api/source/legacy");
  expect(() => assertSourceClaimRequest(new URLSearchParams())).not.toThrow();
  expect(() => assertSourceClaimRequest(new URLSearchParams(`claimId=${claim.id}&claimRevision=2`))).toThrow();
});
