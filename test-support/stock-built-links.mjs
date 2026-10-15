// SOURCE ONLY. Exact #257 stock build data; built-ins only, no caller allowlist.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const wt=path.resolve('D:/repos/server/Github/Hackathon/.keryx-worktrees/cli-job-target257-owner-association-20261015');
const distPath=path.join(wt,'.next');
const copyPaths=new Set([path.join(wt,'output/one-failed-hydration-diagnostic-parent-execution/runtime/.next')]);
const stock=new Map([
  ['node_modules/@circle-fin/unified-balance-kit-0c69b7e99b232cac',path.join(wt,'node_modules/@circle-fin/unified-balance-kit')],
  ['node_modules/parse5-6a112f640792b72b',path.join(wt,'node_modules/parse5')],
  ['node_modules/pino-28069d5257187539',path.join(wt,'node_modules/pino')],
]);
const sha=b=>createHash('sha256').update(b).digest('hex');
const identity=s=>[s.dev,s.ino,s.mode,s.nlink,s.size,s.mtimeMs,s.ctimeMs];
// Ancestor contents may change when the existing caller creates its owned output;
// pin object identity, type and link count, not unrelated ancestor directory clocks.
const ancestorIdentity=s=>[s.dev,s.ino,s.mode,s.nlink];
function native(records) {
  assert.equal(process.platform,'win32');assert(records.length<=51000);
  // Namespaced lookup addresses the SAME absolute Windows path beyond MAX_PATH.
  // Keep raw target unchanged for the exact Junction target comparison below.
  const input=records.map(r=>{assert(!/[\r\n]/.test(r.path+r.target));return JSON.stringify({...r,path:path.toNamespacedPath(r.path)});}).join('\n')+'\n';
  assert(Buffer.byteLength(input)<=16*1024*1024);
  const command='$ErrorActionPreference="Stop"; while ($null -ne ($s=[Console]::In.ReadLine())) { $r=$s|ConvertFrom-Json; $i=Get-Item -Force -LiteralPath $r.path; if ($r.target) { if ($i.LinkType -cne "Junction" -or @($i.Target).Count -ne 1 -or $i.Target[0] -cne $r.target -or -not ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $i.PSIsContainer) { exit 1 } } elseif ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) { exit 1 } }; [Console]::Out.Write("stock-ordinary")';
  assert.equal(execFileSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo','-NoProfile','-NonInteractive','-Command',command],
    {input,encoding:'utf8',windowsHide:true,maxBuffer:4096,env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR}}),'stock-ordinary');
}
function ancestors(p,checkNative=true) {
  const records=[];
  for(let q=path.resolve(p);;q=path.dirname(q)) {
    const s=fs.lstatSync(q);assert(s.isDirectory()&&!s.isSymbolicLink());assert.equal(fs.realpathSync(q),q);
    records.push({path:q,target:'',identity:ancestorIdentity(s)});
    if(path.dirname(q)===q) break;
  }
  if(checkNative) native(records);return records;
}
function stableAncestors(records) {
  native(records);
  for(const r of records) {
    const s=fs.lstatSync(r.path);assert(s.isDirectory()&&!s.isSymbolicLink());
    assert.equal(fs.realpathSync(r.path),r.path);assert.deepEqual(ancestorIdentity(s),r.identity);
  }
}
function readEntry(e) {
  assert.equal(fs.realpathSync(e.physical),e.physical);
  assert.deepEqual(identity(fs.lstatSync(e.physical)),e.identity);assert.equal(e.identity[3],1);
  const fd=fs.openSync(e.physical,fs.constants.O_RDONLY);
  try {
    assert.deepEqual(identity(fs.fstatSync(fd)),e.identity);
    const bytes=Buffer.alloc(e.identity[4]+1);let n=0;
    while(n<bytes.length) {const got=fs.readSync(fd,bytes,n,bytes.length-n,null);if(!got) break;n+=got;}
    assert.equal(n,e.identity[4]);assert.deepEqual(identity(fs.fstatSync(fd)),e.identity);
    assert.deepEqual(identity(fs.lstatSync(e.physical)),e.identity);assert.equal(fs.realpathSync(e.physical),e.physical);
    const b=bytes.subarray(0,n);if(e.sha256) assert.equal(sha(b),e.sha256);return b;
  } finally {fs.closeSync(fd);}
}
// Breadth first: native attributes are checked BEFORE descending into a directory
// or opening file content, including every entry of the three physical targets.
function inspectStock(dist,physicalCopy=false,expected=null) {
  if(physicalCopy) assert(copyPaths.has(path.resolve(dist))); else assert.equal(path.resolve(dist),distPath);
  // expected supplies only previously content-verified digest DATA. Every path,
  // identity, type, native attribute and complete child set is freshly observed.
  const expectedPins=expected===null?null:new Map(stockPins(expected).map(p=>[p.path,p.sha256]));
  const chain=ancestors(dist),entries=[],links=[];
  let frontier=[{logical:'',physical:path.resolve(dist)}],bytes=0;
  while(frontier.length) {
    assert(entries.length+frontier.length<=50000);
    const layer=frontier.map(r=>{
      assert(r.logical.split('/').length<=33);assert(!/(^|\/)\.env($|\.)/.test(r.logical));
      const s=fs.lstatSync(r.physical);const e={...r,identity:identity(s),target:''};
      if(s.isSymbolicLink()) {
        assert(!physicalCopy&&stock.has(r.logical),'All other links refused: '+r.logical);
        assert.equal(r.physical,path.join(distPath,r.logical));assert.equal(s.nlink,1);
        e.target=stock.get(r.logical);assert.equal(fs.readlinkSync(r.physical),e.target);
        assert.equal(fs.realpathSync(r.physical),e.target);
      } else {assert(s.isDirectory()||s.isFile());assert.equal(fs.realpathSync(r.physical),r.physical);}
      return e;
    });
    native(layer.map(e=>({path:e.physical,target:e.target})));
    frontier=[];
    for(let e of layer) {
      if(e.target) {
        links.push(e);chain.push(...ancestors(e.target));
        e={logical:e.logical,physical:e.target,identity:identity(fs.lstatSync(e.target)),target:''};
      }
      const s=fs.lstatSync(e.physical);assert.deepEqual(identity(s),e.identity);
      assert(!s.isSymbolicLink());assert.equal(fs.realpathSync(e.physical),e.physical);
      if(s.isDirectory()) {
        e.kind='D';e.children=fs.readdirSync(e.physical).sort();
        for(const name of e.children) frontier.push({logical:e.logical?e.logical+'/'+name:name,physical:path.join(e.physical,name)});
      } else {
        assert(s.isFile()&&s.nlink===1&&s.size<=134217728);bytes+=s.size;assert(bytes<=2147483648);
        e.kind='F';
        if(expectedPins===null) e.sha256=sha(readEntry(e));
        else {e.sha256=expectedPins.get(e.logical);assert.equal(typeof e.sha256,'string');assert(/^[a-f0-9]{64}$/.test(e.sha256));}
      }
      entries.push(e);
    }
  }
  assert.deepEqual(links.map(e=>e.logical).sort(),physicalCopy?[]:[...stock.keys()].sort());
  stableAncestors(chain);
  native([...entries.map(e=>({path:e.physical,target:''})),...links.map(e=>({path:e.physical,target:e.target}))]);
  for(const e of entries) {
    assert.deepEqual(identity(fs.lstatSync(e.physical)),e.identity);assert.equal(fs.realpathSync(e.physical),e.physical);
    if(e.kind==='D') assert.deepEqual(fs.readdirSync(e.physical).sort(),e.children);
  }
  for(const e of links) {
    assert.deepEqual(identity(fs.lstatSync(e.physical)),e.identity);
    assert.equal(fs.readlinkSync(e.physical),e.target);assert.equal(fs.realpathSync(e.physical),e.target);
  }
  entries.sort((a,b)=>a.logical<b.logical?-1:a.logical>b.logical?1:0);
  return {dist:path.resolve(dist),ancestors:chain,entries,links,bytes};
}
// The caller performs the one initial content qualification and persists its real
// result. These later observations never claim a newly computed content digest.
export function qualifyStock(dist,physicalCopy=false) {return inspectStock(dist,physicalCopy);}
export function assertStockUnchanged(dist,qualified) {
  assert.equal(path.resolve(dist),distPath);
  assert.deepEqual(inspectStock(dist,false,qualified),qualified,'Fresh full source metadata, native links and complete keysets');
}
export const qualificationHash=q=>sha(JSON.stringify(q));
export const stockPins=q=>q.entries.filter(e=>e.kind==='F').map(e=>({path:e.logical,sha256:e.sha256}));
const shape=q=>q.entries.map(e=>e.kind==='D'?{path:e.logical,kind:e.kind,children:e.children}:{path:e.logical,kind:e.kind});
export const stockShapeHash=q=>sha(JSON.stringify(shape(q)));
export function copyStock(dist,destination,qualified) {
  assert(copyPaths.has(path.resolve(destination)));assert(!fs.existsSync(destination));
  assertStockUnchanged(dist,qualified);
  const dirs=ancestors(path.dirname(destination));
  // Private to this copy. Only our successful exclusive mkdir results enter
  // this registry; the initial parent stays a separately pinned boundary.
  const initialParent=dirs[0],createdDirs=new Map(),writtenFiles=[];
  // Physical bytes only, including ALL target contents. No cp dereference,
  // junction creation, source materialization, unconsumed subset, or overwrite.
  for(const e of qualified.entries) {
    const target=path.join(destination,e.logical);const r=path.relative(destination,target);
    assert(r===''||(!path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep)));
    const parent=path.resolve(path.dirname(target));
    const expected=parent===initialParent.path?initialParent.identity:createdDirs.get(parent);
    assert(expected,'Immediate parent must be initial parent or an exclusively created directory');
    const parentStat=fs.lstatSync(parent);
    assert(parentStat.isDirectory()&&!parentStat.isSymbolicLink());
    assert.equal(fs.realpathSync(parent),parent);assert.deepEqual(ancestorIdentity(parentStat),expected);
    if(e.kind==='D') {
      fs.mkdirSync(target);
      const directoryPath=path.resolve(target),directory=fs.lstatSync(directoryPath);
      assert(directory.isDirectory()&&!directory.isSymbolicLink());
      assert.equal(fs.realpathSync(directoryPath),directoryPath);assert(!createdDirs.has(directoryPath));
      createdDirs.set(directoryPath,ancestorIdentity(directory));
    }
    else {
      const content=readEntry(e);const fd=fs.openSync(target,'wx',e.identity[2]&0o777);
      try {
        assert.equal(fs.fstatSync(fd).nlink,1);fs.writeFileSync(fd,content);
        const writtenIdentity=identity(fs.fstatSync(fd));assert.equal(writtenIdentity[3],1);
        // readEntry just proved this exact buffer against the admitted digest.
        // Pin the written FD identity; do not label a metadata observation a hash.
        writtenFiles.push({logical:e.logical,physical:target,identity:writtenIdentity,sha256:e.sha256});
      }
      finally {fs.closeSync(fd);}
    }
  }
  stableAncestors(dirs);assertStockUnchanged(dist,qualified);
  // One source-FD content pass during copy; no second destination content scan.
  // Independently rediscover the entire physical output tree/native attributes,
  // then match every file to the identity captured on its actual written FD.
  const copied=inspectStock(destination,true,qualified),writtenByPath=new Map(writtenFiles.map(e=>[e.logical,e]));
  assert.equal(writtenByPath.size,writtenFiles.length);assert.equal(stockPins(copied).length,writtenFiles.length);
  for(const e of copied.entries.filter(e=>e.kind==='F')) {
    const written=writtenByPath.get(e.logical);assert(written);
    assert.equal(e.physical,written.physical);assert.deepEqual(e.identity,written.identity);assert.equal(e.sha256,written.sha256);
  }
  assert.deepEqual(stockPins(copied),stockPins(qualified),'FULL consumed file keyset and bytes');
  assert.deepEqual(shape(copied),shape(qualified),'FULL consumed directories and child keysets');
  return {compiledPins:stockPins(copied),shapeSha256:stockShapeHash(copied),stockQualificationSha256:qualificationHash(qualified)};
}
