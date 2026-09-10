import { beforeEach, expect, it, vi } from "vitest";
import type { KeryxDB } from "../db/keryx-db";
const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("./run-private-research", () => ({ runPrivateResearch: mocks.run }));
import { createPrivateWorker } from "./private-worker";

beforeEach(() => mocks.run.mockReset());
const id = (n: number) => `prv_${n.toString(16).padStart(64, "0")}`;
const payer = `0x${"b".repeat(40)}`;
const row = (n: number) => ({ id: id(n), payer });
function fixture() {
  const list = vi.fn(), result = vi.fn(async () => ({ synthetic: true }));
  const db = { listPrivateWorkerCandidates: list, getPrivateResearchResult: result } as unknown as KeryxDB;
  const options = { signerAddress: `0x${"a".repeat(40)}`, signer: { createPaymentPayload: vi.fn() },
    getGatewayBalance: vi.fn(async () => BigInt(0)), privateProvider: { modelId: "deepseek-flash", provider: "deepseek" as const,
      baseUrl: "https://synthetic.example/v1", apiKey: "synthetic-not-secret" } };
  return { list, result, db, options, worker: createPrivateWorker(db, options) };
}

it("continues after one job fails, pages serially and resets the cursor after a sweep", async () => {
  const { worker, list, options } = fixture();
  list.mockResolvedValueOnce(Array.from({ length: 25 }, (_, n) => row(n+1))).mockResolvedValueOnce([row(26)]).mockResolvedValueOnce([]);
  let active = 0, maximum = 0;
  mocks.run.mockImplementation(async (_db, job) => {
    maximum = Math.max(maximum, ++active); await Promise.resolve(); active--;
    if (job === id(1)) throw new Error("synthetic-private-question-and-key");
    return { status: "completed", run: { answer: "synthetic-private-answer" } };
  });
  options.privateProvider.baseUrl = "https://changed.example";
  const first = await worker.tick();
  expect(first).toMatchObject({ status: "processed", visited: 25, completed: 24, errors: 1 });
  expect(JSON.stringify(first)).not.toContain("synthetic-private");
  expect(JSON.stringify(first)).not.toContain("prv_");
  await worker.tick(); await worker.tick();
  expect(list.mock.calls.map(call => call[1])).toEqual([undefined, id(25), undefined]);
  expect(maximum).toBe(1);
  expect(mocks.run.mock.calls[0][3].privateProvider.baseUrl).toBe("https://synthetic.example/v1");
});

it("reports actual provider and fallback use separately from successful result storage", async () => {
  const { worker, list } = fixture();
  list.mockResolvedValue([row(1), row(2), row(3), row(4)]);
  mocks.run.mockResolvedValueOnce({ status: "completed", run: { reasoningAttempts: [
    { tier: 0, outcome: "failed", error: "network", engine: "synthetic-private-engine" }, { tier: 1, outcome: "served" },
  ] } }).mockResolvedValueOnce({ status: "completed", run: { reasoningAttempts: [
    { tier: 0, outcome: "served" }, { tier: 0, outcome: "circuit-open" }, { tier: 1, outcome: "served" },
  ] } }).mockResolvedValueOnce({ status: "completed", run: { reasoningAttempts: [{ tier: 0, outcome: "served" }] } })
    .mockResolvedValueOnce({ status: "completed", run: {} });
  const report = await worker.tick();
  expect(report).toMatchObject({ completed: 4, errors: 0, providerServedJobs: 2, providerFailedJobs: 2, fallbackJobs: 2, reasoningUnknownJobs: 1 });
  expect(JSON.stringify(report)).not.toContain("synthetic-private-engine");
});

it("excludes overlapping ticks and pauses only between executions", async () => {
  const { worker, list } = fixture();
  const abort = new AbortController();
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  list.mockResolvedValueOnce([row(1), row(2)]).mockResolvedValueOnce([row(2)]);
  mocks.run.mockImplementationOnce(async () => { await waiting; abort.abort(); return { status: "already-claimed" }; })
    .mockResolvedValue({ status: "stored", result: { private: true } });
  const first = worker.tick(abort.signal);
  expect(await worker.tick()).toEqual({ status: "busy" });
  release();
  expect(await first).toMatchObject({ status: "paused", visited: 1, alreadyClaimed: 1 });
  expect(await worker.tick()).toMatchObject({ status: "processed", visited: 1, stored: 1 });
  expect(list.mock.calls[1][1]).toBe(id(1));
});

it("does not label an unpersisted answer complete and refuses invalid candidate order", async () => {
  const { worker, list, result } = fixture();
  result.mockResolvedValue(null as never);
  mocks.run.mockResolvedValue({ status: "completed", run: { answer: "synthetic-private-answer" } });
  list.mockResolvedValueOnce([row(1)]).mockResolvedValueOnce([row(3), row(2)]).mockRejectedValueOnce(new Error("synthetic-private-db-error"));
  expect(await worker.tick()).toMatchObject({ status: "processed", completed: 0, unpersisted: 1 });
  expect(await worker.tick()).toMatchObject({ status: "scan-unavailable", visited: 0 });
  expect(await worker.tick()).toMatchObject({ status: "scan-unavailable", visited: 0 });
  expect(mocks.run).toHaveBeenCalledTimes(1);
});
