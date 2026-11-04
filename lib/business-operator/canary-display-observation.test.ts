import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../app/api/research/availability/route";
import { assertOrdinaryResearchAvailable } from "../research/availability";
import { ResearchAdmissionHeldError } from "../research/availability-contract";
import { canaryExecutionPaused, canaryResearchPaused, canaryResearchPausedForDisplay, configuredBusinessCanary } from "./canary-policy";
import { cleanFulfillmentFixtures, fixtureCommit, fixtureFlush, fixtureNow, fulfillmentFixture } from "./fulfillment-test-fixture";
import { beginFailedOriginalFulfillment, closeFulfillmentCapability, fulfillmentDirectory, fulfillmentStep, reserveFulfillmentModel } from "./fulfillment-policy";
import { canaryResearchIsolationDirectory, inspectFailedCanaryResearchIsolation, isolateFailedCanaryResearch } from "./canary-research-isolation";

const git = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async original => ({ ...await original<typeof import("node:child_process")>(), execFileSync: git }));
const parent = os.homedir(), roots: string[] = [];
const digest = "a".repeat(64), queryId = `a2a_${"b".repeat(64)}`;
function completed() {
  const root = fs.mkdtempSync(path.join(parent, "keryx-display-test-")); roots.push(root); fs.chmodSync(root, 0o700);
  vi.spyOn(os, "homedir").mockReturnValue(root);
  const directory = path.join(root, ".local", "share", "keryx-business-canary");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const window = path.join(directory, "window.json"), closed = path.join(directory, "closed.json");
  const windowValue = { format: "keryx-business-canary-window-v1", approvalId: "operator-business-20261006",
    policyFile: path.join(root, "fixture-policy.json"), policySha256: digest, queryId,
    maximumOriginals: 1, maximumMicroUsdc: 60000, maximumMicroUsd: 250000 };
  const closedValue = { format: "keryx-business-canary-closed-v1", policySha256: digest, queryId, outcome: "verified-completed-original" };
  fs.writeFileSync(window, JSON.stringify(windowValue), { mode: 0o600 });
  fs.writeFileSync(closed, JSON.stringify(closedValue), { mode: 0o600 });
  return { root, directory, window, closed, windowValue, closedValue };
}
function held() { expect(canaryResearchPausedForDisplay()).toBe(true); expect(canaryResearchPaused()).toBe(true); }
async function isolatedFailure() {
  const value = await fulfillmentFixture();
  const admitted = await beginFailedOriginalFulfillment(value.db, value.binding, fixtureFlush);
  await fulfillmentStep(admitted.capability, "sufficiency", async () => reserveFulfillmentModel(admitted.capability, "fixture", "fixture", 1));
  await expect(fulfillmentStep(admitted.capability, "synthesize", async () => {
    reserveFulfillmentModel(admitted.capability, "fixture", "generation", 1); throw Error("Synthetic failure");
  })).rejects.toThrow("Synthetic failure");
  closeFulfillmentCapability(admitted.capability); vi.setSystemTime(value.authorization.expiresAt);
  const proof = await inspectFailedCanaryResearchIsolation(value.db);
  await isolateFailedCanaryResearch(value.db, proof.evidenceSha256, fixtureFlush);
  return value;
}
beforeEach(() => {
  vi.stubEnv("KERYX_BUSINESS_CANARY_FILE", undefined); vi.stubEnv("KERYX_BUSINESS_CANARY_SHA256", undefined);
  vi.useFakeTimers(); vi.setSystemTime(fixtureNow);
  git.mockImplementation((_command, args) => args?.[0] === "status" ? "" : `${fixtureCommit}\n`);
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("No provider permitted"); }));
});
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); cleanFulfillmentFixtures();
  for (const root of roots.splice(0)) {
    if (path.dirname(path.resolve(root)) !== parent || !path.basename(root).startsWith("keryx-display-test-")) throw Error("Fixture cleanup refused");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("one-operation advisory canary display", () => {
  it("performs one complete closure read while all existing admission observers retain their reads", () => {
    completed(); const reads = vi.spyOn(fs, "readFileSync");
    expect(canaryResearchPausedForDisplay()).toBe(false); expect(reads).toHaveBeenCalledTimes(2);
    reads.mockClear(); expect(canaryResearchPaused()).toBe(false); expect(reads).toHaveBeenCalledTimes(4);
    reads.mockClear(); expect(canaryExecutionPaused()).toBe(false); expect(reads).toHaveBeenCalledTimes(4);
    reads.mockClear(); expect(configuredBusinessCanary()).toBeNull(); expect(reads).toHaveBeenCalledTimes(2);
    reads.mockClear(); expect(() => assertOrdinaryResearchAvailable()).not.toThrow(); expect(reads).toHaveBeenCalledTimes(4);
    reads.mockClear(); expect(canaryResearchPausedForDisplay()).toBe(false); expect(reads).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("observes an absent registry without creating it or treating the observation as authority", () => {
    const value = completed(); fs.unlinkSync(value.closed); fs.unlinkSync(value.window); fs.rmdirSync(value.directory);
    expect(canaryResearchPausedForDisplay()).toBe(false); expect(canaryResearchPaused()).toBe(false);
    expect(fs.existsSync(value.directory)).toBe(false);
    fs.mkdirSync(value.directory, { mode: 0o700 }); held();
  });
  it("does not reuse a result after closure removal or replacement on the next GET", async () => {
    const value = completed(); expect((await GET().json()).state).toBe("not-paused");
    fs.unlinkSync(value.closed); expect((await GET().json()).state).toBe("paused");
    fs.writeFileSync(value.closed, JSON.stringify(value.closedValue), { mode: 0o600 });
    expect((await GET().json()).state).toBe("not-paused");
    fs.writeFileSync(value.closed, "{}"); expect((await GET().json()).state).toBe("paused");
  });
  it("cannot admit a request when a hold changes after the display's validated read", async () => {
    const value = completed(), close = fs.closeSync; let closedFiles = 0;
    vi.spyOn(fs, "closeSync").mockImplementation(fd => {
      close(fd); if (++closedFiles === 2) fs.writeFileSync(value.closed, "{}");
    });
    expect((await GET().json()).state).toBe("not-paused");
    expect(() => assertOrdinaryResearchAvailable()).toThrow(ResearchAdmissionHeldError);
    expect(canaryExecutionPaused()).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    ["KERYX_BUSINESS_CANARY_FILE", ""], ["KERYX_BUSINESS_CANARY_FILE", "fixture"],
    ["KERYX_BUSINESS_CANARY_SHA256", digest],
  ])("fails closed for partial selector %s=%j", (name, value) => { completed(); vi.stubEnv(name, value); held(); });
  it.each(["window.json", "closed.json"])("fails closed for a missing required %s", name => {
    const value = completed(); fs.unlinkSync(path.join(value.directory, name)); held();
  });
  it.each(["not JSON", "[]", "{}", "null"])("fails closed for malformed retained metadata %s", bytes => {
    const value = completed(); fs.writeFileSync(value.window, bytes); held();
  });
  it.each([
    { policySha256: "f".repeat(64) }, { queryId: `a2a_${"f".repeat(64)}` },
    { outcome: "verified-failed-original" }, { extra: "private fixture data" },
  ])("rejects an altered terminal closure %j", change => {
    const value = completed(); fs.writeFileSync(value.closed, JSON.stringify({ ...value.closedValue, ...change })); held();
  });
  it("retains the bounded protected file reader", () => {
    const value = completed(); fs.writeFileSync(value.closed, " ".repeat(65537)); held();
  });
  it("rejects a directory in place of a retained record", () => {
    const value = completed(); fs.unlinkSync(value.closed); fs.mkdirSync(value.closed, { mode: 0o700 }); held();
  });
  it("rejects a hard-linked retained record", () => {
    const value = completed(); fs.linkSync(value.closed, path.join(value.root, "other-closure.json")); held();
  });
  it.skipIf(process.platform === "win32")("rejects writable POSIX metadata and ancestors", () => {
    const value = completed(); fs.chmodSync(value.closed, 0o644); held();
    fs.chmodSync(value.closed, 0o600); fs.chmodSync(value.root, 0o777); held();
    fs.chmodSync(value.root, 0o700);
  });
  it("retains active and expired selector refusal", async () => {
    const value = await fulfillmentFixture();
    fs.unlinkSync(path.join(value.oldDirectory, "closed.json"));
    vi.stubEnv("KERYX_BUSINESS_CANARY_FILE", path.join(value.root, "old-policy.json"));
    vi.stubEnv("KERYX_BUSINESS_CANARY_SHA256", value.old.policySha256);
    held(); vi.setSystemTime(value.authorization.expiresAt); held();
  });
  it("retains unresolved paid delivery and never reads the native DB for display", async () => {
    const value = await fulfillmentFixture(); vi.clearAllMocks(); held();
    expect(canaryExecutionPaused()).toBe(true);
    for (const name of ["getA2aOrder", "getQueryRun", "hasA2aOriginalSettlement", "listCreatorPaymentAttemptsByQuery"] as const)
      expect(value.db[name]).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("observes verified isolation without clearing Operator authority or original holds", async () => {
    const value = await isolatedFailure();
    const original = fs.readdirSync(value.oldDirectory).sort().map(name => [name, fs.readFileSync(path.join(value.oldDirectory, name), "hex")]);
    expect(canaryResearchPausedForDisplay()).toBe(false); expect(canaryResearchPaused()).toBe(false);
    expect(canaryExecutionPaused()).toBe(true);
    expect(fs.readdirSync(value.oldDirectory).sort().map(name => [name, fs.readFileSync(path.join(value.oldDirectory, name), "hex")])).toEqual(original);
    fs.unlinkSync(path.join(canaryResearchIsolationDirectory(), "isolated.json")); held();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("revalidates the entire failed closure and isolation ledger on each observation", async () => {
    await isolatedFailure(); expect(canaryResearchPausedForDisplay()).toBe(false);
    const hold = path.join(fulfillmentDirectory(), "model-03.json"), original = fs.readFileSync(hold);
    fs.writeFileSync(hold, JSON.stringify({ ...JSON.parse(original.toString()), inputBytes: 100 })); held();
    fs.writeFileSync(hold, original); expect(canaryResearchPausedForDisplay()).toBe(false);
  });
});
