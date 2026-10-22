const assert = require('node:assert/strict');
const { test } = require('node:test');
const { findExportModuleIds, moduleFactoryGroups } = require('./test-built-empty-evidence.cjs');

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

test('reads the Next16.4 strict prefix and flat groups without invoking either factory', () => {
  let executed = false;
  const strict = context => { executed = true; context.s(['runAgent', 0, function* () {}]); };
  const ordinary = context => { executed = true; context.s(['config', 0, {}]); };
  const chunk = [[10, strict], 'config-module', ordinary];
  assert.deepEqual(findExportModuleIds(chunk, 'runAgent'), [10]);
  assert.deepEqual(findExportModuleIds(chunk, 'config'), ['config-module']);
  assert.deepEqual(moduleFactoryGroups(chunk), [
    { moduleIds: [10], factory: strict }, { moduleIds: ['config-module'], factory: ordinary },
  ]);
  assert.equal(executed, false);
});

test('retains explicit concatenated IDs, async and getter exports inside strict factories', () => {
  const strict = context => context.a(async () => context.s(['other', 0, 'runAgent', 'runAgent', () => function* () {}], 20), false);
  assert.deepEqual(findExportModuleIds([[10, 20, strict]], 'runAgent'), [20]);
});

test('does not assign an outer ID to an export in the strict prefix', () => {
  const strict = context => context.s(['runAgent', 0, () => {}]);
  const ordinary = context => context.s(['other', 0, 'runAgent']);
  assert.deepEqual(findExportModuleIds([[10, strict], 20, ordinary], 'runAgent'), [10]);
  assert.deepEqual(findExportModuleIds([[10, strict], 20, strict], 'runAgent'), [10, 20]);
});

test('accepts an empty strict prefix and preserves missing-export refusal', () => {
  assert.deepEqual(findExportModuleIds([[], 10, context => context.s(['other', 0, 'runAgent'])], 'runAgent'), []);
  assert.deepEqual(moduleFactoryGroups([[]]), []);
});

test('rejects malformed strict groups and arrays outside the supported leading position', () => {
  const factory = context => context.s(['runAgent', 0, () => {}]);
  for (const chunk of [[10, [20, factory], factory], [10, factory, [20, factory]], [[[10, factory]]], [[null, factory]], [[{}, factory]]]) {
    assert.throws(() => moduleFactoryGroups(chunk), /Unsupported Turbopack module ID/);
  }
  assert.throws(() => moduleFactoryGroups([[10], 20, factory]), /registration has no factory/);
  assert.throws(() => moduleFactoryGroups([[factory]]), /factory has no registered module ID/);
  assert.throws(() => moduleFactoryGroups({ modules: [10, factory] }), /Unsupported Turbopack registrations/);
});
