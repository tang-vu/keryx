import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { afterEach, expect, it, vi } from "vitest";
import { NativeReadonlyTransport } from "./native-readonly-transport";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("./native-readonly-artifact", () => ({
  NATIVE_READONLY_PROTOCOL: "keryx-readonly-cli-v1",
  verifyNativeReadonlyArtifact: vi.fn(async () => ({})),
}));

class Stream extends EventEmitter {
  destroyed = false;
  destroy() { this.destroyed = true; return this; }
}

class Child extends EventEmitter {
  stdout = new Stream();
  stderr = new Stream();
  kill = vi.fn(() => true);
  unref = vi.fn();
}

const spawnMock = vi.mocked(spawn);
const protocol = Buffer.from('{"protocol":"keryx-readonly-cli-v1","engine":"keryx-engine"}\n');
const status = Buffer.from(JSON.stringify({ schema: "keryx-operator-task-status-v1", taskId: "task",
  createdAt: "2026-09-28T00:00Z", kind: "paid_research", network: "eip155:5042002",
  stage: "ready", buyerJobId: null, creatorBudgetMicros: 30000, maxTotalMicros: "100000",
  payment: "unknown", delivery: "unknown", lastObservation: null, savedResult: "absent",
  authority: "local" }));

function adapter(deadlineMs = 10_000) {
  return new NativeReadonlyTransport({ binaryPath: "/trusted/keryx-engine", manifestPath: "/trusted/manifest.json",
    expectedSourceCommit: "a".repeat(40), deadlineMs });
}

async function awaitSpawn(count: number) {
  for (let attempt = 0; attempt < 20 && spawnMock.mock.calls.length < count; attempt++) await Promise.resolve();
  expect(spawnMock).toHaveBeenCalledTimes(count);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  spawnMock.mockReset();
});

it("stays busy and drops stdio if a terminated child never confirms exit", async () => {
  vi.useFakeTimers();
  const child = new Child();
  spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  const controller = new AbortController();
  const transport = adapter();
  const inspection = transport.inspect("status", "/synthetic/task", controller.signal);
  await awaitSpawn(1);
  const rejection = expect(inspection).rejects.toMatchObject({ phase: "protocol",
    reason: "child exit could not be confirmed after termination" });
  controller.abort();
  await vi.advanceTimersByTimeAsync(2_001);
  await rejection;
  expect(child.kill).toHaveBeenCalledTimes(2);
  expect(child.stdout.destroyed).toBe(true);
  expect(child.stderr.destroyed).toBe(true);
  expect(child.unref).toHaveBeenCalledOnce();
  await expect(transport.inspect("status", "/synthetic/task"))
    .rejects.toThrow(/adapter busy or child exit unconfirmed/);
  expect(spawnMock).toHaveBeenCalledTimes(1);
});

it("rejects a successful close that arrives after the monotonic deadline before the timer runs", async () => {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const child = new Child();
  spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  const inspection = adapter(100).inspect("status", "/synthetic/task");
  await awaitSpawn(1);
  child.stdout.emit("data", protocol);
  now = 101;
  child.emit("close", 0, null);
  await expect(inspection).rejects.toMatchObject({ phase: "protocol", reason: "deadline exceeded" });
  expect(spawnMock).toHaveBeenCalledTimes(1);
});

it("rejects a valid response if parsing finishes after the shared deadline", async () => {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const children = [new Child(), new Child()];
  spawnMock.mockReturnValueOnce(children[0] as unknown as ReturnType<typeof spawn>)
    .mockReturnValueOnce(children[1] as unknown as ReturnType<typeof spawn>);
  const inspection = adapter(100).inspect("status", "/synthetic/task");
  await awaitSpawn(1);
  children[0].stdout.emit("data", protocol);
  children[0].emit("close", 0, null);
  await awaitSpawn(2);
  const parse = JSON.parse;
  vi.spyOn(JSON, "parse").mockImplementation((input: string) => {
    if (input.includes("keryx-operator-task-status-v1")) now = 101;
    return parse(input);
  });
  children[1].stdout.emit("data", status);
  children[1].emit("close", 0, null);
  await expect(inspection).rejects.toMatchObject({ phase: "command", reason: "deadline exceeded" });
});
