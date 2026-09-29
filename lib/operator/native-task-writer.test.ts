import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { afterEach, expect, it, vi } from "vitest";
import { verifyNativeWriterArtifact } from "./native-writer-artifact";
import { NativeTaskWriter } from "./native-task-writer";

vi.mock("node:child_process", () => ({ spawn: vi.fn(), spawnSync: vi.fn() }));
vi.mock("./native-writer-artifact", () => ({ NATIVE_WRITER_PROTOCOL: "keryx-task-writer-cli-v1",
  verifyNativeWriterArtifact: vi.fn(async () => ({})) }));

class Stream extends EventEmitter {
  destroyed = false;
  destroy() { this.destroyed = true; return this; }
  end = vi.fn();
}
class Child extends EventEmitter {
  stdout = new Stream(); stderr = new Stream(); stdin = new Stream();
  kill = vi.fn(() => true); unref = vi.fn();
}
const spawned = vi.mocked(spawn);
const verified = vi.mocked(verifyNativeWriterArtifact);
const source = "a".repeat(40);
const id = "123e4567-e89b-42d3-a456-426614174000";
const input = { parent: "/owned/private", child: "task-1", request: { question: "Q" },
  payee: `0x${"a".repeat(40)}`, maxTotalMicros: "100000", id, createdAt: "2026-09-29T00:00:00Z" };
const hello = { protocol: "keryx-task-writer-cli-v1", engine: "keryx-engine" };
const success = { protocol: hello.protocol, operation: "create", taskId: id, child: "task-1", state: "unix_synced" };
const writer = (deadlineMs = 10_000) => new NativeTaskWriter({ binaryPath: "/trusted/keryx-engine",
  manifestPath: "/trusted/manifest.json", expectedSourceCommit: source, deadlineMs });

async function awaitSpawn(count: number) {
  for (let i = 0; i < 50 && spawned.mock.calls.length < count; i++) await Promise.resolve();
  expect(spawned).toHaveBeenCalledTimes(count);
}
function close(child: Child, value: unknown, code = 0, stderr?: string) {
  child.stdout.emit("data", Buffer.from(JSON.stringify(value) + "\n"));
  if (stderr) child.stderr.emit("data", Buffer.from(stderr));
  child.emit("close", code, null);
}
async function helloThenCommand(response: unknown, exitCode = 0, stderr?: string) {
  const protocolChild = new Child();
  const commandChild = new Child();
  spawned.mockReturnValueOnce(protocolChild as never).mockReturnValueOnce(commandChild as never);
  await awaitSpawn(1);
  close(protocolChild, hello);
  await awaitSpawn(2);
  close(commandChild, response, exitCode, stderr);
}
afterEach(() => { vi.useRealTimers(); spawned.mockReset(); verified.mockReset(); verified.mockResolvedValue({} as never); });

it("rejects untrusted artifact and oversized input before any child launches", async () => {
  verified.mockRejectedValueOnce(new Error("bad hash"));
  await expect(writer().create(input)).rejects.toMatchObject({ state: "refused_unchanged", stage: "artifact" });
  await expect(writer().create({ ...input, request: { question: "x".repeat(17_000) } }))
    .rejects.toMatchObject({ state: "refused_unchanged", stage: "input" });
  expect(spawned).not.toHaveBeenCalled();
});

it("refuses wrong writer protocol before a mutating process launches", async () => {
  const child = new Child(); spawned.mockReturnValueOnce(child as never);
  const task = writer().create(input);
  await awaitSpawn(1);
  close(child, { ...hello, protocol: "wrong" });
  await expect(task).rejects.toMatchObject({ state: "refused_unchanged", stage: "protocol" });
  expect(spawned).toHaveBeenCalledTimes(1);
});

it.each(["retained_partial", "complete_unconfirmed", "refused_unchanged"])(
  "preserves typed native %s without retrying", async state => {
    const task = writer().create(input);
    const rejected = expect(task).rejects.toMatchObject({ state, stage: "publication" });
    await helloThenCommand({ protocol: hello.protocol, operation: "create", state,
      stage: "publication", message: "bounded refusal" }, 1);
    await rejected;
    expect(spawned).toHaveBeenCalledTimes(2);
  });

