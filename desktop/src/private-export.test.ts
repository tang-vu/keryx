import { afterEach, expect, test } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrivateTextExportError, publishPrivateText } from "../../lib/operator/private-text-export";
import { savePrivateExport } from "./private-export";

const roots: string[] = [];
async function target(name: string) {
  const root = await mkdtemp(join(tmpdir(), "keryx-desktop-export-"));
  roots.push(root);
  return { root, path: join(root, name) };
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

test("canceling the native choice never invokes the publisher", async () => {
  let published = false;
  const result = await savePrivateExport(async () => ({ canceled: true }), "private", async () => {
    published = true;
    throw new Error("publisher must not run");
  });
  expect(result).toBe(false);
  expect(published).toBe(false);
});

test("an accepted dialog without a destination reports failure, not cancellation", async () => {
  let published = false;
  await expect(savePrivateExport(async () => ({ canceled: false }), "private", async () => {
    published = true;
    throw new Error("publisher must not run");
  })).rejects.toThrow("Save dialog did not provide a destination");
  expect(published).toBe(false);
});

test.each([
  ["private-brief.md", "# Private research brief\n"],
  ["references.bib", "@misc{record}\n"],
  ["references.ris", "TY  - WEB\r\nER  - \r\n"],
  ["evidence.csv", "\"claim_index\",\"claim\"\r\n"],
  ["operator-task-status.json", "{\"payment\":\"unknown\"}\n"],
])("%s succeeds only after complete bytes are published", async (name, text) => {
  const { root, path } = await target(name);
  let finish!: () => void;
  const release = new Promise<void>(resolve => { finish = resolve; });
  let settled = false;
  const saving = savePrivateExport(async () => ({ canceled: false, filePath: path }), text, async (output, data) => {
    await release;
    return publishPrivateText(output, data);
  }).then(value => { settled = true; return value; });
  await Promise.resolve();
  expect(settled).toBe(false);
  await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  finish();
  await expect(saving).resolves.toBe(true);
  expect(await readFile(path, "utf8")).toBe(text);
  expect((await readdir(root)).filter(entry => entry.startsWith(".keryx-brief-"))).toEqual([]);
});

test.each(["not-published", "unconfirmed", "published"] as const)(
  "%s publisher failure propagates without returning success", async (publication) => {
    const { path } = await target("status.json");
    const step = publication === "published" ? "remove staging file"
      : publication === "unconfirmed" ? "publish final file" : "write staging file";
    const failure = new PrivateTextExportError(publication, step, path, null, false, "injected failure");
    await expect(savePrivateExport(async () => ({ canceled: false, filePath: path }), "private", async () => {
      throw failure;
    })).rejects.toBe(failure);
  },
);
