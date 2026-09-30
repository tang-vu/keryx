import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("initializes and closes synthetic worker stores with a scoped shared content key", async () => {
  const script = `
    import assert from 'node:assert/strict';
    import { existsSync } from 'node:fs';
    import { privateWorkerScenario } from './scripts/test-fixtures/private-worker-scenario.mts';
    import { SqliteAdapter } from './lib/db/sqlite-adapter.ts';
    globalThis.fetch = async () => { throw new Error('Network forbidden'); };
    const originalInit = SqliteAdapter.prototype.init;
    let admittedKey;
    SqliteAdapter.prototype.init = async function () {
      admittedKey = process.env.CONTENT_MASTER_KEY;
      return originalInit.call(this);
    };
    for (const previous of [undefined, '77'.repeat(32)]) {
      if (previous === undefined) delete process.env.CONTENT_MASTER_KEY;
      else process.env.CONTENT_MASTER_KEY = previous;
      const scenario = await privateWorkerScenario();
      try {
        assert.match(scenario.env.CONTENT_MASTER_KEY, /^[0-9a-f]{64}$/);
        assert.equal(admittedKey, scenario.env.CONTENT_MASTER_KEY);
        assert.notEqual(admittedKey, previous);
        assert.equal(process.env.CONTENT_MASTER_KEY, previous);
        assert.equal(scenario.db.getStorageIdentity().authorityMode, 'testnet-real');
        assert.equal(scenario.jobs.length, 2);
        for (const id of scenario.jobs)
          assert.equal((await scenario.db.getPrivatePaymentState(id, scenario.payer)).status, 'settled');
      } finally { await scenario.close(); }
      assert.equal(existsSync(scenario.root), false);
      assert.equal(process.env.CONTENT_MASTER_KEY, previous);
    }
    delete process.env.CONTENT_MASTER_KEY;
    let closed = false;
    const originalClose = SqliteAdapter.prototype.close;
    SqliteAdapter.prototype.close = function () { closed = true; return originalClose.call(this); };
    SqliteAdapter.prototype.init = async function () {
      assert.match(process.env.CONTENT_MASTER_KEY, /^[0-9a-f]{64}$/);
      throw new Error('Synthetic initialization failure');
    };
    await assert.rejects(privateWorkerScenario(), /Synthetic initialization failure/);
    assert.equal(closed, true);
    assert.equal(process.env.CONTENT_MASTER_KEY, undefined);
    console.log('synthetic worker fixture lifecycle passed');
  `;
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const name of ["PATH", "ESBUILD_BINARY_PATH", "TEMP", "TMP"])
    if (process.env[name]) env[name] = process.env[name];
  const { stdout } = await promisify(execFile)(process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script], { env, timeout: 30_000 });
  expect(stdout.trim()).toBe("synthetic worker fixture lifecycle passed");
}, 40_000);
