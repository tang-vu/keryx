import { afterEach, expect, test } from "vitest";
import { mkdtemp, open, link, unlink, readFile, readdir, rm, mkdir, writeFile, symlink, stat, lstat, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BriefExportError, publishPrivateBrief, type BriefExportFs } from "./operator-brief-export.mjs";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "keryx-brief-export-"));
  roots.push(root);
  return { root, final: join(root, "brief.md") };
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function stages(root: string) {
  return (await readdir(root)).filter((name) => name.startsWith(".keryx-brief-"));
}

type Fault = "write" | "sync" | "close" | "write-unlink" | "sync-unlink" | "link" | "link-then-error" | "unlink";
function faultFs(fault: Fault): BriefExportFs {
  return {
    async open(path, flags, mode) {
      const file = await open(path, flags, mode);
      return {
        async writeFile(data) {
          if (fault === "write" || fault === "write-unlink") {
            await file.writeFile(data.slice(0, 3));
            throw new Error("injected write failure");
          }
          await file.writeFile(data);
        },
        async sync() {
          if (fault === "sync" || fault === "sync-unlink") throw new Error("injected sync failure");
          await file.sync();
        },
        async close() {
          await file.close();
          if (fault === "close") throw new Error("injected close failure");
        },
      };
    },
    async link(source, target) {
      if (fault === "link") throw new Error("injected link failure");
      await link(source, target);
      if (fault === "link-then-error") throw new Error("injected ambiguous link failure");
    },
    async unlink(path) {
      if (fault === "unlink" || fault === "write-unlink" || fault === "sync-unlink") throw new Error("injected cleanup failure");
      await unlink(path);
    },
  };
}

test("publishes complete private bytes and removes staging", async () => {
  const { root, final } = await fixture();
  await expect(publishPrivateBrief(final, "🌍 private\n")).resolves.toEqual({ saved: final, private: true });
  expect(await readFile(final, "utf8")).toBe("🌍 private\n");
  expect(await stages(root)).toEqual([]);
  if (process.platform !== "win32") expect((await stat(final)).mode & 0o777).toBe(0o600);
});

test.each(["write", "sync", "close"] as const)("%s failure cannot publish partial plaintext", async (fault) => {
  const { root, final } = await fixture();
  await expect(publishPrivateBrief(final, "complete", faultFs(fault))).rejects.toMatchObject({
    publication: "not-published", step: `${fault} staging file`,
  });
  await expect(readFile(final)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await stages(root)).toEqual([]);
});

test.each(["write-unlink", "sync-unlink"] as const)("%s reports retained staging without publishing", async (fault) => {
  const { root, final } = await fixture();
  const error = await publishPrivateBrief(final, "complete", faultFs(fault)).catch((value: unknown) => value);
  expect(error).toMatchObject({ publication: "not-published", stagingRemains: true });
  expect((error as Error).message).toContain("Inspect and remove the owned staging file");
  await expect(readFile(final)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await stages(root)).toHaveLength(1);
});

test.each(["link", "link-then-error"] as const)("%s error reports unconfirmed and leaves any published final intact", async (fault) => {
  const { root, final } = await fixture();
  const error = await publishPrivateBrief(final, "complete", faultFs(fault)).catch((value: unknown) => value);
  expect(error).toBeInstanceOf(BriefExportError);
  expect(error).toMatchObject({ publication: "unconfirmed", step: "publish final file" });
  expect((error as Error).message).toContain("inspect the final path before retrying");
  if (fault === "link") await expect(readFile(final)).rejects.toMatchObject({ code: "ENOENT" });
  else expect(await readFile(final, "utf8")).toBe("complete");
  expect(await stages(root)).toEqual([]);
});

test("cleanup error reports published final and retains owned staging file", async () => {
  const { root, final } = await fixture();
  await expect(publishPrivateBrief(final, "complete", faultFs("unlink"))).rejects.toMatchObject({
    publication: "published", step: "remove staging file", stagingRemains: true,
  });
  expect(await readFile(final, "utf8")).toBe("complete");
  expect(await stages(root)).toHaveLength(1);
});

test("two writers yield exactly one complete final and no leftover staging", async () => {
  const { root, final } = await fixture();
  const results = await Promise.allSettled([
    publishPrivateBrief(final, "first"), publishPrivateBrief(final, "second"),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const bytes = await readFile(final, "utf8");
  expect(["first", "second"]).toContain(bytes);
  expect(await stages(root)).toEqual([]);
});

test.each(["file", "directory", "symlink"] as const)("existing %s final is untouched", async (kind) => {
  const { root, final } = await fixture();
  const target = join(root, "target.md");
  if (kind === "file") await writeFile(final, "existing");
  if (kind === "directory") {
    await mkdir(final);
    await writeFile(join(final, "sentinel"), "keep");
  }
  if (kind === "symlink") {
    await writeFile(target, "target");
    try { await symlink(target, final, "file"); }
    catch (error) {
      if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") {
        console.info("Windows file-symlink privilege unavailable; existing-symlink case skipped");
        return;
      }
      throw error;
    }
  }
  await expect(publishPrivateBrief(final, "new")).rejects.toMatchObject({ publication: "unconfirmed" });
  if (kind === "file") expect(await readFile(final, "utf8")).toBe("existing");
  if (kind === "directory") {
    expect((await stat(final)).isDirectory()).toBe(true);
    expect(await readFile(join(final, "sentinel"), "utf8")).toBe("keep");
  }
  if (kind === "symlink") {
    expect(await readFile(target, "utf8")).toBe("target");
    expect((await lstat(final)).isSymbolicLink()).toBe(true);
    expect(await readlink(final)).toBe(target);
  }
  expect(await stages(root)).toEqual([]);
});

test("missing parent fails before publication", async () => {
  const { root } = await fixture();
  const final = join(root, "missing", "brief.md");
  await expect(publishPrivateBrief(final, "complete")).rejects.toMatchObject({ publication: "not-published" });
  expect(await stages(dirname(final).replace(/[\\/]missing$/, ""))).toEqual([]);
});

test("selected linked output parent still publishes to its target", async () => {
  const { root } = await fixture();
  const parent = join(root, "target");
  const alias = join(root, "alias");
  await mkdir(parent);
  try { await symlink(parent, alias, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) {
    if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") {
      console.info("Windows junction privilege unavailable; linked-parent case skipped");
      return;
    }
    throw error;
  }
  await publishPrivateBrief(join(alias, "brief.md"), "linked parent");
  expect(await readFile(join(parent, "brief.md"), "utf8")).toBe("linked parent");
  expect(await stages(parent)).toEqual([]);
});
