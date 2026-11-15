import assert from 'node:assert/strict';

const modes=['--development-current-data-source-plan-only','--development-current-data-synthetic','--development-current-data-retained'];
assert.equal(modes.filter(mode=>process.argv.includes(mode)).length,1);
assert.equal(process.env.KERYX_NETWORK,'arc');
assert.equal(process.env.NEXT_PUBLIC_KERYX_NETWORK,'arc');
assert.equal(process.env.KERYX_FORCE_OFFLINE,'0');
// Initialize actual mainnet Source schemas before sticky imports. This bounded
// data rehearsal never calls a provider, signs a payment or opens a writer.
globalThis.fetch=async()=>{throw Error('Current data qualification forbids provider HTTP');};
