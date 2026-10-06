import { afterEach, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readSqliteOperatorInventory } from "./inventory";
import { NOW } from "./fixtures.test-support";
const payee="0x2222222222222222222222222222222222222222", network="eip155:5042";
let db: DatabaseSync;
afterEach(()=>db?.close());
function database() {
  db=new DatabaseSync(":memory:");
  // Corruption fixtures deliberately bypass writer admission. The observation
  // reader must still fail closed on damaged/historical retained originals.
  db.exec(`CREATE TABLE a2a_orders(id TEXT,status TEXT,payee TEXT,request_data TEXT,
    creator_budget_usdc REAL,started_at TEXT,transaction_id TEXT);
    CREATE TABLE research_monthly(id TEXT,data TEXT);
    CREATE TABLE research_monthly_redemptions(monthly_id TEXT);`);
  return db;
}
function order(id: string, change: { budget?:number; payee?:string; request?:string; started?:string; transaction?:string }={}) {
  db.prepare("INSERT INTO a2a_orders VALUES(?,?,?,?,?,?,?)").run(id,"running",change.payee??payee,
    change.request??JSON.stringify({ network }),change.budget??0.05,change.started??null,change.transaction??"circle-original");
}
const read=()=>readSqliteOperatorInventory(db,{network,payee,nowMs:NOW},network);
it("covers every queued original beyond a REST-page size with exact micro-USDC totals",()=>{
  database(); const insert=db.prepare("INSERT INTO a2a_orders VALUES(?,?,?,?,?,?,?)");
  db.exec("BEGIN"); for(let i=0;i<1201;i++)insert.run(String(i),"running",payee,JSON.stringify({network}),0.0314,null,"circle-original"); db.exec("COMMIT");
  expect(read()).toMatchObject({queuedJobs:1201,queuedCreatorMicroUsdc:"37711400",largestCreatorMicroUsdc:"31400",invalidJobs:0});
});
it("keeps unredeemed Monthly reserve once, and the redeemed unfinished job once",()=>{
  database(); order("monthly-original-job");
  db.prepare("INSERT INTO research_monthly VALUES(?,?)").run("monthly",JSON.stringify({network,payee,creatorBudgetMicros:50000,
    createdAt:new Date(NOW-1000).toISOString(),expiresAt:new Date(NOW+1000).toISOString(),transaction:"original-inbound"}));
  db.prepare("INSERT INTO research_monthly_redemptions VALUES(?)").run("monthly");
  expect(read()).toMatchObject({queuedCreatorMicroUsdc:"50000",prepaidRequests:3,prepaidCreatorMicroUsdc:"150000",invalidJobs:0});
  db.prepare("UPDATE research_monthly SET data=json_set(data,'$.expiresAt',?)").run(new Date(NOW).toISOString());
  expect(read()).toMatchObject({prepaidRequests:0,prepaidCreatorMicroUsdc:"0",queuedCreatorMicroUsdc:"50000"});
});
it("classifies started originals without silently dropping ambiguous obligations",()=>{
  database(); order("active",{started:new Date(NOW-1000).toISOString()}); order("old",{started:new Date(NOW-900000).toISOString()});
  order("broken",{started:"unparseable"});
  expect(read()).toMatchObject({processingJobs:1,reviewRequiredJobs:2,invalidJobs:1,unfinishedCreatorMicroUsdc:"150000"});
});
it.each([{request:"{"},{request:"[]"},{request:JSON.stringify({network:"eip155:5042002"})},
  {payee:"0x1111111111111111111111111111111111111111"},{budget:0.0500001},{transaction:""},
  {started:new Date(NOW+1).toISOString()}])("marks a malformed/foreign original invalid %j",change=>{
  database(); order("bad",change); expect(read().invalidJobs).toBe(1);
});
it.each([{network:"eip155:5042002"},{creatorBudgetMicros:"50000"},{expiresAt:"bad"},{transaction:""}])("refuses a malformed Monthly reserve %j",change=>{
  database(); db.prepare("INSERT INTO research_monthly VALUES(?,?)").run("bad",JSON.stringify({network,payee,creatorBudgetMicros:50000,
    createdAt:new Date(NOW-1000).toISOString(),expiresAt:new Date(NOW+1000).toISOString(),transaction:"settled-original",...change}));
  expect(()=>{ const result=read(); expect(result.invalidJobs).toBeGreaterThan(0); }).not.toThrow();
});
it("the facade-selected network cannot be overridden",()=>{
  database(); expect(()=>readSqliteOperatorInventory(db,{network,payee,nowMs:NOW},"eip155:5042002")).toThrow("network mismatch");
});
