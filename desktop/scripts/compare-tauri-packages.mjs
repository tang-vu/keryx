import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const portableMarker = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_UNK");
const installedMarker = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_NSS");

function uniqueOffset(bytes, marker) {
  const offset = bytes.indexOf(marker);
  if (offset < 0 || bytes.indexOf(marker, offset + marker.length) >= 0) {
    throw new Error(`Expected exactly one ${marker.toString()} marker`);
  }
  return offset;
}

export function assertTauriExecutablePair(portable, installed) {
  if (portable.length !== installed.length) throw new Error("Executable sizes differ");
  const offset = uniqueOffset(portable, portableMarker);
  if (portable.includes(installedMarker)) throw new Error("Portable executable already has an NSIS marker");
  if (installed.includes(portableMarker)) throw new Error("Installed executable has an unbundled marker");
  if (uniqueOffset(installed, installedMarker) !== offset) throw new Error("Tauri bundle markers have different offsets");
  if (!portable.subarray(0, offset).equals(installed.subarray(0, offset)) ||
      !portable.subarray(offset + portableMarker.length).equals(installed.subarray(offset + installedMarker.length))) {
    throw new Error("Portable and NSIS executables differ beyond the Tauri bundle type marker");
  }
}

async function filesUnder(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(root, path));
    else if (entry.isFile()) files.push(relative(root, path));
    else throw new Error(`Unexpected package resource entry: ${path}`);
  }
  return files.sort();
}

export async function assertTauriPackagePair(portableRoot, installedRoot) {
  const portable = await readFile(join(portableRoot, "KeryxOperator.exe"));
  const installed = await readFile(join(installedRoot, "KeryxOperator.exe"));
  assertTauriExecutablePair(portable, installed);

  const portableDist = join(portableRoot, "dist");
  const installedDist = join(installedRoot, "dist");
  const portableFiles = await filesUnder(portableDist);
  const installedFiles = await filesUnder(installedDist);
  if (JSON.stringify(portableFiles) !== JSON.stringify(installedFiles)) {
    throw new Error("Portable and NSIS resource file lists differ");
  }
  for (const file of portableFiles) {
    const [a, b] = await Promise.all([
      readFile(join(portableDist, file)), readFile(join(installedDist, file)),
    ]);
    if (!a.equals(b)) throw new Error(`Portable and NSIS resources differ: ${file}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [portableRoot, installedRoot] = process.argv.slice(2);
  if (!portableRoot || !installedRoot) throw new Error("Expected portable and installed package roots");
  await assertTauriPackagePair(resolve(portableRoot), resolve(installedRoot));
  console.log("Portable and NSIS package bytes match except for Tauri's exact UNK/NSS bundle marker");
}
