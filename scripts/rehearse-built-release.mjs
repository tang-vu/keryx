// Reuse CI's actual completed build. No repeated build/tests or fabricated check
// receipts; aggregate CI still owns acceptance of this exact source/artifact.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { stageImmutableSource, recordImmutableArtifact } from './immutable-release-staging.mjs';
import { copyPreparationDependencies } from './prepare-immutable-release.mjs';
import { rehearsePreparedRelease } from './rehearse-prepared-release.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const repo = path.resolve('.');
const commit = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' }).trim();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keryx-built-release-'));
const releasesDir = path.join(root, 'releases'); fs.mkdirSync(releasesDir, { mode: 0o700 });
const evidence = { format: 'keryx-existing-ci-build-rehearsal-v1', productionAdmitted: false,
  commit, root, exactBuildSourceCompared: false, artifact: null, runtime: null, error: null };
try {
  const staged = stageImmutableSource({ repo, releasesDir, commit });
  const manifest = JSON.parse(fs.readFileSync(path.join(staged.candidate, 'source-manifest.json')));
  // Reused build inputs must be the exact Git bytes, not an edited CI checkout.
  for (const file of manifest.files) {
    if (hash(fs.readFileSync(path.join(repo, file.path))) !== file.sha256)
      throw Error(`Build source differs from accepted Git object: ${file.path}`);
  }
  evidence.exactBuildSourceCompared = true;
  copyPreparationDependencies({ source: staged.source, dependencies: path.join(repo, 'node_modules') });
  fs.cpSync(path.join(repo, '.next'), path.join(staged.source, '.next'), {
    recursive: true, dereference: false, verbatimSymlinks: true, force: false, errorOnExist: true,
  });
  for (const file of ['next-env.d.ts', 'tsconfig.tsbuildinfo', 'tsconfig.ops-scripts.tsbuildinfo'])
    if (fs.existsSync(path.join(repo, file))) fs.copyFileSync(path.join(repo, file), path.join(staged.source, file), fs.constants.COPYFILE_EXCL);
  const artifact = recordImmutableArtifact(staged);
  evidence.artifact = { ...staged, ...artifact };
  evidence.runtime = await rehearsePreparedRelease({ ...staged, artifactInspectionSha256: artifact.artifactInspectionSha256 });
  console.log(JSON.stringify(evidence));
} catch (error) { evidence.error = error.message; console.error(JSON.stringify(evidence)); process.exitCode = 1; }
finally {
  const file = process.env.KERYX_RELEASE_REHEARSAL_RESULT || path.join(root, 'result.json');
  fs.writeFileSync(file, JSON.stringify(evidence) + '\n', { flag: 'wx', mode: 0o600 });
}
