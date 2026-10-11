import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { prepareImmutableRelease } from './prepare-immutable-release.mjs';

export const REVIEWED_CONTROLS = Object.freeze([
  'KERYX_REDEPLOY_PRESERVE_HELD_SCHEDULER',
  'KERYX_REDEPLOY_REVIEWED_PM2_CONFIG',
  'KERYX_REDEPLOY_REVIEWED_PM2_SHA256',
  'KERYX_REDEPLOY_EXPECTED_COMMIT',
]);
export const TRANSPORT_CONTROLS = Object.freeze([...REVIEWED_CONTROLS,
  'KERYX_REDEPLOY_ECONOMIC_MIGRATION_CONFIG', 'KERYX_REDEPLOY_ECONOMIC_MIGRATION_SHA256',
  'KERYX_REDEPLOY_STAGED_RELEASE']);
/** These inputs contain no credentials. They must reach bash unchanged before SSH or mutation. */
export function redeployEnvironment(environment, platform = process.platform) {
  const env = { ...environment };
  const selected = REVIEWED_CONTROLS.map(name => env[name] ?? '');
  const reviewed = Boolean(selected[1] || selected[2] || selected[0] === '1');
  if (reviewed && (selected[0] !== '1' ||
    !/^\/root\/\.local\/share\/[a-zA-Z0-9_./-]+\.json$/.test(selected[1]) || selected[1].includes('..') ||
    !/^[a-f0-9]{64}$/.test(selected[2]) || !/^[a-f0-9]{40}$/.test(selected[3])))
    throw new Error('Reviewed redeploy requires all four complete maintenance controls');
  if (!reviewed && (!['', '0'].includes(selected[0]) || selected[3] && !/^[a-f0-9]{40}$/.test(selected[3])))
    throw new Error('Invalid legacy deployment control');
  const economic = TRANSPORT_CONTROLS.slice(4, 6).map(name => env[name] ?? '');
  if ((economic[0] || economic[1]) && (!reviewed ||
    !/^\/root\/\.local\/share\/[a-zA-Z0-9_./-]+\.json$/.test(economic[0]) || economic[0].includes('..') ||
    !/^[a-f0-9]{64}$/.test(economic[1]))) throw new Error('Economic migration requires complete reviewed controls');
  const staged = env.KERYX_REDEPLOY_STAGED_RELEASE ?? '0';
  if (!['0', '1'].includes(staged) || staged === '1' && (!reviewed || economic.some(Boolean)))
    throw new Error('Staged release requires complete reviewed controls and a separate code-only transition');
  if (platform === 'win32') {
    const previous = (env.WSLENV ?? '').split(':').filter(Boolean)
      .filter(entry => !TRANSPORT_CONTROLS.includes(entry.split('/')[0]));
    // Values are already native Linux paths or scalars; never translate them with /p.
    env.WSLENV = [...previous, ...TRANSPORT_CONTROLS].join(':');
  }
  return env;
}
export function verifyRedeployTransport(env, probe = spawnSync) {
  const result = probe('bash', ['-c', 'for name in "$@"; do printf "%s\\n" "${!name-}"; done',
    'keryx-redeploy-preflight', ...TRANSPORT_CONTROLS], { env, encoding: 'utf8', windowsHide: true });
  const expected = TRANSPORT_CONTROLS.map(name => env[name] ?? '').join('\n') + '\n';
  if (result.error || result.signal || result.status !== 0 || result.stdout !== expected || result.stderr)
    throw new Error('Redeploy maintenance controls did not reach bash unchanged; no deployment started');
}
export async function runRedeploy(environment = process.env, launch = spawn, probe = spawnSync) {
  const env = redeployEnvironment(environment);
  verifyRedeployTransport(env, probe);
  const child = launch('bash', ['scripts/redeploy-vps.sh'], { env, stdio: 'inherit', windowsHide: true });
  return await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => signal ? reject(new Error('Redeploy terminated; inspect retained evidence')) : resolve(code ?? 1));
  });
}
export async function runRedeployCommand(args, { prepare = prepareImmutableRelease, deploy = runRedeploy } = {}) {
  if (args.length === 0) return deploy();
  if (args[0] !== '--prepare-release' || args.length !== 6)
    throw Error('Expected --prepare-release REPO RELEASES FULL_COMMIT DEPENDENCIES NPM_CLI');
  const [repo, releasesDir, commit, dependencies, npmCli] = args.slice(1);
  for (const directory of [repo, releasesDir, dependencies, npmCli])
    if (!path.isAbsolute(directory)) throw Error('Preparation requires absolute native paths');
  // Accept portable absolute Windows spelling; the staging API still verifies
  // canonical roots, nonsymlink ancestors and source/release separation.
  return prepare({ repo: path.resolve(repo), releasesDir: path.resolve(releasesDir), commit,
    dependencies: path.resolve(dependencies), npmCli: path.resolve(npmCli) });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRedeployCommand(process.argv.slice(2)).then(result => {
    if (typeof result === 'number') process.exitCode = result;
    else console.log(JSON.stringify(result));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
