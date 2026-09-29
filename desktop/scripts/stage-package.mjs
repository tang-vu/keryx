import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Stage one x64 Windows package");
const desktop = resolve(import.meta.dirname, "..");
const source = join(desktop, "src-tauri", "target", "release");
const release = join(desktop, "release");
const portable = join(release, "KeryxOperator-win32-x64");
if (resolve(release) !== resolve(desktop, "release") || resolve(portable) !== resolve(release, "KeryxOperator-win32-x64")) {
  throw new Error("Invalid release staging target");
}
const sourceExe = join(source, "KeryxOperator.exe");
const sourceCommit = (await readFile(join(desktop, "dist", "source-commit.txt"), "utf8")).trim();
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error("Missing exact source commit");
if (!(await stat(sourceExe)).isFile()) throw new Error("Tauri release executable is missing");
await rm(release, { recursive: true, force: true });
await mkdir(portable, { recursive: true });
await copyFile(sourceExe, join(portable, "KeryxOperator.exe"));
// A portable Windows Tauri executable resolves BaseDirectory::Resource beside
// itself. Keep the same dist/ layout used by the NSIS bundle.
await cp(join(desktop, "dist", "native"), join(portable, "dist", "native"), { recursive: true });
await cp(join(desktop, "dist", "runtime"), join(portable, "dist", "runtime"), { recursive: true });
await cp(join(desktop, "dist", "ui"), join(portable, "dist", "ui"), { recursive: true });
await copyFile(join(desktop, "dist", "helper.cjs"), join(portable, "dist", "helper.cjs"));
await copyFile(join(desktop, "dist", "source-commit.txt"), join(portable, "dist", "source-commit.txt"));
const installers = (await readdir(join(source, "bundle", "nsis"))).filter((name) => name.endsWith("-setup.exe"));
if (installers.length !== 1) throw new Error(`Expected one Tauri NSIS installer, found ${installers.length}`);
await mkdir(join(release, "installer"));
await copyFile(join(source, "bundle", "nsis", installers[0]), join(release, "installer", installers[0]));
const exe = await readFile(join(portable, "KeryxOperator.exe"));
await writeFile(join(release, "release.json"), JSON.stringify({
  sourceCommit,
  portable: "KeryxOperator-win32-x64/KeryxOperator.exe",
  portableExeSha256: createHash("sha256").update(exe).digest("hex"),
  installer: `installer/${installers[0]}`,
}, null, 2) + "\n");
