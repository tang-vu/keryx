import { expect, it, vi } from "vitest";
import { runOperatorCycle, type OperatorCycleDependencies } from "./cycle";
import { inventory, liquidity, NOW } from "./fixtures.test-support";

function deps(): OperatorCycleDependencies {
  return { inventory: vi.fn().mockResolvedValue(inventory), liquidity: vi.fn().mockResolvedValue(liquidity),
    run: vi.fn().mockResolvedValue({ id: "original-paid-job", status: "completed" }),
    audit: vi.fn(async event => event.decision), publish: vi.fn().mockResolvedValue(undefined),
    now: () => NOW, acceptancePaused: () => false };
}
it("records a complete observed obligation -> decision -> original execution -> outcome cycle", async () => {
  const d = deps(); const sequence: string[] = [];
  d.audit = vi.fn(async event => { sequence.push(event.phase); return event.decision; });
  d.run = vi.fn(async () => { sequence.push("original-run"); return { id: "original", status: "completed" as const }; });
  await expect(runOperatorCycle(d)).resolves.toMatchObject({ status: "completed" });
  expect(sequence).toEqual(["decision", "original-run", "outcome"]);
  expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({ phase: "decision", inventory,
    decision: expect.objectContaining({ action: "run-next" }) }));
});
it("an audit failure prevents any order claim or signature", async () => {
  const d=deps(); d.audit=vi.fn().mockRejectedValue(new Error("disk full"));
  await expect(runOperatorCycle(d)).rejects.toThrow("disk full");
  expect(d.run).not.toHaveBeenCalled(); expect(d.publish).not.toHaveBeenCalled();
});
it.each(["inventory", "liquidity"] as const)("an unavailable %s keeps prepaid originals queued", async failure => {
  const d=deps(); d[failure]=vi.fn().mockRejectedValue(new Error("unavailable"));
  await expect(runOperatorCycle(d)).resolves.toBeNull(); expect(d.run).not.toHaveBeenCalled();
});
it.each([{ ...inventory, queuedJobs: 0, queuedCreatorMicroUsdc: "0", largestCreatorMicroUsdc: "0" },
  { ...inventory, processingJobs: 1, unfinishedCreatorMicroUsdc: "50000" }, { ...inventory, reviewRequiredJobs: 1, unfinishedCreatorMicroUsdc: "50000" },
  { ...inventory, invalidJobs: 1 }])("idle, active or invalid originals do not call a vendor", async i => {
  const d=deps(); d.inventory=vi.fn().mockResolvedValue(i);
  await runOperatorCycle(d); expect(d.liquidity).not.toHaveBeenCalled(); expect(d.run).not.toHaveBeenCalled();
});
it("rechecks snapshot freshness after a slow balance call", async () => {
  const d=deps(); let now=NOW; d.now=()=>now;
  d.liquidity=vi.fn(async()=> { now+=30_001; return liquidity; });
  await runOperatorCycle(d); expect(d.run).not.toHaveBeenCalled();
});
it("finite allowance pauses already-paid originals before balance observation", async () => {
  const d=deps(); d.acceptancePaused=()=>true;
  await runOperatorCycle(d); expect(d.run).not.toHaveBeenCalled(); expect(d.liquidity).not.toHaveBeenCalled();
});
it("metadata outage cannot discard a completed job or run it twice", async () => {
  const d=deps(); d.publish=vi.fn().mockRejectedValue(new Error("telemetry unavailable"));
  await expect(runOperatorCycle(d)).resolves.toMatchObject({ status: "completed" }); expect(d.run).toHaveBeenCalledTimes(1);
});
it("outcome audit failure never retries already-started research", async () => {
  const d=deps(); d.audit=vi.fn().mockImplementationOnce(async event=>event.decision).mockRejectedValueOnce(new Error("outcome unavailable"));
  await expect(runOperatorCycle(d)).rejects.toThrow("outcome unavailable"); expect(d.run).toHaveBeenCalledTimes(1);
});
it("preserves a recovery original before any fallible outcome record", async () => {
  const d=deps(); d.run=vi.fn().mockResolvedValue({id:"saved-original",status:"recovery_pending"});
  d.audit=vi.fn().mockImplementationOnce(async event=>event.decision).mockRejectedValueOnce(new Error("outcome disk full"));
  d.rememberOutcome=vi.fn();
  await expect(runOperatorCycle(d)).rejects.toThrow();
  expect(d.rememberOutcome).toHaveBeenCalledWith({id:"saved-original",status:"recovery_pending"});
  expect(d.run).toHaveBeenCalledTimes(1);
});
it("refuses a changed obligation inventory during balance observation",async()=>{
  const d=deps(); d.inventory=vi.fn().mockResolvedValueOnce(inventory).mockResolvedValueOnce({...inventory,queuedJobs:2,queuedCreatorMicroUsdc:"100000"});
  await runOperatorCycle(d); expect(d.run).not.toHaveBeenCalled();
  expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({decision:expect.objectContaining({reason:"incomplete-inventory"})}));
});
