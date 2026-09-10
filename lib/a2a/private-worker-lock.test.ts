import { mkdtemp, readdir, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { withPrivateWorkerLock } from "./private-worker-lock";

it("excludes overlapping work, drains it before release and permits a later owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "keryx-worker-lock-"));
  try {
    let entered!: () => void, finish!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const first = withPrivateWorkerLock(root, async () => { entered(); await pending; return "finished"; });
    await started;
    const original = await readFile(join(root, "private-worker.lock"), "utf8");
    const second = vi.fn(async () => {});
    await expect(withPrivateWorkerLock(root, second)).rejects.toThrow("inspect the existing lock");
    expect(second).not.toHaveBeenCalled();
    expect(await readFile(join(root, "private-worker.lock"), "utf8")).toBe(original);
    finish(); expect(await first).toBe("finished");
    expect(await readdir(root)).toEqual([]);
    await withPrivateWorkerLock(root, second); expect(second).toHaveBeenCalledTimes(1);
    await expect(withPrivateWorkerLock(root, async () => { throw new Error("Synthetic private detail"); })).rejects.toThrow(/^Private worker lock or operation unavailable;/);
    expect(await readdir(root)).toEqual([]);
  } finally { for (const file of await readdir(root)) await unlink(join(root, file)); await rmdir(root); }
});

it("never reclaims a partial crash reservation or deletes a replaced lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "keryx-worker-lock-")), file = join(root, "private-worker.lock");
  try {
    await writeFile(file, "");
    const run = vi.fn(async () => {});
    await expect(withPrivateWorkerLock(root, run)).rejects.toThrow("inspect the existing lock");
    expect(run).not.toHaveBeenCalled(); expect(await readFile(file, "utf8")).toBe("");
    await unlink(file);
    await expect(withPrivateWorkerLock(root, async () => { await writeFile(file, "Synthetic replacement"); })).rejects.toThrow("inspect the existing lock");
    expect(await readFile(file, "utf8")).toBe("Synthetic replacement");
  } finally { await unlink(file).catch(() => undefined); await rmdir(root); }
});
