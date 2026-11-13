import { describe, expect, it } from "vitest";
import { createAssignmentRoutes, readAssignmentBody } from "./http";
import type { KeryxDB } from "../db/keryx-db";
import { AssignmentError,type AsyncOwnerRunAssignmentsPort,type Receipt } from "./contracts";
describe("owner269 closed ingress (authored UNRUN)", () => {
  const routes = createAssignmentRoutes(async () => { throw new Error("Authentication must not run for rejected ingress"); }, "https://assignment.invalid");
  it.each([
    ["authorization", "Bearer anything", 401], ["origin", "https://attacker.invalid", 403],
    ["sec-fetch-site", "cross-site", 403],
  ] as const)("refuses %s before any account/store access", async (name, value, status) => {
    const request = new Request("https://assignment.invalid/api/me/run-assignments", { method: "POST", headers: { origin: "https://assignment.invalid", [name]: value } });
    expect((await routes.POST(request)).status).toBe(status);
  });
  it("rejects oversized streamed JSON rather than allocating it through req.json", async () => {
    await expect(readAssignmentBody(new Request("https://assignment.invalid", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify("x".repeat(16_384)) }))).rejects.toThrow();
  });
  it("rejects query selectors even on reads", async () => {
    expect((await routes.GET(new Request("https://assignment.invalid/api/me/run-assignments?account=other"))).status).toBe(400);
  });
});

/** Ordering/error seams only; genuine SQL authority is qualified separately. */
describe("explicit asynchronous owner-assignment route capability",()=>{
  const wallet='0x'+'ab'.repeat(20),hash='cd'.repeat(32),origin='https://assignment.invalid';
  const recipient={accountId:'acct_'+'ab'.repeat(32),accountCreatedAt:1,wallet,memberGeneration:'ef'.repeat(32)};
  const requestId='22222222-2222-4222-8222-222222222222';
  const receipt:Receipt={version:1,requestId,inputDigest:'12'.repeat(32),action:'consent',committedAt:10,results:[],meaning:'historical-committed-result-not-current-authority'};
  const body={expected:recipient,input:{action:'consent',requestId,acknowledgeAssignedLabel:true,noFinancialAuthority:true,
    manifest:{version:1,binding:{network:'eip155:5042',origin,storageDigest:'34'.repeat(32)},recipient,basis:{code:'early-run-recovery',reference:'fixture:async'},scope:'association-history-and-confirmation',admissionExpiresAt:1000,
      members:[{assignmentId:'11111111-1111-4111-8111-111111111111',runId:'synthetic-owner-route',originalSha256:'56'.repeat(32),completedAt:'2026-01-01T00:00:00.000Z'}]}}};
  const request=(mutation=false)=>new Request(origin+'/api/me/run-assignments',{method:mutation?'POST':'GET',headers:{origin,'x-keryx-expected-wallet':wallet,...(mutation?{'content-type':'application/json'}:{})},...(mutation?{body:JSON.stringify(body)}:{})});
  function fixture(replyError=false,lastChanges=false){
    const calls:string[]=[];let sessions=0;
    const port:AsyncOwnerRunAssignmentsPort={mode:'native-postgres-async-v1',async act(){calls.push('act-start');await Promise.resolve();calls.push('act-end');return receipt;},async reply(){calls.push('reply-start');await Promise.resolve();if(replyError)throw new AssignmentError('assignment_unauthenticated');calls.push('reply-end');return Response.json({version:1});}};
    const db={ownerRunAssignments:port,async getWebSession(){calls.push('getWebSession');return {hash,wallet,issuedAt:1,expiresAt:100000};}} as unknown as KeryxDB;
    const routes=createAssignmentRoutes(async()=>{calls.push('session-'+(++sessions));return {db,wallet,currentId:lastChanges&&sessions===3?'changed':hash};},origin);
    return {calls,routes};
  }
  it('awaits the committed action before the final session and explicit fresh reply',async()=>{
    const f=fixture();expect((await f.routes.POST(request(true))).status).toBe(200);
    expect(f.calls).toEqual(['session-1','getWebSession','session-2','act-start','act-end','session-3','reply-start','reply-end']);
  });
  it('maps a late native async refusal through the existing private error response',async()=>{
    const f=fixture(true),response=await f.routes.GET(request());expect(response.status).toBe(401);expect(await response.json()).toEqual({error:'assignment_unauthenticated'});expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('keeps a committed mutation unresolved if the last session changes',async()=>{
    const f=fixture(false,true),response=await f.routes.POST(request(true));expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'assignment_outcome_unresolved'});expect(f.calls).not.toContain('reply-start');
  });
});
