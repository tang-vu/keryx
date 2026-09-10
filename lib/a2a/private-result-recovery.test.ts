import { expect, it, vi } from "vitest";
import { createPrivateResultRecovery } from "./private-result-recovery";

it("bounds scans including unrelated entries, advances past failures and waits for a clean sweep", async () => {
  const entries = vi.fn(async function* () {
    yield null;
    for (let i = 0; i < 26; i++) yield i.toString(16).padStart(64, "0");
  });
  const restore = vi.fn().mockRejectedValueOnce(new Error("synthetic-private-detail"))
    .mockResolvedValue({ status: "restored" });
  const db = { savePrivateResearchResult: vi.fn() };
  const recovery = createPrivateResultRecovery(db, { entries, restore });
  expect(await recovery.tick()).toEqual({ status: "recovery", visited: 25, restored: 23, errors: 1, ready: false });
  expect(await recovery.tick()).toEqual({ status: "recovery", visited: 2, restored: 2, errors: 0, ready: false });
  expect(entries).toHaveBeenCalledTimes(1);
  expect(restore.mock.calls.at(-1)?.[1]).toBe("19".padStart(64, "0"));
  expect(await recovery.tick()).toMatchObject({ visited: 25, errors: 0, ready: false });
  expect(await recovery.tick()).toMatchObject({ visited: 2, errors: 0, ready: true });
  await recovery.close();
});

it("drains restoration on abort, refuses overlap and closes its directory iterator", async () => {
  const closed = vi.fn(), stop = new AbortController();
  const entries = async function* () { try { yield "a".repeat(64); yield "b".repeat(64); } finally { closed(); } };
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const restore = vi.fn(async () => { started(); await pending; return { status: "restored" as const }; });
  const recovery = createPrivateResultRecovery({ savePrivateResearchResult: vi.fn() }, { entries, restore });
  const tick = recovery.tick(stop.signal); await entered;
  expect(await recovery.tick()).toMatchObject({ visited: 0, ready: false });
  stop.abort(); finish();
  expect(await tick).toMatchObject({ visited: 1, restored: 1, ready: false });
  await recovery.close();
  expect(restore).toHaveBeenCalledTimes(1); expect(closed).toHaveBeenCalledTimes(1);
});

it("redacts scan errors and opens a new scan on the following tick", async () => {
  const entries = vi.fn(async function* (): AsyncGenerator<string | null> { throw new Error("synthetic-directory-detail"); });
  const recovery = createPrivateResultRecovery({ savePrivateResearchResult: vi.fn() }, { entries, restore: vi.fn() });
  expect(await recovery.tick()).toEqual({ status: "recovery", visited: 0, restored: 0, errors: 1, ready: false });
  await recovery.tick(); expect(entries).toHaveBeenCalledTimes(2);
  await recovery.close();
});
