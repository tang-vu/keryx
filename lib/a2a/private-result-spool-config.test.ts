import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { privateResultSpoolFromEnv } from "./private-result-spool-config";

it("rejects incomplete or relative configuration before filesystem work and opens an explicitly keyed spool", async () => {
  const root = await mkdtemp(join(tmpdir(), "keryx-spool-config-"));
  const directory = join(root, "spool");
  try {
    for (const env of [{}, { KERYX_PRIVATE_RESULT_SPOOL_DIRECTORY: directory },
      { KERYX_PRIVATE_RESULT_SPOOL_DIRECTORY: directory, KERYX_PRIVATE_RESULT_SPOOL_KEY: "synthetic-invalid-secret" },
      { KERYX_PRIVATE_RESULT_SPOOL_DIRECTORY: "relative-spool", KERYX_PRIVATE_RESULT_SPOOL_KEY: randomBytes(32).toString("hex") }]) {
      await expect(privateResultSpoolFromEnv(env)).rejects.toThrow(/^Private result backup configuration unavailable$/);
      expect(await readdir(root)).toEqual([]);
    }
    const spool = await privateResultSpoolFromEnv({ KERYX_PRIVATE_RESULT_SPOOL_DIRECTORY: directory,
      KERYX_PRIVATE_RESULT_SPOOL_KEY: randomBytes(32).toString("hex") });
    await expect(spool.read("a".repeat(64))).rejects.toThrow("Private result backup unavailable");
    expect(await readdir(directory)).toEqual([]);
  } finally { await rmdir(directory).catch(() => undefined); await rmdir(root); }
});
