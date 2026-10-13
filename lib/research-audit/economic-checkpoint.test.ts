import { it, expect, vi } from "vitest";
import { allocateSplit } from "../payments/split-allocation";
import { captureBudget, captureAllocation, captureAuthorSplit } from "../agent/economic-checkpoint-capture";
import { createReadCheckpointCapture } from "../agent/read-checkpoint-capture";
import { economicRecord, replaySplit, economicReplaySummary } from "./economic-checkpoint";
import { optimizerPacketFixture } from "./optimizer-checkpoint.test-fixture";
import { actualReadCheckpoint } from "./actual-read-policy";
import { canonicalReadPacket, verifyActualReadPacket, actualReadPacketHash } from "./actual-read-record";
import { economicPacketFixture } from "./economic-checkpoint.test-fixture";
import { projectReadCheckpointCapture, projectActualReadCheckpoints } from "./actual-read-projection";
import { actualReadOpenApiSchemas } from "./actual-read-openapi";

const context = { sequence: 0, afterCheckpoint: 0, candidate: 1, round: 0, status: "available" } as const;
it.each([0, 0.000001, 0.000003, 0.01, 1.000001])("replays actual split policy integer outputs without changing the allocator: %s", total => {
  for (const weights of [[1], [1, 1, 1], [0.3333, 0.3333, 0.3334], [0, -1, 2], [0, 0]]) {
    const actual = allocateSplit(total, weights);
    const payload = captureAuthorSplit(total, weights, actual);
    const record = economicRecord({ ...context, ...payload }, 0, 0);
    expect(record.status).toBe("available");
    expect(replaySplit(String(total), weights.map(String))).toEqual(actual.map(value => String(Math.round(value * 1e6))));
  }
});
it("replays actual model normalization separately from proposed weights and eligibility", () => {
  const gross = allocateSplit(0.000003, [0.5, 0.5]);
  const record = economicRecord({ ...context, ...captureAllocation(0.000003, 0.000003, ["PRIVATE_A", "PRIVATE_B"],
    [{ sourceId: "PRIVATE_B", weight: 7 }, { sourceId: "UNKNOWN_PRIVATE", weight: 2 }], [true, false], [0.5, 0.5], gross, [gross[0], 0]) }, 0, 0);
  expect(record.status).toBe("available"); expect(JSON.stringify(record)).not.toContain("PRIVATE");
  if (record.status === "available" && record.kind === "citation-allocation") {
    expect(record.input.proposals).toEqual([{ group: 2, weight: "7" }, { group: 0, weight: "2" }]);
    expect(record.outcome).toEqual({ weights: ["0.5", "0.5"], grossMicros: ["2", "1"], rewardsMicros: ["2", "0"] });
  }
});
it("checks integer reserve/release/clamp, remaining/debit and retained uncertain exposure", () => {
  const vectors = [
    captureBudget("reserve", "portfolio", 0, [0.002, 0.003], 0.005),
    captureBudget("release", "sufficient", 0.005, [0.003], 0.002),
    captureBudget("release", "pre-submission", 0.001, [0.002], 0),
    captureBudget("remaining", "initial-remaining", 0.01, [0.002], 0.008),
    captureBudget("add", "pending", 0.002, [0.001], 0.003),
    captureBudget("hold", "pending", 0.003, [], 0.003),
    captureBudget("hold", "funding", 0.003, [], 0.003),
  ];
  for (const payload of vectors) expect(economicRecord({ ...context, ...payload }, 0, 0).status).toBe("available");
  expect(() => economicRecord({ ...context, ...captureBudget("hold", "pending", 0.003, [], 0) }, 0, 0)).toThrow();
  expect(() => economicRecord({ ...context, ...captureBudget("release", "pending", 0.003, [0.003], 0) }, 0, 0)).toThrow();
});
it.each([0.0000001, 0.1 + 0.2, 1e12, -0.001])("refuses nonmicro/unsafe Number operands instead of repairing them: %s", value => {
  expect(() => economicRecord({ ...context, ...captureAuthorSplit(value, [1], allocateSplit(value, [1])) }, 0, 0)).toThrow();
});
it("bounds source observation failures and unavailable authority without changing old capture contracts", () => {
  const c = createReadCheckpointCapture(true, undefined, true, true); c.stop("evidence", 0);
  c.economic("query-budget", "portfolio", 0, 0, () => { throw Error("PRIVATE failure"); });
  c.economicUnavailable("reward-authority", "reward-withheld", 1);
  const result = c.finish(); expect(result?.status).toBe("available");
  if (result?.status === "available" && result.packet.schema === 4 && result.packet.economics.status === "available") {
    expect(result.packet.economics.records.map(row => row.status)).toEqual(["unavailable", "unavailable"]);
    expect(JSON.stringify(result.packet)).not.toContain("PRIVATE");
  }
  for (let i = 0; i < 256; i++) c.economicUnavailable("reward-authority", "reward-withheld", 1);
  const bounded = c.finish(); expect(bounded?.status === "available" && bounded.packet.schema === 4 && bounded.packet.economics).toEqual({ status: "unavailable", reason: "bounds" });
  expect(economicReplaySummary({ status: "available", policy: "query-economics-replay-v1", records: [] }).queryBudget).toBe("uncaptured");
});
it("v4 dispatch leaves old v1-v3 canonical policies and digests replayable", async () => {
  const v1 = createReadCheckpointCapture(true), check = { kind: "channel", creatorFree: false, cache: false } as const;
  v1.append(check, actualReadCheckpoint(check), { candidate: 1, round: 0, proposal: "BUY", plan: "BUY", price: 0.002, remaining: 0.03 });
  const old = v1.finish(); if (!old || old.status !== "available") throw Error("V1 missing");
  expect(canonicalReadPacket(old.packet)).toBe('{"schema":1,"policy":"actual-post-portfolio-read-v1","coverage":"post-portfolio-checkpoints","monetaryAuthority":"qualified-assertions-only","records":[{"sequence":0,"candidate":1,"round":0,"proposal":"BUY","plan":"BUY","facts":"assertions","check":{"kind":"channel","creatorFree":false,"cache":false},"outcome":{"action":"BUY","rule":"delivery-channel"},"amounts":{"priceMicros":"2000","remainingMicros":"30000"}}]}');
  const v2 = createReadCheckpointCapture(true, undefined, true); v2.stop("evidence", 0);
  const base = v2.finish(); if (!base || base.status !== "available") throw Error("V2 missing");
  const v3 = optimizerPacketFixture();
  for (const capture of [old, base, v3]) {
    expect(capture.packet.schema).not.toBe(4);
    expect(await verifyActualReadPacket(capture.packet, capture.retainedDigest)).toBe(true);
    expect(await actualReadPacketHash(capture.packet)).toBe(capture.retainedDigest);
    expect(await verifyActualReadPacket({ ...capture.packet, economics: { status: "unavailable", reason: "bounds" } }, capture.retainedDigest)).toBe(false);
  }
});
it("binds v4 public projection and WebCrypto to a separately retained digest, rejecting tamper/private/future/accessor packets", async () => {
  const capture = economicPacketFixture(); expect(await verifyActualReadPacket(capture.packet, capture.retainedDigest)).toBe(true);
  expect(await actualReadPacketHash(capture.packet)).toBe(capture.retainedDigest);
  expect(projectReadCheckpointCapture(capture)).toEqual(capture);
  const variants: unknown[] = [{ ...capture.packet, question: "PRIVATE" }, { ...capture.packet, schema: 5 }];
  const changed = structuredClone(capture.packet);
  if (changed.economics.status !== "available") throw Error("Fixture missing");
  const row = changed.economics.records[1]; if (row.status !== "available" || row.kind !== "author-split") throw Error("Fixture missing");
  row.outcome.legMicros = ["0", "1"]; variants.push(changed);
  const getter = vi.fn(() => capture.packet.economics), accessor = { ...capture.packet };
  Object.defineProperty(accessor, "economics", { get: getter }); variants.push(accessor);
  const toJSON = vi.fn(() => "1"), nested = structuredClone(capture.packet) as unknown as { economics: { records: { outcome: { legMicros?: unknown[] } }[] } };
  nested.economics.records[1].outcome.legMicros = [{ toJSON }, "0"]; variants.push(nested);
  const sparse = structuredClone(capture.packet);
  if (sparse.economics.status !== "available") throw Error("Fixture unavailable");
  delete sparse.economics.records[0]; variants.push(sparse);
  const extra = structuredClone(capture.packet);
  if (extra.economics.status !== "available") throw Error("Fixture unavailable");
  Object.defineProperty(extra.economics.records, Symbol("private"), { value: "PRIVATE" }); variants.push(extra);
  for (const packet of variants) expect(await verifyActualReadPacket(packet, capture.retainedDigest)).toBe(false);
  expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
  const run = { id: "prv_private", trace: [{ phase: "done", readCheckpoints: capture }] };
  expect(projectActualReadCheckpoints(run as never)).toBeNull();
  expect(() => canonicalReadPacket({ ...capture.packet, economics: { ...capture.packet.economics, grant: "PRIVATE" } })).toThrow();
  const grammar = actualReadOpenApiSchemas.ActualReadCheckpointCapture.oneOf;
  expect(JSON.stringify(grammar.at(-1))).toContain("ordinary-query-economics-v4");
});