it("accepts exact create success, but treats malformed or noisy success as unknown", async () => {
  const accepted = writer().create(input);
  await helloThenCommand(success);
  await expect(accepted).resolves.toEqual({ taskId: id, child: "task-1", state: "unix_synced" });
  spawned.mockReset();
  const malformed = writer().create(input);
  await helloThenCommand({ ...success, taskId: "different" }, 0, "native debug");
  await expect(malformed).rejects.toMatchObject({ state: "unknown" });
});

it("accepts only a matching workspace child and refuses an already-aborted request before launch", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(writer().createWorkspace("/owned", "new-workspace", controller.signal))
    .rejects.toMatchObject({ state: "refused_unchanged", stage: "input" });
  expect(spawned).not.toHaveBeenCalled();
  const accepted = writer().createWorkspace("/owned", "new-workspace");
  await helloThenCommand({ protocol: hello.protocol, operation: "workspace-create", child: "new-workspace",
    state: "unix_synced" });
  await expect(accepted).resolves.toEqual({ child: "new-workspace", state: "unix_synced" });
  spawned.mockReset();
  const mismatch = writer().createWorkspace("/owned", "new-workspace");
  await helloThenCommand({ protocol: hello.protocol, operation: "workspace-create", child: "another",
    state: "unix_synced" });
  await expect(mismatch).rejects.toMatchObject({ state: "unknown", stage: "response" });
});

it("keeps concurrent writes out and poisons the adapter if a canceled child never confirms exit", async () => {
  vi.useFakeTimers();
  const protocolChild = new Child(); const commandChild = new Child();
  spawned.mockReturnValueOnce(protocolChild as never).mockReturnValueOnce(commandChild as never);
  const controller = new AbortController(); const adapter = writer();
  const task = adapter.create(input, controller.signal);
  await awaitSpawn(1); close(protocolChild, hello); await awaitSpawn(2);
  await expect(adapter.create({ ...input, child: "task-2" }))
    .rejects.toMatchObject({ stage: "adapter" });
  controller.abort();
  const rejected = expect(task).rejects.toMatchObject({ state: "unknown", stage: "transport" });
  await vi.advanceTimersByTimeAsync(2_001); await rejected;
  expect(commandChild.kill).toHaveBeenCalled();
  expect(commandChild.stdout.destroyed).toBe(true);
  expect(commandChild.unref).toHaveBeenCalledOnce();
  await expect(adapter.create(input)).rejects.toMatchObject({ stage: "adapter" });
  expect(spawned).toHaveBeenCalledTimes(2);
});

it("uses one deadline across protocol and mutation and kills an over-deadline writer", async () => {
  vi.useFakeTimers();
  let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
  const protocolChild = new Child(); const commandChild = new Child();
  spawned.mockReturnValueOnce(protocolChild as never).mockReturnValueOnce(commandChild as never);
  const task = writer(100).create(input);
  await awaitSpawn(1);
  now = 99; close(protocolChild, hello);
  await awaitSpawn(2);
  const rejected = expect(task).rejects.toMatchObject({ state: "unknown", stage: "transport" });
  await vi.advanceTimersByTimeAsync(2);
  expect(commandChild.kill).toHaveBeenCalledOnce();
  commandChild.emit("close", null, "SIGKILL");
  await rejected;
  expect(spawned).toHaveBeenCalledTimes(2);
});

it.each(["stdout", "stderr"] as const)("kills and bounds %s from a mutating child", async stream => {
  const protocolChild = new Child(); const commandChild = new Child();
  spawned.mockReturnValueOnce(protocolChild as never).mockReturnValueOnce(commandChild as never);
  const task = writer().create(input);
  await awaitSpawn(1); close(protocolChild, hello); await awaitSpawn(2);
  const rejected = expect(task).rejects.toMatchObject({ state: "unknown", stage: "transport" });
  commandChild[stream].emit("data", Buffer.alloc(8_193, 65));
  expect(commandChild.kill).toHaveBeenCalledOnce();
  commandChild.emit("close", null, "SIGKILL");
  await rejected;
  expect(spawned).toHaveBeenCalledTimes(2);
});
