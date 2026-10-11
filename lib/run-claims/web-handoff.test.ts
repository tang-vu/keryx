import { expect, it } from "vitest";
import { createPrivateClaimHandoff } from "./web-handoff";
const origin = "https://synthetic.example", token = "a".repeat(64), runId = "synthetic-run";
const packet = (changes = {}) => JSON.stringify({ version: 1, runId, status: "available", delivery: { version: 1,
  claimUrl: `${origin}/claim-run#${token}`, expiresAt: "2030-01-01T00:00:00.000Z" }, ...changes });
function fixture(proof: string | null = "synthetic-document-proof") {
  const states: string[] = [], opened: string[] = [];
  const handoff = createPrivateClaimHandoff({ origin: () => origin, documentProof: () => proof,
    now: () => Date.parse("2029-01-01T00:00:00.000Z"), open: url => { opened.push(url); } });
  handoff.subscribe(value => states.push(value));
  return { handoff, states, opened };
}
it("a React prop or pathname without the initial document cannot begin delivery", () => {
  const f = fixture(null); expect(f.handoff.begin()).toBeNull(); expect(f.states.at(-1)).toBe("unavailable");
  f.handoff.saved(runId); f.handoff.packet(packet()); f.handoff.finish(); f.handoff.open(); expect(f.opened).toEqual([]);
});
it("keeps credential out of serializable public state and only opens once after matching saved completion and clean EOF", () => {
  const f = fixture(); f.handoff.begin(); f.handoff.saved(runId); f.handoff.packet(packet());
  expect(f.states.at(-1)).toBe("waiting"); expect(JSON.stringify(f.handoff)).not.toContain(token);
  f.handoff.finish(); expect(f.states.at(-1)).toBe("available");
  f.handoff.open(); f.handoff.open(); expect(f.opened).toEqual([`${origin}/claim-run#${token}`]); expect(f.states).not.toContain(token);
});
it.each(["abort", "new-request", "lost-ack"])("forgets private delivery on %s without retry", kind => {
  const f = fixture(); f.handoff.begin(); f.handoff.saved(runId); f.handoff.packet(packet());
  if (kind === "new-request") f.handoff.begin(); else if (kind === "abort") f.handoff.clear(); else f.handoff.fail();
  f.handoff.finish(); f.handoff.open(); expect(f.opened).toEqual([]);
});
it.each([packet({ runId: "different" }), packet({ extra: true }), packet({ status: "unavailable", delivery: undefined }), "{", "x".repeat(9000),
  packet({ delivery: { version: 1, claimUrl: "https://other.example/claim-run#" + token, expiresAt: "2030-01-01T00:00:00.000Z" } }),
  packet({ delivery: { version: 1, claimUrl: origin + "/claim-run#" + token, expiresAt: "2020-01-01T00:00:00.000Z" } })])("refuses unbound/invalid delivery without exposing or opening it", raw => {
  const f = fixture(); f.handoff.begin(); f.handoff.saved(runId); f.handoff.packet(raw); f.handoff.finish(); f.handoff.open();
  expect(f.opened).toEqual([]); expect(f.states).not.toContain("available");
});
it("early or duplicate packets fail closed; owned completion without a packet has no claim action", () => {
  for (const early of [true, false]) {
    const f = fixture(); f.handoff.begin(); if (!early) f.handoff.saved(runId);
    f.handoff.packet(packet()); if (early) f.handoff.saved(runId); else f.handoff.packet(packet());
    f.handoff.finish(); f.handoff.open(); expect(f.opened).toEqual([]);
  }
  const f = fixture(); f.handoff.begin(); f.handoff.saved(runId); f.handoff.finish(); expect(f.states.at(-1)).toBe("none");
});
