import assert from 'node:assert/strict';
assert(process.argv.includes('--private-research-only'));
assert.equal(process.env.KERYX_NETWORK,'arc');
assert.equal(process.env.NEXT_PUBLIC_KERYX_NETWORK,'arc');
assert.equal(process.env.KERYX_FORCE_OFFLINE,'0');
// Mainnet schema and offline test-key data signatures, with no provider HTTP.
globalThis.fetch=async()=>{throw Error('Private storage qualification forbids provider HTTP');};
