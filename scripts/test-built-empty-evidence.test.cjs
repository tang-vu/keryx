const assert = require('node:assert/strict');
const { test } = require('node:test');
const { findExportModuleIds } = require('./test-built-empty-evidence.cjs');

test('finds an async factory export using its registered ID without executing it', () => {
  const factory = context => context.a(async (_dependencies, done) => {
    context.s(['runAgent', 0, async function* () {}]);
    done();
  }, false);
  assert.deepEqual(findExportModuleIds([0, factory], 'runAgent'), [0]);
});

test('uses explicit IDs for concatenated factories, independent of export ordering and value syntax', () => {
  let executed = false;
  const factory = context => {
    executed = true;
    context.s(['other', 0, ['nested'], 'runAgent', 0, () => ['value']], 20);
  };
  assert.deepEqual(findExportModuleIds([10, 20, factory], 'runAgent'), [20]);
  assert.equal(executed, false);
});

test('accepts getter/setter exports and string module identities', () => {
  const factory = context => context.s(['other', () => 1, () => {}, 'runAgent', () => function* () {}]);
  assert.deepEqual(findExportModuleIds(['agent-module', factory], 'runAgent'), ['agent-module']);
});

test('does not confuse string values, comments or call sites with export keys', () => {
  const factory = context => {
    // context.s(['runAgent', 0, pretend]);
    context.s(['label', 0, 'runAgent', 'other', 0, () => {}]);
    context.i(10).runAgent();
  };
  assert.deepEqual(findExportModuleIds([10, factory], 'runAgent'), []);
});

test('retains ambiguity instead of guessing a factory ID', () => {
  assert.deepEqual(findExportModuleIds([10, 20, context => context.s(['runAgent', 0, () => {}])], 'runAgent'), [10, 20]);
});

test('rejects unsupported bindings and unregistered explicit IDs', () => {
  assert.throws(() => findExportModuleIds([10, context => context.s(['runAgent', 1, () => {}])], 'runAgent'), /Unsupported.*binding/);
  assert.throws(() => findExportModuleIds([10, context => context.s(['runAgent', 0, () => {}], 20)], 'runAgent'), /not registered/);
});
