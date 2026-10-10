import { expect, it, vi } from "vitest";
import { actualReadCheckpoint, readCheck, type ReadCheck } from "./actual-read-policy";
import { actualReadPacketHash, canonicalReadPacket, MAX_READ_CHECKPOINTS, verifyActualReadPacket } from "./actual-read-record";
import { createReadCheckpointCapture, ordinaryCheckpointCapability } from "../agent/read-checkpoint-capture";
import { projectActualReadCheckpoints } from "./actual-read-projection";
import { publicQueryRun } from "../research/public-query-run";
import type { QueryRun } from "../types";

const context = { candidate: 1, round: 0, proposal: "BUY", plan: "BUY", price: 0.002, remaining: 0.03 } as const;
export function checkpointFixture(check: ReadCheck = { kind: "channel", creatorFree: false, cache: false }) {
  const capture = createReadCheckpointCapture(true); capture.append(check, actualReadCheckpoint(check), context);
  const result = capture.finish(); if (!result || result.status !== "available") throw Error("Invalid fixture"); return result;
}
it.each([
  [{ kind: "selection", plan: "SKIP", external: false }, "SKIP"],
  [{ kind: "selection", plan: "BUY", external: true }, "SKIP"],
  [{ kind: "selection", plan: "CACHE", external: false }, "CONTINUE"],
  [{ kind: "duplicate", found: true }, "SKIP"], [{ kind: "duplicate", found: false }, "CONTINUE"],
  [{ kind: "present", found: false }, "SKIP"], [{ kind: "present", found: true }, "CONTINUE"],
  [{ kind: "funding", unavailable: true, positivePrice: true }, "SKIP"],
  [{ kind: "funding", unavailable: true, positivePrice: false }, "CONTINUE"],
  [{ kind: "terms", allowed: false }, "SKIP"], [{ kind: "rights", allowed: false }, "SKIP"],
  [{ kind: "review", required: true }, "ESCALATE"], [{ kind: "review", required: false }, "CONTINUE"],
  [{ kind: "review-verdict", verdict: "source-changed" }, "SKIP"],
  [{ kind: "review-verdict", verdict: "human-withheld" }, "SKIP"],
  [{ kind: "review-verdict", verdict: "admitted" }, "CONTINUE"],
  [{ kind: "public-route", available: true }, "FREE"], [{ kind: "public-route", available: false }, "CONTINUE"],
  [{ kind: "channel", creatorFree: false, cache: false }, "BUY"],
  [{ kind: "channel", creatorFree: false, cache: true }, "CACHE"],
  [{ kind: "channel", creatorFree: true, cache: true }, "FREE"],
  [{ kind: "zero-budget", zero: true }, "SKIP"], [{ kind: "zero-budget", zero: false }, "CONTINUE"],
  [{ kind: "sufficiency", sufficient: false, unavailable: true }, "STOP"],
  [{ kind: "sufficiency", sufficient: true, unavailable: false }, "STOP"],
  [{ kind: "sufficiency", sufficient: false, unavailable: false }, "CONTINUE"],
  [{ kind: "expansion", unavailable: false, sufficient: false, gaps: 1, rounds: 1, reads: 1 }, "CONTINUE"],
  [{ kind: "expansion", unavailable: true, sufficient: false, gaps: 1, rounds: 1, reads: 1 }, "STOP"],
  [{ kind: "expansion", unavailable: false, sufficient: true, gaps: 0, rounds: 1, reads: 1 }, "STOP"],
  [{ kind: "expansion", unavailable: false, sufficient: false, gaps: 1, rounds: 0, reads: 1 }, "STOP"],
  [{ kind: "expansion", unavailable: false, sufficient: false, gaps: 1, rounds: 1, reads: 0 }, "STOP"],
  [{ kind: "attention", used: 2, limit: 2 }, "STOP"], [{ kind: "attention", used: 1, limit: 2 }, "CONTINUE"],
  [{ kind: "recommendation", more: false, count: 1 }, "STOP"],
  [{ kind: "recommendation", more: true, count: 0 }, "STOP"],
  [{ kind: "recommendation", more: true, count: 1 }, "CONTINUE"],
  [{ kind: "discussion", excluded: true }, "SKIP"], [{ kind: "discussion", excluded: false }, "CONTINUE"],
] satisfies [ReadCheck, string][])('replays the declared finite checkpoint %j', async (check, action) => {
  expect(actualReadCheckpoint(check).action).toBe(action);
  const capture = checkpointFixture(check);
  expect(await verifyActualReadPacket(capture.packet, capture.retainedDigest)).toBe(true);
});

