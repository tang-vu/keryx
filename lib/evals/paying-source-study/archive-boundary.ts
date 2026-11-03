import fs from "node:fs";
import path from "node:path";
import { sha256 } from "./contract";

// Accepted historical bytes, normalized only for Git's Windows line endings.
// A new engine result belongs to a new baseline, never an overwritten archive.
export const STUDY_ARCHIVES = [
  { path: "fixtures/evals/studies/paying-source-results-v1.json", sha256: "f94ac2dc5675baca652d88cf8f1d998d7ac78c36b8d01250e4fe62a53256b909" },
  { path: "fixtures/evals/studies/paying-source-results-v2.json", sha256: "311cb6a3ebfd989c616910455281f442e468cbb8b6838108637e879bf57773ae" },
  { path: "docs/studies/paying-for-sources-2026-10-09.md", sha256: "bace06f62cd264a4e97169d4318f8bde76aa8d513c15fdd613df11063e996a52" },
  { path: "docs/studies/paying-for-sources-2026-10-13.md", sha256: "db7b3018338c8975c8b24901c2511f05d15fa48659471388c54044d2e329d899" },
] as const;

export function assertStudyArchives(root: string): void {
  for (const archive of STUDY_ARCHIVES) {
    const file = path.join(root, archive.path);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(file); }
    catch { throw new Error(`Archived study unavailable: ${archive.path}`); }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024)
      throw new Error(`Archived study is not a bounded regular file: ${archive.path}`);
    if (sha256(fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n")) !== archive.sha256)
      throw new Error(`Archived study drifted: ${archive.path}; retain the accepted history and create a new baseline`);
  }
}
