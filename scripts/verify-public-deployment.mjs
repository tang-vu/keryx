import { pathToFileURL } from 'node:url';
import { verifyPublicDeployment, deploymentOptions } from './public-deployment-probe.mjs';

const USAGE = 'Usage: npm run verify:live -- --expect-commit <40-character-sha> [--origin https://keryx.cc] [--network arc|arcTestnet] [--timeout-ms 10000] [--require-monitoring] [--json]';

export function parseDeploymentArgs(args) {
  const input = {}, seen = new Set();
  const values = { '--expect-commit': 'expectedCommit', '--origin': 'origin', '--network': 'network', '--timeout-ms': 'timeoutMs' };
  let json = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (seen.has(arg)) throw new Error('Duplicate option');
    seen.add(arg);
    if (arg === '--json') json = true;
    else if (arg === '--require-monitoring') input.requireMonitoring = true;
    else if (Object.hasOwn(values, arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('Missing option value');
      if (arg === '--timeout-ms' && !/^\d+$/.test(value)) throw new Error('Invalid timeout');
      input[values[arg]] = arg === '--timeout-ms' ? Number(value) : value;
    } else throw new Error('Unknown option');
  }
  return { options: deploymentOptions(input), json };
}

export async function main(args, write = text => console.log(text)) {
  let parsed;
  try { parsed = parseDeploymentArgs(args); }
  catch (error) { write(`${error.message}\n${USAGE}`); return 2; }
  const report = await verifyPublicDeployment(parsed.options);
  if (parsed.json) write(JSON.stringify(report, null, 2));
  else {
    write(`Keryx public deployment: ${report.status.toUpperCase()} (${report.warnings} warnings)`);
    for (const check of report.checks) write(`${check.status.toUpperCase()} ${check.id}: ${check.detail}`);
    for (const limit of report.limits) write(`Limit: ${limit}`);
  }
  return report.status === 'pass' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
