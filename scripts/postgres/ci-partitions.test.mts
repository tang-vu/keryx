import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const yaml = createRequire(import.meta.url)('js-yaml') as { load: (wire: string) => unknown };
const wire = readFileSync(new URL('../../.github/workflows/postgres-mainnet.yml', import.meta.url), 'utf8');
type Job = { needs?: string[]; if?: string; 'timeout-minutes': number; steps: { run?: string; name?: string; if?: string }[] };
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
});
