import { afterEach, expect, it, vi } from "vitest";
import type { KeryxDB } from "../db/keryx-db";
const steps = vi.hoisted(() => ({ incoming: vi.fn(), creators: vi.fn() }));
vi.mock("../gateway/private-incoming-reconciliation", () => ({ reconcilePrivateIncomingPayment: steps.incoming }));
vi.mock("../gateway/private-creator-reconciliation", () => ({ reconcilePrivateCreatorSubmissions: steps.creators }));
import { createPrivateReconciliation } from "./private-reconciliation";

afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });
const signer = `0x${"ab".repeat(20)}`, payer = `0x${"cd".repeat(20)}`;
const a = { id: `prv_${"1".repeat(64)}`, payer }, b = { id: `prv_${"2".repeat(64)}`, payer };
const clean = { confirmed: 0, processing: 0, awaiting: 0, failedObserved: 0, mismatched: 0, unavailable: 0, remaining: 0, nextCursor: null };

it("moves past unresolved incoming jobs, resumes creator pages and restarts complete sweeps", async () => {
  const select = vi.fn().mockResolvedValueOnce([a]).mockResolvedValueOnce([b]).mockResolvedValueOnce([]).mockResolvedValueOnce([a]);
  const db = { listPrivateReconciliationCandidates: select } as unknown as KeryxDB;
  steps.incoming.mockResolvedValueOnce({ status: "awaiting" }).mockResolvedValue({ status: "already-confirmed" });
  steps.creators.mockResolvedValueOnce({ ...clean, remaining: 1, nextCursor: "a".repeat(64), processing: 25 })
    .mockResolvedValueOnce({ ...clean, confirmed: 1 }).mockResolvedValue(clean);
  const runner = createPrivateReconciliation(db, signer);
  expect(await runner.tick()).toMatchObject({ awaiting: 1, visited: 1 });
  expect(steps.creators).not.toHaveBeenCalled();
  expect(await runner.tick()).toMatchObject({ processing: 25, remainingLegs: 1 });
  expect(await runner.tick()).toMatchObject({ creatorConfirmed: 1, remainingLegs: 0 });
  expect(select).toHaveBeenCalledTimes(2);
  expect(steps.creators.mock.calls[1][3]).toMatchObject({ cursor: "a".repeat(64), limit: 25 });
  expect(await runner.tick()).toMatchObject({ visited: 0 });
  const summary = await runner.tick();
  expect(select.mock.calls.map(call => call[1])).toEqual([undefined, a.id, b.id, undefined]);
  expect(JSON.stringify(summary)).not.toContain(payer);
  expect(JSON.stringify(summary)).not.toContain(a.id);
});

it("prevents overlap, drains on cancellation and redacts failures without stranding later jobs", async () => {
  const select = vi.fn().mockResolvedValueOnce([a]).mockResolvedValueOnce([b]);
  const db = { listPrivateReconciliationCandidates: select } as unknown as KeryxDB;
  let finish!: (value: { status: string }) => void;
  steps.incoming.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockRejectedValueOnce(new Error("Synthetic private error body"));
  const runner = createPrivateReconciliation(db, signer), stop = new AbortController();
  const active = runner.tick(stop.signal);
  await vi.waitFor(() => expect(steps.incoming).toHaveBeenCalledTimes(1));
  expect(await runner.tick()).toMatchObject({ errors: 1, visited: 0 });
  stop.abort(); finish({ status: "already-confirmed" }); await active;
  expect(steps.creators).not.toHaveBeenCalled();
  const failed = await runner.tick();
  expect(failed).toMatchObject({ errors: 1 });
  expect(JSON.stringify(failed)).not.toContain("Synthetic private error body");
  // The cancelled current job is retried read-only, then an error advances past it.
  steps.incoming.mockResolvedValue({ status: "awaiting" });
  await runner.tick();
  expect(select.mock.calls[1][1]).toBe(a.id);
});

it("passes a bounded cancellation signal to searches and refuses malformed selection pages", async () => {
  vi.useFakeTimers();
  const select = vi.fn().mockResolvedValue([a]);
  const db = { listPrivateReconciliationCandidates: select } as unknown as KeryxDB;
  steps.incoming.mockImplementation((_db, _id, _payer, options) => new Promise(resolve => {
    options.signal.addEventListener("abort", () => resolve({ status: "unavailable" }), { once: true });
  }));
  const runner = createPrivateReconciliation(db, signer);
  const active = runner.tick();
  await vi.advanceTimersByTimeAsync(30001);
  expect(await active).toMatchObject({ errors: 1, visited: 1 });
  expect(vi.getTimerCount()).toBe(0);
  select.mockResolvedValue([a, b]);
  expect(await runner.tick()).toMatchObject({ errors: 1, visited: 0 });
  expect(steps.incoming).toHaveBeenCalledTimes(1);
});