it("preserves existing budget comparison, tolerance and non-micro operands without changing monetary authority", async () => {
  for (const [price, remaining] of [[0, -0.001], [0.002, 0.002], [0.0020000005, 0.002], [0.002000002, 0.002], [0.002, 0]]) {
    const check: ReadCheck = { kind: "budget", present: true, gathered: false, price: String(price), remaining: String(remaining) };
    const expected = (remaining <= 0 && price > 0) || price > remaining + 1e-9 ? "SKIP" : "CONTINUE";
    expect(actualReadCheckpoint(check).action).toBe(expected);
    const collector = createReadCheckpointCapture(true); collector.append(check, actualReadCheckpoint(check), { ...context, price, remaining });
    const captured = collector.finish(); expect(captured?.status).toBe("available");
    if (captured?.status === "available") {
      expect(await verifyActualReadPacket(captured.packet, captured.retainedDigest)).toBe(true);
      if (price === 0.0020000005) expect(captured.packet.records[0].amounts.priceMicros).toBeNull();
      if (remaining < 0) expect(captured.packet.records[0].amounts.remainingMicros).toBeNull();
    }
  }
});
it("refuses unknown, tampered, oversized, accessor and asynchronous mutation input without invoking getters", async () => {
  const { packet, retainedDigest } = checkpointFixture();
  expect(await verifyActualReadPacket(packet, retainedDigest)).toBe(true);
  expect(await actualReadPacketHash(packet)).toBe(retainedDigest);
  const changed = structuredClone(packet); changed.records[0].check = { kind: "channel", creatorFree: false, cache: true };
  changed.records[0].outcome = actualReadCheckpoint(changed.records[0].check);
  expect(await verifyActualReadPacket(changed, retainedDigest)).toBe(false);
  expect(await verifyActualReadPacket({ ...packet, question: "private-sentinel" }, retainedDigest)).toBe(false);
  expect(await verifyActualReadPacket({ ...packet, policy: "future" }, retainedDigest)).toBe(false);
  expect(await verifyActualReadPacket({ ...packet, records: Array(MAX_READ_CHECKPOINTS + 1).fill(packet.records[0]) }, retainedDigest)).toBe(false);
  const getter = vi.fn(() => packet.records[0]); const accessor = { ...packet, records: [...packet.records] };
  Object.defineProperty(accessor.records, 0, { get: getter });
  expect(await verifyActualReadPacket(accessor, retainedDigest)).toBe(false); expect(getter).not.toHaveBeenCalled();
  const checkGetter = vi.fn(() => true), check = { kind: "duplicate" };
  Object.defineProperty(check, "found", { get: checkGetter });
  expect(() => readCheck(check)).toThrow(); expect(checkGetter).not.toHaveBeenCalled();
  const mutable = structuredClone(packet), pending = verifyActualReadPacket(mutable, retainedDigest);
  mutable.records[0].amounts.priceMicros = "1"; expect(await pending).toBe(false);
  const incompatible = structuredClone(packet); incompatible.records[0].outcome.action = "SKIP";
  expect(() => canonicalReadPacket(incompatible)).toThrow();
});
it("fails capture and capability closed, and keeps private/original projection unavailable", () => {
  const getter = vi.fn(() => ({})); const native = {}; Object.defineProperty(native, "decisionReviews", { get: getter });
  expect(ordinaryCheckpointCapability(native)).toBe(false); expect(getter).not.toHaveBeenCalled();
  expect(ordinaryCheckpointCapability({})).toBe(false);
  expect(ordinaryCheckpointCapability({ decisionReviews: {} })).toBe(true);
  const capture = createReadCheckpointCapture(true, () => { throw Error("private sentinel"); });
  const check: ReadCheck = { kind: "duplicate", found: false };
  capture.append(check, actualReadCheckpoint(check), context); expect(capture.finish()).toEqual({ status: "unavailable" });
  const { packet, retainedDigest } = checkpointFixture();
  const run = { id: "ordinary", trace: [{ phase: "done", message: "done", ts: 0,
    readCheckpoints: { status: "available", packet, retainedDigest } }] } as QueryRun;
  expect(projectActualReadCheckpoints(run)?.packet).toEqual(packet);
  expect(projectActualReadCheckpoints({ ...run, id: "prv_fixture" })).toBeNull();
  const original = { ...run, originalFulfillment: {} } as QueryRun;
  expect(projectActualReadCheckpoints(original)).toBeNull();
  expect(projectActualReadCheckpoints(publicQueryRun(original))).toBeNull();
  expect(projectActualReadCheckpoints(publicQueryRun({ ...run, originalFulfillment: undefined }))).toBeNull();
  expect(projectActualReadCheckpoints({ ...run, id: undefined } as unknown as QueryRun)).toBeNull();
  expect(original.trace[0].readCheckpoints).toBeDefined();
  const malformed = { ...run, trace: [{ ...run.trace[0], readCheckpoints: { status: "available", packet: { ...packet,
    question: "private sentinel" }, retainedDigest } }] } as unknown as QueryRun;
  expect(JSON.stringify(publicQueryRun(malformed))).not.toContain("private sentinel");
  expect(projectActualReadCheckpoints(publicQueryRun(malformed))).toBeNull();
});
it("rejects asynchronous collector completion without leaking its rejection into execution", async () => {
  const capture = createReadCheckpointCapture(true, async () => { throw Error("synthetic collector rejection"); });
  const check: ReadCheck = { kind: "selection", plan: "BUY", external: false };
  expect(actualReadCheckpoint(check).action).toBe("CONTINUE");
  expect(() => capture.append(check, actualReadCheckpoint(check), context)).not.toThrow();
  expect(capture.finish()).toEqual({ status: "unavailable" });
  await new Promise<void>(resolve => setTimeout(resolve, 0));
});
it("refuses a non-string retained digest without invoking coercion", async () => {
  const coercion = vi.fn(() => checkpointFixture().retainedDigest);
  const expected = { toString: coercion };
  expect(await verifyActualReadPacket(checkpointFixture().packet, expected as unknown as string)).toBe(false);
  expect(coercion).not.toHaveBeenCalled();
});
it("strips a checkpoint accessor before public trace copying without invoking it", () => {
  const getter = vi.fn(() => ({ ownerId: "synthetic-private-marker" }));
  const step = { phase: "done", message: "done", ts: 0 };
  Object.defineProperty(step, "readCheckpoints", { enumerable: true, get: getter });
  const run = { id: "ordinary", trace: [step] } as QueryRun;
  const projected = publicQueryRun(run);
  expect(getter).not.toHaveBeenCalled(); expect(projected.trace[0]).toEqual({ phase: "done", message: "done", ts: 0 });
  expect(Object.hasOwn(run.trace[0], "readCheckpoints")).toBe(true);
});
