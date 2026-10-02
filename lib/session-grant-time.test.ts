import { afterEach, expect, it, vi } from "vitest";
import { createSessionGrantClock } from "./session-grant-time";
const owner = `0x${"1".repeat(40)}`, signer = `0x${"2".repeat(40)}`, issued = Date.parse("2026-10-01T00:00:00.000Z");
const body = { sessionId: owner, ownerAddr: owner, sessAddr: signer, grantEpoch: "retained-generation",
  expiresAt: new Date(issued + 60000).toISOString(), serverNow: new Date(issued).toISOString(), remainingMs: 60000, ttlMs: 60000 };
const expected = { sessionId: owner, sessAddr: signer };
afterEach(() => vi.restoreAllMocks());
it.each([-86400000, 86400000])("subtracts full request time despite client UTC skew %s and subsequent clock steps", skew => {
  const wall = vi.spyOn(Date, "now").mockReturnValue(issued + skew);
  const clock = createSessionGrantClock(body, expected, 100, 1100, 60000);
  expect(clock.remaining(1100)).toBe(59000); wall.mockReturnValue(issued - skew);
  expect(clock.remaining(2100)).toBe(58000); expect(clock.remaining(60100)).toBe(0);
});
it("clamps readonly observations without extending the original deadline", () => {
  const clock = createSessionGrantClock(body, expected, 0, 100, 60000);
  clock.clamp(body, 1000, 1100); expect(clock.remaining(1100)).toBe(58900);
  clock.clamp({ ...body, serverNow: new Date(issued + 30000).toISOString(), remainingMs: 30000 }, 1100, 1200);
  expect(clock.remaining(1200)).toBe(29900);
  clock.clamp(body, 1200, 1300); expect(clock.remaining(1300)).toBe(29800);
});
it("rejects unknown, changed, over-policy, noncanonical or invalid timing/identity", () => {
  for (const value of [{}, { ...body, ownerAddr: signer }, { ...body, sessAddr: owner }, { ...body, sessionId: signer },
    { ...body, remainingMs: 60001 }, { ...body, ttlMs: 60001 }, { ...body, serverNow: "invalid" },
    { ...body, remainingMs: 59999 }]) expect(() => createSessionGrantClock(value, expected, 0, 100, 60000)).toThrow();
  for (const [start, now] of [[NaN, 100], [0, Infinity], [100, 99], [-1, 100]])
    expect(() => createSessionGrantClock(body, expected, start, now, 60000)).toThrow();
  const clock = createSessionGrantClock(body, expected, 0, 100, 60000);
  expect(() => clock.clamp({ ...body, grantEpoch: "replacement" }, 100, 101)).toThrow();
  expect(() => clock.clamp({ ...body, expiresAt: new Date(issued + 59900).toISOString(), remainingMs: 59900 }, 100, 101)).toThrow();
  expect(clock.remaining(NaN)).toBe(0); expect(clock.remaining(99)).toBe(0);
  expect(createSessionGrantClock(body, expected, 0, 60001, 60000).remaining(60001)).toBe(0);
});
