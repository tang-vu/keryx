import { expect, it, vi } from "vitest";
import { runWithdrawalCyclePass } from "./withdrawal-cycle";

const page = (nextCursor: string | null = null) => ({ state: nextCursor ? "limited" as const : "scanned" as const,
  scanned: 1, attached: 0, awaitingEvidence: 1, unavailable: 0, nextCursor });
const relayResult = { state: "waiting" as const, reason: "receipt-not-observed", observed: 0, signed: 0, broadcastAttempts: 0 };
const id = (value: number) => `0x${value.toString(16).padStart(64, "0")}`;

it("sweeps every page, relays once, and still reports observations when a mint is pending", async () => {
  const calls: string[] = [];
  const operations = {
    queue: vi.fn(async (cursor: string | undefined) => { calls.push(`queue:${cursor ?? "start"}`); return page(cursor ? null : id(1)); }),
    relay: vi.fn(async () => { calls.push("relay"); return relayResult; }),
    report: vi.fn(async () => { calls.push("report"); return { state: "scanned" as const, scanned: 1, recorded: 1, notObserved: 0, unavailable: 0, nextCursor: null }; }),
  };
  const result = await runWithdrawalCyclePass(operations, new AbortController().signal);
  expect(calls).toEqual(["queue:start", `queue:${id(1)}`, "relay", "report"]);
  expect(result).toMatchObject({ state: "finished", queue: { pages: 2, scanned: 2, pending: 2 }, relay: relayResult,
    report: { pages: 1, scanned: 1, pending: 0 } });
  await runWithdrawalCyclePass(operations, new AbortController().signal);
  expect(operations.queue.mock.calls[2][0]).toBeUndefined(); // Later pass revisits missing evidence.
});

it("contains queue/relay exceptions and continues independent reporting without leaking diagnostics", async () => {
  const operations = { queue: vi.fn(async () => { throw new Error("private queue diagnostic"); }),
    relay: vi.fn(async () => { throw new Error("private relay diagnostic"); }), report: vi.fn(async () => page()) };
  const result = await runWithdrawalCyclePass(operations, new AbortController().signal);
  expect(result).toMatchObject({ state: "finished", queue: { state: "unavailable" }, relay: null, report: { state: "scanned" } });
  expect(operations.relay).toHaveBeenCalledTimes(1); expect(operations.report).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(result)).not.toContain("diagnostic");
});

it("bounds paging and rejects stalled/malformed cursors before another page", async () => {
  let count = 0;
  const queue = vi.fn(async () => page(id(++count)));
  const result = await runWithdrawalCyclePass({ queue, relay: async () => relayResult, report: async () => page() }, new AbortController().signal);
  expect(queue).toHaveBeenCalledTimes(32); expect(result.queue).toMatchObject({ state: "limited", pages: 32, nextCursor: id(32) });
  for (const bad of [{ ...page(id(1)), scanned: 33 }, { ...page(), nextCursor: "private-invalid-id" },
    { ...page(id(1)), scanned: 0 }, { ...page(), unavailable: 2 }]) {
    const queue = vi.fn(async () => bad);
    expect((await runWithdrawalCyclePass({ queue, relay: async () => relayResult, report: async () => page() }, new AbortController().signal))
      .queue.state).toBe("unavailable");
    expect(queue).toHaveBeenCalledTimes(1);
  }
  const repeated = vi.fn(async () => page(id(1)));
  expect((await runWithdrawalCyclePass({ queue: repeated, relay: async () => relayResult, report: async () => page() }, new AbortController().signal))
    .queue.state).toBe("unavailable");
  expect(repeated).toHaveBeenCalledTimes(2);
});

it("waits for in-flight phase settlement after cancellation and never starts another phase", async () => {
  const stop = new AbortController(); let finish!: () => void, settled = false;
  const queue = vi.fn(() => new Promise<ReturnType<typeof page>>(resolve => { finish = () => resolve(page()); }));
  const relay = vi.fn(async () => relayResult), report = vi.fn(async () => page());
  const pending = runWithdrawalCyclePass({ queue, relay, report }, stop.signal).finally(() => { settled = true; });
  stop.abort(); await Promise.resolve(); expect(settled).toBe(false);
  finish(); expect((await pending).state).toBe("aborted");
  expect(relay).not.toHaveBeenCalled(); expect(report).not.toHaveBeenCalled();
  const duringRelay = new AbortController();
  const result = await runWithdrawalCyclePass({ queue: async () => page(),
    relay: async () => { duringRelay.abort(); return relayResult; }, report }, duringRelay.signal);
  expect(result.state).toBe("aborted"); expect(report).not.toHaveBeenCalled();
});
