/** Synthetic private parents and tree evidence shared by task acceptance drivers. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, readlink, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const minimalEnv = { PATH: process.env.PATH ?? "", PATHEXT: process.env.PATHEXT ?? "",
  SystemRoot: process.env.SystemRoot ?? "", WINDIR: process.env.WINDIR ?? "" };

export async function treeDigest(directory: string) {
  const entries: string[] = [];
  async function walk(path: string, relative: string) {
    for (const name of (await readdir(path)).sort()) {
      const file = join(path, name);
      const key = join(relative, name);
      const kind = await lstat(file);
      if (kind.isSymbolicLink()) entries.push("link " + key + " " + await readlink(file));
      else if (kind.isDirectory()) { entries.push("dir " + key); await walk(file, key); }
      else if (kind.isFile()) {
        entries.push("file " + key + " " + createHash("sha256").update(await readFile(file)).digest("hex"));
      } else throw new Error("Unexpected synthetic fixture entry: " + key);
    }
  }
  await walk(directory, "");
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

export function checkedTool(executable: string, args: string[], label: string) {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  assert(systemRoot && isAbsolute(systemRoot), "Windows system root must be absolute");
  const result = spawnSync(join(systemRoot, "System32", executable), args,
    { env: minimalEnv, encoding: "utf8", timeout: 20_000, maxBuffer: 128_000, windowsHide: true });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  assert.equal(result.status, 0, label + ": " + result.stderr);
  return result.stdout;
}

export function currentUserSid() {
  const whoami = checkedTool("whoami.exe", ["/user", "/fo", "csv", "/nh"], "current-user SID");
  const sids = whoami.match(/S-1-\d+(?:-\d+)+/g);
  assert(sids && sids.length === 1, "cannot identify one current-user SID");
  return sids[0];
}

export async function privateParent(root: string) {
  const parent = join(root, "owned-private-parent Ti\u1EBFng Vi\u1EC7t \u{1F9EA} (safe)");
  await mkdir(parent, { mode: 0o700 });
  if (process.platform === "win32") {
    const sid = currentUserSid();
    checkedTool("icacls.exe", [parent, "/reset"], "reset owned fixture ACL");
    checkedTool("icacls.exe", [parent, "/grant:r", "*" + sid + ":(OI)(CI)F"],
      "grant the owned private parent only to the current user");
    checkedTool("icacls.exe", [parent, "/setowner", "*" + sid],
      "set owned fixture parent to current-user owner");
    checkedTool("icacls.exe", [parent, "/inheritance:r"], "remove inherited fixture ACEs");
    checkedTool("icacls.exe", [parent, "/verify"], "verify private parent ACL");
  } else assert.equal((await stat(parent)).mode & 0o777, 0o700);
  return parent;
}

export async function privateParentWithUnsupportedAce(root: string, label: string, ace: string) {
  const parent = join(root, label);
  await mkdir(parent, { mode: 0o700 });
  const sid = currentUserSid();
  checkedTool("icacls.exe", [parent, "/reset"], "reset owned unsupported ACE fixture");
  checkedTool("icacls.exe", [parent, "/grant:r", "*" + sid + ":" + ace],
    "install unsupported ACE only on owned fixture");
  checkedTool("icacls.exe", [parent, "/setowner", "*" + sid],
    "set owned unsupported ACE fixture to current-user owner");
  checkedTool("icacls.exe", [parent, "/inheritance:r"], "protect owned fixture DACL");
  checkedTool("icacls.exe", [parent, "/verify"], "verify owned unsupported ACE fixture");
  return parent;
}

/** A real TypeScript caller may select this parent; the native policy must refuse it. */
export async function nonPrivateParent(root: string) {
  const parent = join(root, "caller-selected-broad-parent");
  await mkdir(parent, { mode: 0o755 });
  if (process.platform === "win32") {
    const sid = currentUserSid();
    checkedTool("icacls.exe", [parent, "/reset"], "reset broad synthetic parent ACL");
    checkedTool("icacls.exe", [parent, "/grant:r", "*S-1-1-0:(OI)(CI)F"],
      "grant broad synthetic parent access");
    checkedTool("icacls.exe", [parent, "/setowner", "*" + sid],
      "set broad synthetic parent owner");
    checkedTool("icacls.exe", [parent, "/inheritance:r"], "protect broad synthetic DACL");
    checkedTool("icacls.exe", [parent, "/verify"], "verify broad synthetic ACL");
  } else {
    await chmod(parent, 0o755);
    assert.equal((await stat(parent)).mode & 0o777, 0o755);
  }
  return parent;
}
