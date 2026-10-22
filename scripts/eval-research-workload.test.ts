import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { workloadSnapshotHash, type WorkloadRead } from "../lib/evals/research-workload";

it("captures actual fixture PDF scope and image-only refusal through the CLI without model execution", async () => {
  const root = await realpath(tmpdir()), directory = await mkdtemp(join(root, "keryx-workload-pdf-"));
  const source = fileURLToPath(new URL("../", import.meta.url));
  const environment: NodeJS.ProcessEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => ["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT"].includes(key.toUpperCase()))), NODE_ENV: "test" };
  Object.assign(environment, { TEMP: directory, TMP: directory, NODE_ENV: "test", KERYX_NETWORK: "arcTestnet",
    NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1", KERYX_EXTERNAL_DISCOVERY: "0",
    NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "",
    TSX_TSCONFIG_PATH: join(source, "tsconfig.json") });
  try {
    await promisify(execFile)(process.execPath, ["--import", pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
      "--no-warnings", join(source, "scripts/eval-research-workload.mts"), "--capture", "--fixtures", "--case", "R13"],
    { cwd: directory, env: environment, timeout: 30_000, maxBuffer: 65536, windowsHide: true });
    const reads = JSON.parse(await readFile(join(directory, ".artifacts/workload-research/reads/R13.json"), "utf8")) as WorkloadRead[];
    expect(reads).toHaveLength(2); expect(reads[0].article?.kind).toBe("pdf");
    expect(reads[0].article?.pdfTextScope).toEqual({ format: "keryx-pdf-text-scope-v1", pagesRead: 1, totalPages: 1,
      pagesWithoutText: [], textLimitReached: false });
    expect(reads[0].snapshotSha256).toBe(workloadSnapshotHash(reads[0].article!));
    expect(reads[1].article).toBeUndefined(); expect(reads[1].failure).toBe("pdf-extraction-unavailable");
    expect(reads[1].snapshotSha256).toBeUndefined();
  } finally {
    const target = await realpath(directory);
    assert(resolve(target).startsWith(resolve(root) + sep) && basename(target).startsWith("keryx-workload-pdf-"));
    await rm(target, { recursive: true, force: true });
  }
}, 40_000);
