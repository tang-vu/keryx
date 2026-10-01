import { afterEach, expect, it, vi } from "vitest";
import { AUTH_CHALLENGE_TTL_MS, WEB_SESSION_TTL_MS, parseDatedAuthChallenge } from "./auth-time-policy";
const issued = Date.parse("2026-10-01T00:00:00.000Z");
const body = { nonce: "syntheticNonce12345", issuedAt: new Date(issued).toISOString(),
  challengeExpiresAt: new Date(issued + AUTH_CHALLENGE_TTL_MS).toISOString(), sessionExpiresAt: new Date(issued + WEB_SESSION_TTL_MS).toISOString() };
afterEach(() => vi.restoreAllMocks());
it.each([-86400000, 86400000])("uses canonical server dates despite client UTC skew %s", skew => {
  vi.spyOn(Date, "now").mockReturnValue(issued + skew);
  expect(parseDatedAuthChallenge(body)).toEqual(body);
});
it("rejects missing, noncanonical, unordered and over-policy server times", () => {
  for (const value of [{ nonce: body.nonce }, { ...body, issuedAt: "2026-10-01T00:00:00Z" },
    { ...body, issuedAt: "invalid" }, { ...body, challengeExpiresAt: body.issuedAt },
    { ...body, challengeExpiresAt: new Date(issued + AUTH_CHALLENGE_TTL_MS + 1).toISOString() },
    { ...body, sessionExpiresAt: new Date(issued + WEB_SESSION_TTL_MS + 1).toISOString() }])
    expect(() => parseDatedAuthChallenge(value)).toThrow();
});
