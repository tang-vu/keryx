import { mkdtemp, readdir, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { privateWorkerStatusWriter, readPrivateWorkerStatus, inspectPrivateWorkerConfiguration } from "./private-worker-status";

it("atomically replaces bounded advisory status and rejects stale, future or malformed observations", async () => {
  const root = await mkdtemp(join(tmpdir(), "keryx-worker-status-"));
  const file = join(root, "private-worker-status.json");
  try {
    expect(await readPrivateWorkerStatus(root)).toEqual({ status: "unavailable" });
    const configurationId = "a".repeat(64);
    const write = privateWorkerStatusWriter(root, "e508c1c", configurationId);
    await write("starting");
    const first = JSON.parse(await readFile(file, "utf8"));
    await write("idle");
    const idle = JSON.parse(await readFile(file, "utf8"));
    expect(idle.instance).toBe(first.instance);
    expect(await readdir(root)).toEqual(["private-worker-status.json"]);
    expect(await readPrivateWorkerStatus(root, idle.recordedAt)).toMatchObject({ status: "observed", phase: "idle", checkoutReady: false });
    expect(await inspectPrivateWorkerConfiguration(root, { configurationId, commit: "e508c1c" }, idle.recordedAt)).toEqual({ status: "matched", phase: "idle", checkoutReady: false });
    expect(await inspectPrivateWorkerConfiguration(root, { configurationId: "b".repeat(64), commit: "e508c1c" }, idle.recordedAt)).toMatchObject({ status: "mismatch", checkoutReady: false });
    expect(await inspectPrivateWorkerConfiguration(root, { configurationId, commit: "abcdef1" }, idle.recordedAt)).toMatchObject({ status: "mismatch" });
    expect(await readPrivateWorkerStatus(root, idle.recordedAt + 30001)).toEqual({ status: "stale" });
    expect(await readPrivateWorkerStatus(root, idle.recordedAt - 1)).toEqual({ status: "stale" });
    await writeFile(file, "x".repeat(4097));
    expect(await readPrivateWorkerStatus(root)).toEqual({ status: "unavailable" });
    await writeFile(file, JSON.stringify({ ...idle, question: "Synthetic private content" }));
    expect(await readPrivateWorkerStatus(root)).toEqual({ status: "unavailable" });
    await writeFile(file, JSON.stringify({ ...idle, schema: "keryx-private-worker-status-v1" }));
    expect(await readPrivateWorkerStatus(root)).toEqual({ status: "unavailable" });
    await write("stopped");
    expect(await readPrivateWorkerStatus(root)).toMatchObject({ phase: "stopped", checkoutReady: false });
  } finally {
    for (const entry of await readdir(root)) await unlink(join(root, entry));
    await rmdir(root);
  }
});
