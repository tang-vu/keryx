import { describe,expect,it } from 'vitest';
import { calculateDashboardMetrics } from '../dashboard-metrics';
import { dashboardMetricsFromPostgresAggregate } from './dashboard-aggregate';
import { PostgresStorageUnavailable } from './connection';
const empty=()=>({format:'keryx-native-dashboard-aggregate-v1',payments:{count:0,volume:'0',creatorVolume:'0',operatingVolume:'0',operatingCount:0,creators:0,payingQueries:0,pendingCount:0,pendingVolume:'0',failedCount:0,failedVolume:'0'},runs:{count:0,guests:0,evidenceRuns:0,evidenceClaims:0,withheld:0},feedback:{count:0,up:0},gaps:{count:0,filled:0,pending:0},channels:[] as {client:string;queries:number;payingQueries:number}[],accounts:0 as number|null});
describe('bounded PostgreSQL dashboard aggregates',()=>{
 it('preserves the reference empty report and unavailable grounding label',()=>{
  expect(dashboardMetricsFromPostgresAggregate(empty())).toEqual({...calculateDashboardMetrics([],[]),recordedAccounts:0});
 });
 it('preserves rounding, zero denominators and channel ordering from the reference calculator',()=>{
  const a=empty();Object.assign(a.payments,{count:1,volume:'.123456',creatorVolume:'.123456',creators:1,payingQueries:1});
  // Native numeric text has a leading zero; reject noncanonical scalar variants.
  expect(()=>dashboardMetricsFromPostgresAggregate(a)).toThrow(PostgresStorageUnavailable);
  a.payments.volume=a.payments.creatorVolume='0.123456';Object.assign(a.runs,{count:2,guests:0});a.channels=[{client:'codex',queries:1,payingQueries:1},{client:'claude',queries:1,payingQueries:0}];a.accounts=null;
  expect(dashboardMetricsFromPostgresAggregate(a)).toEqual({...calculateDashboardMetrics([{amountUsdc:.123456,sourceId:'s',queryId:'one',kind:'fetch',settled:true}], [{id:'one',origin:'mcp',mcpClient:'codex'},{id:'two',origin:'mcp',mcpClient:'claude'}]),recordedAccounts:null});
 });
 it.each([
  (a:ReturnType<typeof empty>)=>{a.runs.count=Number.MAX_SAFE_INTEGER+1;},
  (a:ReturnType<typeof empty>)=>{a.runs.count=.5;},
  (a:ReturnType<typeof empty>)=>{a.payments.volume='NaN';},
  (a:ReturnType<typeof empty>)=>{a.payments.operatingCount=1;},
  (a:ReturnType<typeof empty>)=>{a.feedback.up=1;},
  (a:ReturnType<typeof empty>)=>{a.channels=[{client:'codex',queries:1,payingQueries:2}];},
  (a:ReturnType<typeof empty>)=>{a.channels=[{client:'codex',queries:1,payingQueries:0},{client:'codex',queries:1,payingQueries:0}];},
 ])('refuses malformed or contradictory native observations',mutate=>{const a=empty();mutate(a);expect(()=>dashboardMetricsFromPostgresAggregate(a)).toThrow(PostgresStorageUnavailable);});
});
