import { expect,it,vi } from "vitest";
import { readOperatorStatus,publishOperatorHeartbeat } from "./status";
import { decideOperatorCycle } from "./decision";
import { inventory,liquidity,NOW } from "./fixtures.test-support";
import { summarizeA2aOperations } from "../a2a/operations";
const decision=decideOperatorCycle({inventory,liquidity,nowMs:NOW});
function db(heartbeat:unknown=null) {
  return {getSyncState:vi.fn().mockResolvedValue(heartbeat===null?null:JSON.stringify(heartbeat)),
    operatorPublicSnapshot:vi.fn().mockResolvedValue({jobs:summarizeA2aOperations([],NOW),creatorCatalog:{registered:0}})};
}
const heartbeat={version:1,network:"eip155:5042",observedAt:new Date(NOW).toISOString(),decision,state:"working",auditRecorded:true};
it("only exposes the exact identifier-free public projection",async()=>{
  const result=await readOperatorStatus(db(heartbeat),"eip155:5042",NOW);
  expect(result.operator.state).toBe("working"); expect(JSON.stringify(result)).not.toMatch(/payer|payee|MicroUsdc|question|cycleId|orderId/);
});
it.each([{...heartbeat,question:"private"},{...heartbeat,network:"eip155:5042002"},{...heartbeat,auditRecorded:false},null])("malformed/foreign/unaudited state remains unavailable",async h=>{
  expect((await readOperatorStatus(db(h),"eip155:5042",NOW)).operator.state).toBe("unavailable");
});
it("never reports old/future heartbeats as an active operator",async()=>{
  expect((await readOperatorStatus(db(heartbeat),"eip155:5042",NOW+120001)).operator.state).toBe("stale");
  expect((await readOperatorStatus(db(heartbeat),"eip155:5042",NOW-1)).operator.state).toBe("stale");
});
it("an unavailable queue/catalog is unknown, not zero",async()=>{
  const d=db(); d.operatorPublicSnapshot.mockRejectedValue(new Error());
  expect(await readOperatorStatus(d,"eip155:5042",NOW)).toMatchObject({jobs:null,creatorCatalog:{registered:null}});
});
it("a recovery outcome stays visible as review without exposing its job ID",async()=>{
  const d={setSyncState:vi.fn().mockResolvedValue(undefined)};
  await publishOperatorHeartbeat(d,"eip155:5042",decision,"outcome",{id:"secret-job",status:"recovery_pending"});
  const saved=JSON.parse(d.setSyncState.mock.calls[0][1]); expect(saved.state).toBe("review"); expect(saved).not.toHaveProperty("id");
});
