import { afterEach,expect,it } from "vitest";
import { mkdtemp,readFile,rm,symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID,createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { prepareOperatorAuditDirectory,writeOperatorAudit } from "./journal";
import { withPrivateWorkerLock } from "../a2a/private-worker-lock";
import { inventory,liquidity,NOW } from "./fixtures.test-support";
import { decideOperatorCycle } from "./decision";
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function directory(){const root=await mkdtemp(join(tmpdir(),"keryx-business-audit-"));roots.push(root);return join(root,"audit");}
it("durably retains unique audit records and refuses to overwrite the original",async()=>{
  const dir=await directory(); const event={version:1 as const,cycleId:randomUUID(),phase:"decision" as const,inventory,liquidity,
    decision:decideOperatorCycle({inventory,liquidity,nowMs:NOW})};
  await writeOperatorAudit(dir,event);
  const record=JSON.parse(await readFile(join(dir,`${event.cycleId}-decision.json`),"utf8"));
  expect(record.digest).toBe(createHash("sha256").update(canonicalJson(record.event)).digest("hex"));
  await expect(writeOperatorAudit(dir,event)).rejects.toThrow();
  expect(JSON.parse(await readFile(join(dir,`${event.cycleId}-decision.json`),"utf8"))).toEqual(record);
});
it("refuses relative paths and a symlink audit destination",async()=>{
  await expect(prepareOperatorAuditDirectory("relative-audit")).rejects.toThrow();
  const dir=await directory(); await symlink(roots[0],dir,process.platform==="win32"?"junction":"dir");
  await expect(prepareOperatorAuditDirectory(dir)).rejects.toThrow();
});
it("a concurrent worker cannot claim while the original worker owns its private lock",async()=>{
  const dir=await directory(); await prepareOperatorAuditDirectory(dir);
  let entered!:()=>void,finish!:()=>void;
  const ready=new Promise<void>(resolve=>{entered=resolve;}); const done=new Promise<void>(resolve=>{finish=resolve;});
  const original=withPrivateWorkerLock(dir,async()=>{entered();await done;}); await ready;
  let secondRan=false;
  await expect(withPrivateWorkerLock(dir,async()=>{secondRan=true;})).rejects.toThrow(); expect(secondRan).toBe(false);
  finish();await original;
  await expect(withPrivateWorkerLock(dir,async()=>"clean restart")).resolves.toBe("clean restart");
});
