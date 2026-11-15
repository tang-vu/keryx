/** Fresh Source construction only. This cannot install on a retained target,
 * select an application backend, or admit a complete application writer. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {nativeA2aFulfillmentSource} from './a2a-fulfillment-source.mts';

// Include transitive observations whose operation relation metadata omits the
// payment table. A relation-name test alone leaves these financial paths open.
export const LEGACY_PAYMENT_OBSERVERS=Object.freeze([
 'a2a_create','a2a_fulfillment_claim','a2a_fulfillment_complete','a2a_fulfillment_snapshot','a2a_fulfillment_verify',
 'a2a_original_claim','a2a_original_settled','a2a_resolve_completed','a2a_resolve_failed',
 'acceptance_metrics','acceptance_public','acceptance_read','acceptance_submit','activate_browser_journal','admit_browser_journal',
 'browser_signer_confirmed_spend_micro','browser_signing_admit_original','browser_signing_admit_source_original',
 'browser_signing_exposed_snapshot_for_signer','browser_signing_record_signature','browser_signing_replay_source_original','browser_signing_snapshot',
 'creator_owner_accounting','creator_owner_admit','daily_settled','dashboard_metrics','fail_pending_payment','get_browser_journal',
 'hosted_accounting','hosted_admit_authorization','hosted_confirm','hosted_submit','list_creator_payment_attempts_by_query',
 'list_payments','list_payments_by_query','list_payments_by_source','list_pending_payments','owner_assignment_act','owner_assignment_reply',
 'personal_history_receipts','private_profile_get','public_health_snapshot','public_profile_read','public_usage_window',
 'record_payment','record_payment_once','reserve_session_withdrawal','resolve_a2a_order','scan_payment_metrics','session_funding_accounting',
 'session_withdrawal_accounting','settle_pending_payment','settlement_ledger','sign_browser_journal','terminal_browser_journal','transition_browser_journal',
] as const);
export const SOURCE_PAYMENT_OBSERVERS=Object.freeze([
 'payment_event_record','payment_event_record_once','payment_event_snapshot','payment_event_terminal',
 'browser_source_read','browser_source_activate','browser_source_grant','browser_source_intent','browser_source_admit','browser_source_transition','browser_source_query',
] as const);
export const HOSTED_SOURCE_PAYMENT_OBSERVERS=Object.freeze(['hosted_admit_authorization','hosted_submit','hosted_confirm','hosted_accounting'] as const);
const quote=(s:string)=>{if(!/^[a-z][a-z0-9_]+$/.test(s))throw Error('Payment observer Source name refused');return "'"+s+"'";};
export function nativePaymentBrowserSource(hostedPaymentOriginals=false){
 if(typeof hostedPaymentOriginals!=='boolean')throw Error('Hosted payment Source selection refused');
 let sql=nativeA2aFulfillmentSource().sql;
 // These three obsolete 0074 writers enter the permanently closed legacy
 // writer. Retire their fresh declarations, without editing an existing target.
 for(const name of ['record_payment','record_payment_once','settle_pending_payment']){
  const pattern=new RegExp('create function public\\.storage_'+name+'\\([^]*?\\$\\$;','gi');
  const matches=[...sql.matchAll(pattern)];if(matches.length!==1)throw Error('Payment legacy Source retirement refused');
  sql=sql.replace(pattern,'');
  if(sql.includes('public.storage_'+name+'('))throw Error('Payment legacy Source caller remains');
 }
 const read=(name:string,limit:number)=>{const part=readFileSync(new URL('../../ops/keryx-postgres/'+name,import.meta.url),'utf8').replaceAll('\r\n','\n');if(Buffer.byteLength(part)>limit)throw Error('Payment/browser Source part bound');return part;};
 const browser=read('browser-journal.sql',65536),browserGroups=[...browser.matchAll(/CREATE FUNCTION public\.(storage_browser_journal(?:_evidence)?)\([^]*?END;\$\$;/g)];
 if(browserGroups.length!==2||new Set(browserGroups.map(m=>m[1])).size!==2||browserGroups.some(m=>Buffer.byteLength(m[0])>32768))throw Error('Browser fixed Source group inventory or bound');
 const parts=[read('payment-events.sql',32768),read('browser-journal-schema.sql',16384),browser];
 let observation=read('payment-observation.sql',16384);
 const legacy=hostedPaymentOriginals?LEGACY_PAYMENT_OBSERVERS.filter(name=>!HOSTED_SOURCE_PAYMENT_OBSERVERS.some(hosted=>hosted===name)):LEGACY_PAYMENT_OBSERVERS;
 const sourceAware=hostedPaymentOriginals?[...SOURCE_PAYMENT_OBSERVERS,...HOSTED_SOURCE_PAYMENT_OBSERVERS]:SOURCE_PAYMENT_OBSERVERS;
 for(const [token,values] of [['{{LEGACY_PAYMENT_OPERATIONS}}',legacy],['{{SOURCE_PAYMENT_OPERATIONS}}',sourceAware]] as const){
  if(observation.split(token).length!==(token==='{{LEGACY_PAYMENT_OPERATIONS}}'?3:2))throw Error('Payment observer Source constructor refused');observation=observation.replaceAll(token,values.map(quote).join(','));
 }
 sql+='\n'+parts.join('\n')+'\n'+observation;
 if(hostedPaymentOriginals)sql+='\n'+read('hosted-payment-events.sql',32768);
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Closed payment/browser metadata protocols only. Exact Source intake, every producer and observer, complete writer and production cutover require separate acceptance.'});
}
