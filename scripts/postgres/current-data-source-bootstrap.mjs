import assert from 'node:assert/strict';

const modes=['--development-current-data-source-plan-only','--development-current-data-synthetic','--development-current-data-retained','--current-runtime-synthetic','--current-runtime-retained','--held-catchup-synthetic'];
assert.equal(modes.filter(mode=>process.argv.includes(mode)).length,1);
assert.equal(process.env.KERYX_NETWORK,'arc');
assert.equal(process.env.NEXT_PUBLIC_KERYX_NETWORK,'arc');
assert.equal(process.env.KERYX_FORCE_OFFLINE,'0');
// Initialize actual mainnet Source schemas before sticky imports. This bounded
// rehearsal never calls a provider or signs a payment. The explicit current
// runtime modes qualify a readonly facade over the isolated fresh target only.
// The HELD catchup mode materializes synthetic Source data without activation.
globalThis.fetch=async()=>{throw Error('Current data qualification forbids provider HTTP');};
