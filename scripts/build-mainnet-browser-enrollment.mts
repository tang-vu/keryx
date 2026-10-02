/** Offline public artifact builder. No wallet, environment file, RPC, database or launch action. */
import { constants, mkdirSync, writeFileSync, lstatSync, realpathSync } from "node:fs";
import { open, lstat } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { canonicalJson } from "../lib/canonical-json.ts";
import { parsePublicMainnetEnrollment, publicMainnetEnrollmentDigest } from "../lib/mainnet-pilot/public-enrollment.ts";
async function boundedPublicFile(path: string): Promise<unknown> {
  const selected = await lstat(path);
  if (!selected.isFile() || selected.size < 2 || selected.size > 65536) throw new Error();
  const handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== selected.size || before.ino !== selected.ino || before.dev !== selected.dev ||
      before.mtimeMs !== selected.mtimeMs || before.ctimeMs !== selected.ctimeMs) throw new Error();
    const buffer = Buffer.alloc(65537), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0), after = await handle.stat();
    if (bytesRead !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error();
    return JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
  } finally { await handle.close(); }
}
function checkedOutput(root: string, path: string) {
  const destinationRoot = resolve(root, ".artifacts/mainnet-pilot"), within = relative(destinationRoot, path);
  if (!within || within.startsWith("..") || isAbsolute(within)) throw new Error();
  let ancestor = root;
  for (const part of relative(root, dirname(path)).split(sep)) {
    ancestor = resolve(ancestor, part);
    try {
      const stat = lstatSync(ancestor);
      if (stat.isSymbolicLink() || !stat.isDirectory() || relative(ancestor, realpathSync(ancestor)) !== "") throw new Error();
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  try { lstatSync(path); throw new Error(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
try {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--input" || args[2] !== "--output") throw new Error();
  const root = realpathSync(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore","pipe","pipe"] }).trim());
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).trim()) throw new Error();
  const output = resolve(args[3]), envOutput = `${output}.public.env`;
  checkedOutput(root, output); checkedOutput(root, envOutput);
  const enrollment = parsePublicMainnetEnrollment(await boundedPublicFile(resolve(args[1])));
  if (enrollment.releaseCommit !== head || enrollment.expiresAtSeconds <= Math.floor(Date.now()/1000)) throw new Error();
  const digest = await publicMainnetEnrollmentDigest(enrollment), json = canonicalJson(enrollment);
  if (/[#\r\n]/.test(json)) throw new Error();
  mkdirSync(dirname(output), { recursive: true });
  checkedOutput(root, output); checkedOutput(root, envOutput);
  writeFileSync(output, `${json}\n`, { flag: "wx" });
  writeFileSync(envOutput, `NEXT_PUBLIC_KERYX_MAINNET_ENROLLMENT_JSON=${json}\nNEXT_PUBLIC_KERYX_MAINNET_ENROLLMENT_DIGEST=${digest}\n`, { flag: "wx" });
  process.stdout.write(JSON.stringify({ output, enrollmentDigest: digest, releaseCommit: head, launchAuthorized: false }) + "\n");
} catch { process.stderr.write("Public enrollment build refused; require clean reviewed source, matching public pins and bounded regular input/output files.\n"); process.exitCode = 2; }
