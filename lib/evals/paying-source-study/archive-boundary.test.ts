import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { assertStudyArchives, STUDY_ARCHIVES } from "./archive-boundary";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const roots: string[] = [];
function copyArchives(crlf = false): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-study-archive-test-"));
  roots.push(root);
  for (const archive of STUDY_ARCHIVES) {
    const file = path.join(root, archive.path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let text = fs.readFileSync(path.join(repository, archive.path), "utf8").replaceAll("\r\n", "\n");
    if (crlf) text = text.replaceAll("\n", "\r\n");
    fs.writeFileSync(file, text);
  }
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) ||
        !path.basename(root).startsWith("keryx-study-archive-test-")) throw new Error("Unexpected archive test cleanup path");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it.each([false, true])("accepts only the historical bytes with Git line-ending normalization (crlf=%s)", crlf => {
  expect(() => assertStudyArchives(copyArchives(crlf))).not.toThrow();
});

it.each(STUDY_ARCHIVES)("refuses any byte drift in $path", archive => {
  const root = copyArchives();
  fs.appendFileSync(path.join(root, archive.path), " ");
  expect(() => assertStudyArchives(root)).toThrow(/Archived study drifted/);
});

it("refuses a missing archive", () => {
  const root = copyArchives();
  fs.unlinkSync(path.join(root, STUDY_ARCHIVES[0].path));
  expect(() => assertStudyArchives(root)).toThrow(/Archived study unavailable/);
});

it("refuses a directory in place of an archive", () => {
  const root = copyArchives(), file = path.join(root, STUDY_ARCHIVES[0].path);
  fs.unlinkSync(file); fs.mkdirSync(file);
  expect(() => assertStudyArchives(root)).toThrow(/bounded regular file/);
});

it("retains the four MiB archive-read bound", () => {
  const root = copyArchives();
  fs.truncateSync(path.join(root, STUDY_ARCHIVES[0].path), 4 * 1024 * 1024 + 1);
  expect(() => assertStudyArchives(root)).toThrow(/bounded regular file/);
});
