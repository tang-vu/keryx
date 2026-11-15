import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const yaml = createRequire(import.meta.url)('js-yaml') as { load: (wire: string) => unknown };
const wire = readFileSync(new URL('../../.github/workflows/postgres-mainnet.yml', import.meta.url), 'utf8');
type Job = { needs?: string[]; if?: string; 'timeout-minutes': number; steps: { run?: string; name?: string; if?: string; env?: Record<string,string> }[] };
const workflow = yaml.load(wire) as { jobs: Record<string, Job> };
const names = ['contracts-bootstrap-financial', 'native-runtime-core', 'native-runtime-tail', 'synthetic-materialization', 'publication-contained', 'a2a-fulfillment', 'payment-browser-protocols', 'current-producer-protocols'];
const gate = workflow.jobs['postgres-preparation'];
const command = gate.steps.find(step => step.name === 'Require successful acceptance from every partition')!.run!;
const program = command.match(/node --input-type=module -e '\n([\s\S]+)\n'\s*$/)![1];
function accept(results: unknown) {
  runInNewContext(program, {
    process: { env: { NEEDS_JSON: JSON.stringify(results) }, exit: () => { throw Error('acceptance refused'); } },
    console: { error: () => {} },
  }, { timeout: 1000 });
}
const success = () => Object.fromEntries(names.map(name => [name, { result: 'success' }]));

describe('PostgreSQL partition acceptance', () => {
  it('accepts only the complete successful dependency set', () => {
    expect(gate.needs).toEqual(names);
    expect(gate.if).toBe('${{ always() }}');
    expect(() => accept(success())).not.toThrow();
    expect(() => accept(null)).toThrow();
    expect(() => accept({ ...success(), unexpected: { result: 'success' } })).toThrow();
  });
  for (const name of names) {
    it(`refuses missing, skipped, cancelled and failed ${name}`, () => {
      const missing = success(); delete missing[name];
      expect(() => accept(missing)).toThrow();
      for (const result of ['skipped', 'cancelled', 'failure', 'timed_out', '']) {
        expect(() => accept({ ...success(), [name]: { result } })).toThrow();
      }
    });
  }
  it('keeps every current producer protocol in the required acceptance partition', () => {
    const commands = workflow.jobs['current-producer-protocols'].steps.flatMap(step => step.run ? [step.run] : []);
    for (const flag of ['private-research-only', 'registration-sponsor-only', 'onramp-only', 'scholarly-only', 'content-writes-only', 'payment-observers-only', 'payment-consumed-fields-only']) {
      expect(commands.filter(command => command.endsWith(`test-session-consents.mts --${flag}`))).toHaveLength(1);
    }
    expect(commands.some(command => command.includes('--import ./scripts/postgres/private-source-bootstrap.mjs'))).toBe(true);
  });
  it('preserves bounded jobs and refuses whole-workflow cancellation', () => {
    for (const name of names) expect(workflow.jobs[name]['timeout-minutes']).toBe(25);
    expect(gate.steps.some(step => step.if === '${{ cancelled() }}' && step.run === 'exit 1')).toBe(true);
  });
  it('requires both the observed factory profile and current DATA-only intake', () => {
    const steps=workflow.jobs['synthetic-materialization'].steps;
    expect(steps.filter(step=>step.run?.endsWith('qualify-native-materialization.mts --synthetic'))).toHaveLength(1);
    const current=steps.filter(step=>step.run?.endsWith('qualify-native-materialization.mts --development-current-data-synthetic'));
    expect(current).toHaveLength(1);
    expect(current[0].if).toBeUndefined();
    expect(current[0].run).toContain('--import ./scripts/postgres/current-data-source-bootstrap.mjs');
    expect(current[0].env).toMatchObject({NODE_OPTIONS:'--max-old-space-size=512',KERYX_NETWORK:'arc',NEXT_PUBLIC_KERYX_NETWORK:'arc',KERYX_FORCE_OFFLINE:'0'});
  });
  it('boots the actual Source schema rehearsal with provider access trapped', () => {
    const bootstrap=new URL('./current-data-source-bootstrap.mjs',import.meta.url).href;
    const env={KERYX_NETWORK:'arc',NEXT_PUBLIC_KERYX_NETWORK:'arc',KERYX_FORCE_OFFLINE:'0'};
    const program="fetch('data:text/plain,unexpected').then(()=>{process.exitCode=2},error=>{if(error.message!=='Current data qualification forbids provider HTTP')process.exitCode=3})";
    const run=(flags:string[],overrides:Record<string,string>={})=>spawnSync(process.execPath,['--import',bootstrap,'--eval',program,'--',...flags],{env:{...env,...overrides},encoding:'utf8',timeout:5000,windowsHide:true});
    expect(run(['--development-current-data-synthetic']).status).toBe(0);
    expect(run(['--synthetic']).status).not.toBe(0);
    expect(run(['--development-current-data-synthetic','--development-current-data-retained']).status).not.toBe(0);
    expect(run(['--development-current-data-synthetic'],{KERYX_FORCE_OFFLINE:'1'}).status).not.toBe(0);
    expect(run(['--development-current-data-synthetic'],{KERYX_NETWORK:'arcTestnet'}).status).not.toBe(0);
  });
});
