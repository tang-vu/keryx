import { z } from 'zod';
import type { DashboardMetrics } from '../../types';
import { AGGREGATE_EVIDENCE_QUALITY } from '../dashboard-metrics';
import { PostgresStorageUnavailable } from './connection';
const count=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const money=z.string().max(128).regex(/^-?[0-9]+(?:\.[0-9]+)?$/).transform(Number).refine(Number.isFinite);
const aggregate=z.object({format:z.literal('keryx-native-dashboard-aggregate-v1'),
 payments:z.object({count,volume:money,creatorVolume:money,operatingVolume:money,operatingCount:count,creators:count,payingQueries:count,pendingCount:count,pendingVolume:money,failedCount:count,failedVolume:money}).strict(),
 runs:z.object({count,guests:count,evidenceRuns:count,evidenceClaims:count,withheld:count}).strict(),
 feedback:z.object({count,up:count}).strict(),gaps:z.object({count,filled:count,pending:count}).strict(),
 channels:z.array(z.object({client:z.enum(['codex','claude','cursor','direct','other','unknown']),queries:count,payingQueries:count}).strict()).max(6),accounts:count.nullable(),
}).strict();
const round=(n:number)=>Math.round(n*1_000_000)/1_000_000;
/** The reference calculator's final arithmetic over bounded native summaries. */
export function dashboardMetricsFromPostgresAggregate(value:unknown):DashboardMetrics {
 try{
  const a=aggregate.parse(value),p=a.payments,r=a.runs,f=a.feedback,g=a.gaps;
  if(p.operatingCount>p.count||r.guests>r.count||r.evidenceRuns>r.count||r.withheld>r.evidenceRuns||f.up>f.count||g.filled+g.pending>g.count
   ||new Set(a.channels.map(c=>c.client)).size!==a.channels.length||a.channels.some(c=>c.payingQueries>c.queries))throw new Error();
  const result:DashboardMetrics={totalPayments:p.count,totalVolumeUsdc:round(p.volume),totalCreatorPayoutsUsdc:round(p.creatorVolume),
   settledOperatingFeeUsdc:round(p.operatingVolume),settledOperatingFeePayments:p.operatingCount,creatorsEarning:p.creators,
   avgPaymentUsdc:p.count?round(p.volume/p.count):0,totalQueries:r.count,guestQuestions:r.guests,payingQueries:p.payingQueries,
   readerToPayerConversion:r.count?round(p.payingQueries/r.count):0,evidenceRunSamples:r.evidenceRuns,evidenceClaimSamples:r.evidenceClaims,
   groundedClaimRate:null,evidenceQuality:AGGREGATE_EVIDENCE_QUALITY,citationPoolWithheldRuns:r.withheld,
   gapIntentOffers:g.count,gapIntentFilled:g.filled,gapIntentPending:g.pending,gapIntentFillRate:g.count?round(g.filled/g.count):0,
   feedbackTotal:f.count,satisfactionRate:f.count?round(f.up/f.count):0,pendingPaymentConfirmations:p.pendingCount,
   pendingPaymentVolumeUsdc:round(p.pendingVolume),failedPaymentAttempts:p.failedCount,failedPaymentVolumeUsdc:round(p.failedVolume),
   mcpClientQueries:a.channels.sort((x,y)=>y.queries-x.queries||x.client.localeCompare(y.client)),recordedAccounts:a.accounts};
  if(Object.values(result).some(v=>typeof v==='number'&&!Number.isFinite(v)))throw new Error();
  return result;
 }catch{throw new PostgresStorageUnavailable();}
}
