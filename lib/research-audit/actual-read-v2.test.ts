import { expect, it, vi } from "vitest";
import { createReadCheckpointCapture } from "../agent/read-checkpoint-capture";
import { actualReadCheckpoint } from "./actual-read-policy";
import { canonicalReadPacket, actualReadPacketHash, verifyActualReadPacket } from "./actual-read-record";
import { replayMapping, replayNormalization, type NormalizationInput } from "./actual-read-v2";
import { projectActualReadCheckpoints } from "./actual-read-projection";
import { actualReadOpenApiSchemas } from "./actual-read-openapi";
import type { QueryRun } from "../types";

const input = (patch: Partial<NormalizationInput> = {}): NormalizationInput => ({ candidate: 1, proposal: "BUY", mapped: "BUY",
  price: "0.000001", expectedValue: "0.9", claimCount: 2, targets: [0, 1], allowedTargets: [0, 1],
  freshCache: false, originalPage: false, discussion: false, attentionFloor: "0.2", ...patch });
function capture() {
  const collector = createReadCheckpointCapture(true, undefined, true);
  const row = input(); collector.normalization(row, "BUY", row.allowedTargets);
  const check = { kind: "channel", creatorFree: false, cache: false } as const;
  collector.append(check, actualReadCheckpoint(check), { candidate: 1, round: 0, proposal: "BUY", plan: "BUY", price: 0.000001, remaining: 0.1 });
  const value = collector.finish(); if (!value || value.status !== "available" || value.packet.schema !== 2) throw Error("Unavailable v2 fixture"); return { ...value, packet: value.packet };
}
it.each([
  [{}, "BUY", "unchanged"], [{ mapped: "CACHE", freshCache: true }, "CACHE", "unchanged"],
  [{ proposal: "SKIP", mapped: "SKIP" }, "SKIP", "unchanged"], [{ mapped: "CACHE" }, "BUY", "cache-expired"],
  [{ discussion: true }, "SKIP", "discussion"], [{ allowedTargets: [] }, "SKIP", "preview"],
  [{ expectedValue: "0.1" }, "SKIP", "preview"], [{ mapped: "CACHE", freshCache: true, expectedValue: "0.15" }, "SKIP", "attention"],
] satisfies [Partial<NormalizationInput>, string, string][])("replays captured normalization %j with its genuine micro price", (patch, action, rule) => {
  expect(replayNormalization(input(patch))).toMatchObject({ action, rule, priceMicros: "1" });
});
it("records public mapping, omissions, duplicates and external refusal without publishing identity", () => {
  const base = { candidate: 1, proposal: "BUY" as const, matched: true, duplicate: false, external: false, public: true, claimCount: 2, targets: [2, 1, 1, 0] };
  expect(replayMapping(base)).toEqual({ action: "CACHE", targets: [0, 1] });
  expect(replayMapping({ ...base, matched: false })).toEqual({ action: "DROP", targets: [] });
  expect(replayMapping({ ...base, duplicate: true })).toEqual({ action: "DROP", targets: [] });
  expect(replayMapping({ ...base, external: true })).toEqual({ action: "SKIP", targets: [] });
});
it("captures the actual empty discovery STOP while disabled and unsupported capture remains absent", async () => {
  const collector = createReadCheckpointCapture(true, undefined, true); collector.stop("discovery", 0);
  const value = collector.finish(); expect(value?.status).toBe("available");
  if (value?.status === "available" && value.packet.schema === 2) {
    expect(value.packet.records).toEqual([]); expect(value.packet.stops).toEqual([{ afterCheckpoint: 0, stage: "discovery", count: 0, action: "STOP" }]);
    expect(await verifyActualReadPacket(value.packet, value.retainedDigest)).toBe(true);
  }
  const absent = createReadCheckpointCapture(false, undefined, true); absent.stop("discovery", 0); expect(absent.finish()).toBeUndefined();
  const unsupported = createReadCheckpointCapture(true, undefined, true); unsupported.stop("discovery", 1); expect(unsupported.finish()).toEqual({ status: "unavailable" });
});
it("keeps old v1 packets canonical and hash-stable alongside the v2 extension", async () => {
  const old = createReadCheckpointCapture(true), check = { kind: "channel", creatorFree: false, cache: false } as const;
  old.append(check, actualReadCheckpoint(check), { candidate: 1, round: 0, proposal: "BUY", plan: "BUY", price: 0.002 });
  const value = old.finish(); if (!value || value.status !== "available") throw Error("Unavailable v1 fixture");
  expect(value.packet.schema).toBe(1); expect(await verifyActualReadPacket(value.packet, value.retainedDigest)).toBe(true);
  expect(value.retainedDigest).toBe("ec1c0416825cca6657de96d24b4ed426b93ba2de5e56e53d817ebc3e79934393");
  expect(await actualReadPacketHash(JSON.parse(canonicalReadPacket(value.packet)))).toBe(value.retainedDigest);
  expect(canonicalReadPacket(value.packet)).not.toContain("normalizations");
});
it("retains payment observations and unavailable nonmicro amounts without claiming settlement or optimizer replay", async () => {
  const collector = createReadCheckpointCapture(true, undefined, true); collector.stop("evidence", 0);
  collector.observations(() => ({ actions: [{ candidate: 1, action: "SKIP", price: "5e-7", priceMicros: null }],
    citations: [{ candidate: 1, reward: "0.000001", rewardMicros: "1" }],
    payments: [{ candidate: 1, kind: "fetch", amount: "0.0020000005", amountMicros: null, status: "pending", settled: false },
      { candidate: 1, kind: "citation", amount: "0.000001", amountMicros: "1", status: "simulated", settled: true }] }));
  const value = collector.finish(); if (!value || value.status !== "available" || value.packet.schema !== 2) throw Error("Unavailable observation fixture");
  expect(value.packet.observations.payments).toEqual([
    { candidate: 1, kind: "fetch", amount: "0.0020000005", amountMicros: null, status: "pending", settled: false },
    { candidate: 1, kind: "citation", amount: "0.000001", amountMicros: "1", status: "simulated", settled: true }]);
  expect(await verifyActualReadPacket(value.packet, value.retainedDigest)).toBe(true);
  const invented = structuredClone(value.packet); invented.observations.payments[0].amountMicros = "2000";
  expect(await verifyActualReadPacket(invented, value.retainedDigest)).toBe(false);
  const changed = structuredClone(value.packet); changed.observations.payments[0].settled = true;
  expect(await verifyActualReadPacket(changed, value.retainedDigest)).toBe(false);
});
it("rejects tampering, invented exactness, private fields, unsupported versions and async mutation", async () => {
  const value = capture(); expect(await verifyActualReadPacket(value.packet, value.retainedDigest)).toBe(true);
  const changed = structuredClone(value.packet); changed.normalizations[0].outcome.priceMicros = "2";
  expect(await verifyActualReadPacket(changed, value.retainedDigest)).toBe(false);
  expect(() => canonicalReadPacket(changed)).toThrow();
  const privateField = { ...value.packet, observations: { ...value.packet.observations, question: "private-sentinel" } };
  expect(await verifyActualReadPacket(privateField, value.retainedDigest)).toBe(false);
  expect(await verifyActualReadPacket({ ...value.packet, policy: "future" }, value.retainedDigest)).toBe(false);
  const mutable = structuredClone(value.packet), pending = verifyActualReadPacket(mutable, value.retainedDigest);
  mutable.normalizations[0].input.price = "0.000002"; expect(await pending).toBe(false);
  const getter = vi.fn(() => input()); const accessor = structuredClone(value.packet);
  Object.defineProperty(accessor.normalizations[0], "input", { get: getter });
  expect(await verifyActualReadPacket(accessor, value.retainedDigest)).toBe(false); expect(getter).not.toHaveBeenCalled();
});
it("refuses unavailable observations without invoking disabled callbacks or granting private visibility", () => {
  const project = vi.fn(() => { throw Error("private-sentinel"); });
  const disabled = createReadCheckpointCapture(false, undefined, true); disabled.portfolio(project); expect(project).not.toHaveBeenCalled();
  const collector = createReadCheckpointCapture(true, undefined, true); collector.portfolio(project); expect(collector.finish()).toEqual({ status: "unavailable" });
  const value = capture(), run = { id: "ordinary", trace: [{ phase: "done", readCheckpoints: value }] } as QueryRun;
  expect(projectActualReadCheckpoints(run)?.packet.schema).toBe(2);
  expect(projectActualReadCheckpoints({ ...run, id: "prv_private" })).toBeNull();
  expect(projectActualReadCheckpoints({ ...run, originalFulfillment: undefined })).toBeNull();
  expect(actualReadOpenApiSchemas.ActualReadCheckpointCapture.oneOf.length).toBe(4);
});
