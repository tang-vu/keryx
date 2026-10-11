// Reuse CI's actual completed build. No repeated build/tests or fabricated check
// receipts; aggregate CI still owns acceptance of this exact source/artifact.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { stageImmutableSource, recordImmutableArtifact } from './immutable-release-staging.mjs';
import { copyPreparationDependencies, protectPreparationCopy, materializePreparationBuildAliases } from './prepare-immutable-release.mjs';
import { rehearsePreparedRelease } from './rehearse-prepared-release.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const repo = path.resolve('.');
const commit = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' }).trim();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keryx-built-release-'));
const releasesDir = path.join(root, 'releases'); fs.mkdirSync(releasesDir, { mode: 0o700 });
const evidence = { format: 'keryx-existing-ci-build-rehearsal-v1', productionAdmitted: false,
  commit, root, exactBuildSourceCompared: false, traceInventory: null, artifact: null, runtime: null, error: null };
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
    if (fs.existsSync(path.join(repo, file))) {
      const destination = path.join(staged.source, file);
      fs.copyFileSync(path.join(repo, file), destination, fs.constants.COPYFILE_EXCL);
      if (process.platform !== 'win32') fs.chmodSync(destination, 0o600);
    }
  const traceInventory = { files: 0, references: 0, largestTrace: 0, versions: [], links: [] };
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isSymbolicLink()) {
        if (traceInventory.links.length >= 128) throw Error('Build link diagnostic limit exceeded');
        traceInventory.links.push({ path: path.relative(staged.source, file), target: fs.readlinkSync(file) });
      }
      else if (entry.isFile() && entry.name.endsWith('.nft.json')) {
        const value = JSON.parse(fs.readFileSync(file));
        traceInventory.files++;
        traceInventory.references += value.files?.length ?? 0;
        traceInventory.largestTrace = Math.max(traceInventory.largestTrace, value.files?.length ?? 0);
        if (!traceInventory.versions.includes(value.version)) traceInventory.versions.push(value.version);
      }
    }
  };
  visit(path.join(staged.source, '.next')); evidence.traceInventory = traceInventory;
  evidence.buildAliases = materializePreparationBuildAliases({ source: staged.source, dependencies: path.join(repo, 'node_modules') });
  evidence.protectedBuildEntries = protectPreparationCopy(path.join(staged.source, '.next'));
  const artifact = recordImmutableArtifact(staged);
  evidence.artifact = { ...staged, ...artifact };
  evidence.runtime = await rehearsePreparedRelease({ ...staged, artifactInspectionSha256: artifact.artifactInspectionSha256 });
  console.log(JSON.stringify(evidence));
} catch (error) { evidence.error = error.message; console.error(JSON.stringify(evidence)); process.exitCode = 1; }
finally {
  const file = process.env.KERYX_RELEASE_REHEARSAL_RESULT || path.join(root, 'result.json');
  fs.writeFileSync(file, JSON.stringify(evidence) + '\n', { flag: 'wx', mode: 0o600 });
}
