/** Synthetic native SQLite allocation only; never accepts a data-file target. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { verifySnapshotContainment } from '../../lib/db/storage-provenance-snapshot';
assert.equal(process.platform,'linux');assert.equal(process.getuid?.(),0);assert.equal(process.version,'v24.22.1');assert.equal(process.argv.length,3);
const unit=process.argv[2];verifySnapshotContainment(unit);
assert.equal(readFileSync('/sys/fs/cgroup/system.slice/'+unit+'/cpu.max','utf8').trim(),'50000 100000');
assert.equal(execFileSync('/usr/bin/systemctl',['show',unit,'-p','RuntimeMaxUSec','--value'],{encoding:'utf8',timeout:2000,maxBuffer:4096,env:{NODE_ENV:'production'}}).trim(),'30s');
console.log(JSON.stringify({syntheticOnly:true,actualKernelLimitsVerified:true,memoryMax:268435456,swapMax:0,cpuMax:'50000 100000',pidsMax:32,runtimeMaxSeconds:30,target:':memory:',productionDataRead:false}));
const db=new DatabaseSync(':memory:');
try{db.prepare('SELECT length(randomblob(314572800))').get();throw new Error('Synthetic native pressure unexpectedly survived');}finally{db.close();}
