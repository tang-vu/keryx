import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, unlink, rmdir, readdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { QueryRun } from "../types";
import { createPrivateResultSpool } from "./private-result-spool";

it("encrypts result and context, survives reopen, rejects tampering and retains data until database acknowledgement", async () => {
  const root = await mkdtemp(join(tmpdir(), "keryx-result-backup-")), directory = join(root, "spool");
  const key = randomBytes(32).toString("hex");
  const context = { id: `prv_${"a".repeat(64)}`, payer: `0x${"b".repeat(40)}`, workerId: randomUUID() };
  const run = { id: context.id, question: "Synthetic private backup question", budget: 0.03, researchMode: "quick",
    answer: "Synthetic private backup answer" } as QueryRun;
  try {
    const spool = await createPrivateResultSpool(directory, key);
    const first = await spool.save(context, run), second = await spool.save(context, run);
    const tokens = [];
    for await (const token of spool.entries()) tokens.push(token);
    expect(tokens.sort()).toEqual([first, second].sort());
    const original = await readFile(join(directory, `${first}.json`), "utf8");
    for (const secret of [key, context.id, context.payer, context.workerId, run.question, run.answer]) expect(original).not.toContain(secret);
    expect(await readFile(join(directory, `${second}.json`), "utf8")).not.toBe(original);
    const reopened = await createPrivateResultSpool(directory, key);
    expect(await reopened.read(first)).toEqual({ ...context, serializedRun: JSON.stringify(run) });
    const wrong = await createPrivateResultSpool(directory, randomBytes(32).toString("hex"));
    await expect(wrong.read(first)).rejects.toThrow("Private result backup unavailable");
    await expect(reopened.read("../outside")).rejects.toThrow("Private result backup unavailable");
    await writeFile(join(directory, `${second}.json`), original);
    await expect(reopened.read(second)).rejects.toThrow("Private result backup unavailable");
    const edited = JSON.parse(original); edited.tag = "0".repeat(32);
    await writeFile(join(directory, `${first}.json`), JSON.stringify(edited));
    await expect(reopened.read(first)).rejects.toThrow("Private result backup unavailable");
    await writeFile(join(directory, `${first}.json`), original);
    const save = vi.fn().mockRejectedValueOnce(new Error("synthetic-private-db-error"))
      .mockResolvedValueOnce({ id: context.id, serializedRun: "different" })
      .mockResolvedValueOnce({ id: context.id, serializedRun: JSON.stringify(run) });
    await expect(reopened.restore({ savePrivateResearchResult: save }, first)).rejects.toThrow("Private result restore unavailable");
    expect(await readFile(join(directory, `${first}.json`), "utf8")).toBe(original);
    await expect(reopened.restore({ savePrivateResearchResult: save }, first)).rejects.toThrow("Private result restore unavailable");
    expect(await reopened.restore({ savePrivateResearchResult: save }, first)).toEqual({ status: "restored" });
    expect(save).toHaveBeenLastCalledWith(context.id, context.payer, context.workerId, run);
    await expect(access(join(directory, `${first}.json`))).rejects.toThrow();
  } finally {
    for (const name of await readdir(directory).catch(() => [])) await unlink(join(directory, name));
    await rmdir(directory).catch(() => undefined); await rmdir(root);
  }
});

it("captures the closed packet before awaits and retains the encrypted original when restore drops metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "keryx-provenance-backup-")), directory = join(root, "spool");
  const key = randomBytes(32).toString("hex");
  const context = { id: `prv_${"d".repeat(64)}`, payer: `0x${"e".repeat(40)}`, workerId: randomUUID() };
  const provenance = { version: 1, surface: "agent-to-agent", ownershipMethod: "verified-payer" } as const;
  const run = { id: context.id, question: "Synthetic private provenance backup", budget: 0.03, researchMode: "quick",
    answer: "Synthetic private backup", asker: context.payer, provenance: { ...provenance } } as QueryRun;
  const serializedRun = JSON.stringify(run);
  try {
    const spool = await createPrivateResultSpool(directory, key);
    const pending = spool.save(context, run);
    run.provenance!.surface = "unknown";
    const token = await pending;
    const bytes = await readFile(join(directory, `${token}.json`), "utf8");
    for (const value of [context.id, context.payer, "verified-payer", "agent-to-agent", run.question]) expect(bytes).not.toContain(value);
    const reopened = await createPrivateResultSpool(directory, key);
    expect(await reopened.read(token)).toEqual({ ...context, serializedRun });
    const save = vi.fn(async (id: string, payer: string, workerId: string, restored: QueryRun) => {
      expect({ id, payer, workerId }).toEqual(context);
      expect(restored.provenance).toEqual(provenance);
      const withoutPacket = { ...restored };
      delete withoutPacket.provenance;
      return { id, format: "query-run-v1" as const, savedAt: "2026-09-09T00:00:00.000Z", serializedRun: JSON.stringify(withoutPacket) };
    });
    await expect(reopened.restore({ savePrivateResearchResult: save }, token)).rejects.toThrow("Private result restore unavailable");
    expect(await readFile(join(directory, `${token}.json`), "utf8")).toBe(bytes);
    expect(await reopened.read(token)).toEqual({ ...context, serializedRun });
    save.mockImplementationOnce(async (id, payer, workerId, restored) => {
      expect({ id, payer, workerId }).toEqual(context);
      expect(JSON.stringify(restored)).toBe(serializedRun);
      return { id, format: "query-run-v1", savedAt: "2026-09-09T00:00:00.000Z", serializedRun };
    });
    expect(await reopened.restore({ savePrivateResearchResult: save }, token)).toEqual({ status: "restored" });
    await expect(access(join(directory, `${token}.json`))).rejects.toThrow();
  } finally {
    for (const name of await readdir(directory).catch(() => [])) await unlink(join(directory, name));
    await rmdir(directory).catch(() => undefined); await rmdir(root);
  }
});
