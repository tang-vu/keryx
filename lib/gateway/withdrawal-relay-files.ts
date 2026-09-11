import { lstat, open, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** Linux operator filesystem contract. Windows runtime needs an explicit ACL
 * implementation; POSIX permission bits alone are not treated as a Windows ACL. */
export async function inspectWithdrawalRelayFiles(directory: string) {
  try {
    if (process.platform !== "linux" || !process.getuid || !isAbsolute(directory)) throw new Error();
    const root = resolve(directory), owner = process.getuid();
    const directoryStat = await lstat(root);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || directoryStat.uid !== owner
      || (directoryStat.mode & 0o077) !== 0 || await realpath(root) !== root) throw new Error();
    // A private child alone is insufficient if another user can replace its entry
    // through a writable ancestor. Root-owned sticky /tmp is an allowed boundary.
    for (let parent = dirname(root); ; parent = dirname(parent)) {
      const stat = await lstat(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== owner && stat.uid !== 0
        || (stat.mode & 0o022) !== 0 && !((stat.mode & 0o1000) !== 0 && stat.uid === 0)) throw new Error();
      if (parent === dirname(parent)) break;
    }
    const inspect = async (path: string) => {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== owner || stat.nlink !== 1 || (stat.mode & 0o077) !== 0)
        throw new Error();
      return stat;
    };
    const policyPath = join(root, "policy.json"), databasePath = join(root, "mint.sqlite");
    const policyStat = await inspect(policyPath), databaseStat = await inspect(databasePath);
    if (policyStat.size < 1 || policyStat.size > 4096 || databaseStat.size < 1) throw new Error();
    for (const suffix of ["-journal", "-wal", "-shm"]) {
      try { await inspect(databasePath + suffix); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const file = await open(policyPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let policy: unknown;
    try {
      const opened = await file.stat();
      if (opened.dev !== policyStat.dev || opened.ino !== policyStat.ino || opened.size !== policyStat.size) throw new Error();
      const bytes = Buffer.alloc(4097); let offset = 0;
      while (offset < bytes.length) {
        const read = await file.read(bytes, offset, bytes.length - offset, null);
        if (!read.bytesRead) break; offset += read.bytesRead;
      }
      if (offset !== policyStat.size) throw new Error();
      policy = JSON.parse(bytes.subarray(0, offset).toString("utf8"));
    } finally { await file.close(); }
    return { directory: root, databasePath, policy,
      databaseIdentity: { device: databaseStat.dev, inode: databaseStat.ino } };
  } catch { throw new Error("Protected withdrawal relay files unavailable"); }
}
