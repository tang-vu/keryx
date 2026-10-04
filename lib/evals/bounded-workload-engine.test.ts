import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoundedWorkloadEngine, WorkloadModelBudget } from "./bounded-workload-engine";

class ProbeEngine extends BoundedWorkloadEngine {
  invoke() { return this.chatJson("ignored", "system", "user", 2048); }
}

describe("one retained live workload allowance", () => {
  let directory: string;
  let file: string;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-04T10:00:00Z"));
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-workload-budget-"));
    file = path.join(directory, "budget.json");
  });
  afterEach(() => {
    vi.restoreAllMocks(); vi.useRealTimers();
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith("keryx-workload-budget-"))
      throw new Error("Unexpected temporary directory");
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("rejects a second owner and preserves all reservations when reopened", () => {
    const first = new WorkloadModelBudget(file);
    first.reserve("a", "b", 2048);
    expect(() => new WorkloadModelBudget(file)).toThrow();
    const before = first.snapshot(); first.close();
    const second = new WorkloadModelBudget(file);
    expect(second.snapshot()).toEqual(before);
    expect(() => first.reserve("a", "b", 2048)).toThrow("closed");
    second.close();
  });

  it("refuses a request before exceeding the shared dollar cap", () => {
    const budget = new WorkloadModelBudget(file);
    for (let count = 0; count < 14; count++) budget.reserve("a".repeat(190_000), "", 8192);
    const before = budget.snapshot();
    expect(before.reservedMicroUsd).toBeLessThanOrEqual(1_000_000);
    expect(() => budget.reserve("a".repeat(190_000), "", 8192)).toThrow("exhausted");
    expect(budget.snapshot()).toEqual(before);
    budget.close();
  });

  it("retains a failed call and halts after an authorization error without retrying", async () => {
    const budget = new WorkloadModelBudget(file);
    const network = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("private provider body", { status: 401 }));
    const engine = new ProbeEngine("synthetic-test-key", budget);
    await expect(engine.invoke()).rejects.toThrow("Workload provider request failed (401)");
    await expect(engine.invoke()).rejects.toThrow("halted");
    expect(network).toHaveBeenCalledTimes(1);
    expect(budget.snapshot().calls).toBe(1);
    expect(budget.snapshot().reservedMicroUsd).toBeGreaterThan(0);
    budget.close();
  });

  it("does not send HTTP if the reservation cannot be committed", async () => {
    const budget = new WorkloadModelBudget(file);
    const network = vi.spyOn(globalThis, "fetch");
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw new Error("disk unavailable"); });
    await expect(new ProbeEngine("synthetic-test-key", budget).invoke()).rejects.toThrow("disk unavailable");
    expect(network).not.toHaveBeenCalled();
    budget.close();
  });

  it("does not reset malformed state or silently remove an uncertain lock", () => {
    fs.writeFileSync(file, "{");
    expect(() => new WorkloadModelBudget(file)).toThrow();
    expect(fs.existsSync(`${file}.lock`)).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe("{");
  });

  it("requires renewed price verification outside the dated run", () => {
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
    expect(() => new WorkloadModelBudget(file)).toThrow("Revalidate");
    expect(fs.existsSync(file)).toBe(false);
  });
});
