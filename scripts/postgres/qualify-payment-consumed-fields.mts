/** Current-profile fixed financial observations only. Source originals and
 * native projections are copied from a fresh synthetic Source, never adopted
 * from Native rows. No installed factory/funding/provider/signature proof. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import {canonicalJson} from '../../lib/canonical-json';
import {storageIdentityDigest,validateStorageIdentity,type StorageIdentity} from '../../lib/db/storage-identity';
import type {PostgresConnectionOptions} from '../../lib/db/postgres/connection';
import {createPostgresDomainChannel} from '../../lib/db/postgres/domain-channel';
import {composePostgresOwnerWithdrawalTransport} from '../../lib/db/postgres/owner-withdrawal-transport';
import {composePostgresHostedAdmission} from '../../lib/db/postgres/hosted-admission-transport';
import {composeNativeFinancialApplicationPort} from '../../lib/db/postgres/native-financial-application-port';
import {composePostgresBrowserJournal} from '../../lib/db/postgres/browser-journal-transport';
import {composePostgresPaymentEvents} from '../../lib/db/postgres/payment-events-transport';
import {PAYMENT_EVENT_FIELDS} from '../../lib/db/postgres/payment-events-packet';
import {LEGACY_PAYMENT_CONSUMED_FIELDS,KNOWN_PAYMENT_UNPROJECTED_FIELDS} from './payment-browser-source.mts';
import {createPaymentConsumedFieldsFixture,PAYMENT_CONSUMED_FIXTURE_RECEIPTS,type PaymentConsumedFixtureCase} from './payment-consumed-fields-fixture.mts';

export async function qualifyPaymentConsumedFields(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;contentionClient:Client;ownerSql:(sql:string)=>string}){
 const identity=validateStorageIdentity(input.identity),identitySha=storageIdentityDigest(identity),q=(value:string)=>"'"+value.replaceAll("'","''")+"'";
 const fixture=createPaymentConsumedFieldsFixture(identity),channel=createPostgresDomainChannel(input.options,identity,input.digest),transport=composePostgresOwnerWithdrawalTransport(channel,identity);
 const application=composeNativeFinancialApplicationPort({...transport,...composePostgresHostedAdmission(channel,identity,false,'source-payment-originals-v1')},false,()=>channel.closed);
 const browser=composePostgresBrowserJournal(channel,false),payments=composePostgresPaymentEvents(channel,false);
 let foreign:ReturnType<typeof createPostgresDomainChannel>|undefined,vectors=0;
 const held=(sql:string)=>{try{return input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+sql+"UPDATE keryx_storage.control SET mode='active';COMMIT;");}catch(error){input.ownerSql('ROLLBACK;');throw error;}};
 const tokensEmpty=()=>assert.equal(input.ownerSql('SELECT (SELECT count(*) FROM keryx_storage.writer)+(SELECT count(*) FROM public.browser_journal_writer)+(SELECT count(*) FROM public.browser_signing_v2_writer)+(SELECT count(*) FROM public.browser_signing_v3_writer);'),'0');
 const columns={browser_journal_control:['id','active'],session_grants:['session_id','sess_addr','owner_addr','cap','spent','expiry','tx_hash','grant_epoch'],browser_signer_capacity:['signer','spent_micro'],browser_retained_grants:['grant_epoch','session_id','signer','spent_micro'],browser_authorization_intents:['nonce','session_id','request_id','query_id','grant_epoch','signer','network','token','gateway_contract','source_id','offer_id','kind','payee','amount_micro_usdc','phase','created_at'],browser_journal_bindings:['nonce','requirements','payment_metadata','valid_after','valid_before','header_hash','payment_context']} as const;
 const cell=(value:unknown)=>{if(value===null)return 'NULL';if(typeof value==='number'){assert(Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER);return String(value);}assert.equal(typeof value,'string');assert(!String(value).includes('\0'),'Only the explicit payment projection may contain an unprojectable Source scalar');return q(value as string);};
 const nativeRead=async(key:PaymentConsumedFixtureCase='padded')=>{const signer=fixture.cases[key].signer;return {funding:await transport.sessionFundingAccounting(signer),withdrawal:await transport.sessionWithdrawalAccounting(signer),creatorOwner:await transport.creatorOwnerWithdrawalAccounting(signer),confirmed:await application.browserSignerConfirmedSpendMicro(signer)};};
 const readRefuses=async(key:PaymentConsumedFixtureCase)=>{const signer=fixture.cases[key].signer;for(const action of [()=>transport.sessionFundingAccounting(signer),()=>transport.sessionWithdrawalAccounting(signer),()=>transport.creatorOwnerWithdrawalAccounting(signer),()=>application.browserSignerConfirmedSpendMicro(signer)]){await assert.rejects(action());vectors++;}};
 const originals=new Map<string,ReturnType<typeof fixture.payment>>();
 const exactPayment=(key:PaymentConsumedFixtureCase)=>{const record=fixture.cases[key],current=fixture.payment(key),original=originals.get(record.id)!;
  const raw=input.ownerSql(`SELECT jsonb_build_object('identity',o.identity_digest,'original',o.original_wire::text,'originalSha',o.original_sha256,'current',o.current_wire::text,'currentSha',o.current_sha256,'projectionMatches',o.native_projection=to_jsonb(p),'fields',o.unprojected_fields)::text FROM keryx_storage.payment_event_originals o JOIN public.payment_events p ON p.id=o.payment_id WHERE o.payment_id=${q(record.id)};`),row=JSON.parse(raw);
  assert.equal(row.identity,identitySha);assert.equal(row.original,original.rowWire);assert.equal(row.originalSha,original.sha256);assert.equal(row.current,current.rowWire);assert.equal(row.currentSha,current.sha256);assert.equal(row.projectionMatches,true);assert.deepEqual(row.fields,current.unprojectedFields);tokensEmpty();vectors++;
 };
 const directRefusal=async(sql:string,args:readonly unknown[],write:boolean,kind:'admission'|'whitespace'|'raw')=>{
  await input.contentionClient.query(write?'BEGIN READ WRITE':'BEGIN READ ONLY');try{await assert.rejects(input.contentionClient.query(sql,[canonicalJson(identity),input.digest,...args]),(error:unknown)=>{
   const e=error as {code?:string;message?:string};if(e.code!=='P0001')return false;
   if(kind==='whitespace')return e.message==='native payment receipt whitespace outside qualified financial scope';
   if(kind==='raw')return e.message==='native payment raw observation unavailable to legacy observer';
   return typeof e.message==='string'&&!e.message.includes('payment raw')&&!e.message.includes('payment receipt whitespace');
  });}finally{await input.contentionClient.query('ROLLBACK');}tokensEmpty();vectors++;
 };
 const writeAdmissionRefusals=async(kind:'admission'|'whitespace'|'raw')=>{
  // No genuine signed withdrawal original is supplied. These real fixed SQL
  // entrypoints must refuse admission; this is never a positive writer proof.
  await directRefusal('SELECT public.storage_reserve_session_withdrawal($1::jsonb,$2::text,$3::text)',[null],true,kind);
  await directRefusal('SELECT public.storage_creator_owner_admit($1::jsonb,$2::text,$3::text,$4::jsonb,$5::text)',[null,'null','0'],true,kind);
 };
 try{
  const gaps=fixture.addPresentationGaps();assert.equal(gaps.unprojectedFields.length,9);const snapshot=fixture.snapshot();
  const emptyTables=[...Object.keys(columns).filter(t=>t!=='browser_journal_control'),'payment_events','hosted_treasury_authorizations','session_withdrawal_preparations','creator_withdrawal_requests'];
  let intake=`DO $$ DECLARE n bigint;t text;BEGIN FOREACH t IN ARRAY ARRAY[${emptyTables.map(q).join(',')}] LOOP EXECUTE format('SELECT count(*) FROM public.%I',t) INTO n;IF n<>0 THEN RAISE EXCEPTION 'financial Source intake requires empty target';END IF;END LOOP;IF EXISTS(SELECT 1 FROM keryx_storage.payment_event_originals) OR(SELECT active FROM public.browser_journal_control WHERE id=1) IS DISTINCT FROM false THEN RAISE EXCEPTION 'financial Source intake refuses retained originals';END IF;END;$$;`;
  for(const table of Object.keys(columns) as Array<keyof typeof columns>){for(const row of snapshot.tables[table]){assert.deepEqual(Object.keys(row).sort(),[...columns[table]].sort());
   if(table==='browser_journal_control'){assert.deepEqual({...row},{id:1,active:1});intake+='UPDATE public.browser_journal_control SET active=true WHERE id=1;';}
   else intake+=`INSERT INTO public.${table}(${columns[table].join(',')}) VALUES(${columns[table].map(key=>cell(row[key])).join(',')});`;
  }}
  for(const packet of snapshot.payments){const id=String(packet.row.id);originals.set(id,packet);
   intake+=`INSERT INTO public.payment_events(${PAYMENT_EVENT_FIELDS.join(',')}) VALUES(${PAYMENT_EVENT_FIELDS.map(key=>key==='settled'?packet.projection[key]===1?'true':'false':cell(packet.projection[key])).join(',')});`;
   intake+=`INSERT INTO keryx_storage.payment_event_originals(payment_id,identity_digest,original_wire,original_sha256,current_wire,current_sha256,native_projection,unprojected_fields) SELECT p.id,${q(identitySha)},${q(packet.rowWire)}::json,${q(packet.sha256)},${q(packet.rowWire)}::json,${q(packet.sha256)},to_jsonb(p),ARRAY[${packet.unprojectedFields.map(q).join(',')}]::text[] FROM public.payment_events p WHERE p.id=${q(id)};`;
  }
  assert(Buffer.byteLength(intake)<262144);held(intake);
  // Exact Source scalar/private serialized cells, not JSON normalization.
  for(const table of Object.keys(columns) as Array<keyof typeof columns>){const actual=JSON.parse(input.ownerSql(`SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb)::text FROM public.${table} t;`)) as Array<Record<string,unknown>>,expected=snapshot.tables[table].map(row=>({...row}));if(table==='browser_journal_control')for(const row of actual)row.active=row.active?1:0;
   const sorted=(rows:Record<string,unknown>[])=>rows.map(canonicalJson).sort();assert.deepEqual(sorted(actual),sorted(expected));vectors++;
  }
  for(const key of Object.keys(fixture.cases) as PaymentConsumedFixtureCase[])exactPayment(key);
  assert.deepEqual(await nativeRead(),fixture.read());vectors++;await writeAdmissionRefusals('admission');
  // Protected rows cannot be made foreign/stale/missing through a bypass.
  const id=fixture.cases.padded.id;
  for(const sql of [`UPDATE keryx_storage.payment_event_originals SET identity_digest=repeat('0',64) WHERE payment_id=${q(id)};`,`UPDATE keryx_storage.payment_event_originals SET current_sha256=repeat('0',64) WHERE payment_id=${q(id)};`,`UPDATE keryx_storage.payment_event_originals SET unprojected_fields=unprojected_fields||ARRAY['future_field'] WHERE payment_id=${q(id)};`,`DELETE FROM keryx_storage.payment_event_originals WHERE payment_id=${q(id)};`,`UPDATE public.payment_events SET source_name='synthetic-stale' WHERE id=${q(id)};`,`INSERT INTO public.payment_events(id,created_at,kind,query_id,source_id,source_name,payer,payee,amount_usdc,network,settled,settlement_status) VALUES(${q(fixture.prefix+'-missing-original')},'2026-11-15T00:00:00.000Z','fetch','synthetic-missing','synthetic','Synthetic',${q(fixture.cases.padded.signer)},${q(fixture.cases.padded.payee)},0.000001,${q(identity.network)},false,'pending');`]){assert.throws(()=>held(sql));vectors++;}
  foreign=createPostgresDomainChannel(input.options,{...identity,deploymentId:randomUUID()},input.digest);await assert.rejects(composePostgresOwnerWithdrawalTransport(foreign,identity).sessionFundingAccounting(fixture.cases.padded.signer));vectors++;
  fixture.expose('padded');assert.equal(await browser.exposeBrowserJournal(fixture.cases.padded.session,fixture.cases.padded.request),true);exactPayment('padded');fixture.settlePadded();assert.equal(await payments.settlePendingPayment(fixture.cases.padded.id,fixture.cases.padded.nonce,PAYMENT_CONSUMED_FIXTURE_RECEIPTS.padded),true);exactPayment('padded');assert.deepEqual(await nativeRead(),fixture.read());assert.equal((await nativeRead()).confirmed,1);vectors++;
  // Inspect the actual pinned installed guard and execute its exact closed
  // whitespace predicate in PG, without overwriting any retained receipt.
  const definition=Buffer.from(input.ownerSql("SELECT encode(convert_to(pg_get_functiondef('keryx_storage.require_operation(jsonb,text,text)'::regprocedure),'UTF8'),'hex');"),'hex').toString('utf8');
  const cases=[...definition.matchAll(/WHEN '([a-z0-9_]+)' THEN r\.unprojected_fields && ARRAY\[([^\]]+)\]::text\[\]/g)];assert.deepEqual(cases.map(m=>m[1]).sort(),Object.keys(LEGACY_PAYMENT_CONSUMED_FIELDS).sort());for(const item of cases)assert.deepEqual([...item[2].matchAll(/'([a-z0-9_]+)'/g)].map(m=>m[1]),LEGACY_PAYMENT_CONSUMED_FIELDS[item[1] as keyof typeof LEGACY_PAYMENT_CONSUMED_FIELDS]);
  const known=definition.match(/r\.unprojected_fields <@ ARRAY\[([^\]]+)\]::text\[\]/);assert(known);assert.deepEqual([...known[1].matchAll(/'([a-z0-9_]+)'/g)].map(m=>m[1]),KNOWN_PAYMENT_UNPROJECTED_FIELDS);assert(definition.includes('IS NOT TRUE'));assert(definition.includes('ELSE true END'));assert(definition.includes('r.native_projection IS DISTINCT FROM to_jsonb(p)'));
  const field=cases[0][2],actualFields=JSON.parse(input.ownerSql(`SELECT jsonb_build_object('unknown',(ARRAY['future_field']::text[] <@ ARRAY[${known[1]}]::text[]) IS NOT TRUE,'null',(ARRAY[NULL]::text[] <@ ARRAY[${known[1]}]::text[]) IS NOT TRUE,'unsupportedNumeric',(ARRAY['amount_usdc']::text[] <@ ARRAY[${known[1]}]::text[]) IS NOT TRUE,'receipt',ARRAY['tx_hash']::text[] && ARRAY[${field}]::text[],'metadata',ARRAY['source_name','created_at']::text[] && ARRAY[${field}]::text[])::text;`));assert.deepEqual(actualFields,{unknown:true,null:true,unsupportedNumeric:true,receipt:true,metadata:false});vectors++;
  const trim=definition.match(/btrim\(p\.tx_hash,(U&'([^']+)')\)/);assert(trim);const codepoints=[...trim[2].matchAll(/\\([0-9A-F]{4})/g)].map(m=>Number.parseInt(m[1],16)),sourceWhitespace:number[]=[];for(let n=0;n<=0x10ffff;n++)if(String.fromCodePoint(n).trim()==='')sourceWhitespace.push(n);assert.deepEqual(codepoints,sourceWhitespace);assert.equal(codepoints.length,25);
  const values=[...sourceWhitespace.map(n=>String.fromCodePoint(n)),' \ufeffordinary-receipt\t ','\u0085','\u200b'];const actualPredicate=JSON.parse(input.ownerSql(`SELECT jsonb_agg(btrim(v)<>'' AND btrim(v,${trim[1]})='' ORDER BY i)::text FROM(VALUES ${values.map((v,i)=>`(${i},${q(v)})`).join(',')}) t(i,v);`));assert.deepEqual(actualPredicate,values.map(value=>value.trim()===''&&value.replace(/^ +| +$/g,'')!==''));vectors++;
  // First real bad receipt is representable BOM: no tx_hash projection flag.
  fixture.expose('whitespace');assert.equal(await browser.exposeBrowserJournal(fixture.cases.whitespace.session,fixture.cases.whitespace.request),true);fixture.settleWhitespace();assert.equal(await payments.settlePendingPayment(fixture.cases.whitespace.id,fixture.cases.whitespace.nonce,PAYMENT_CONSUMED_FIXTURE_RECEIPTS.whitespace),true);exactPayment('whitespace');assert(!fixture.payment('whitespace').unprojectedFields.includes('tx_hash'));fixture.assertRefused('whitespace');await readRefuses('whitespace');
  await directRefusal('SELECT public.storage_session_funding_accounting($1::jsonb,$2::text,$3::text,$4::text)',[fixture.cases.whitespace.signer,null],false,'whitespace');await writeAdmissionRefusals('whitespace');
  // A separate genuine NUL row then exercises the earlier raw-field hold,
  // with a distinct fixed server error; no Original/current overwrite/reset.
  fixture.expose('nul');assert.equal(await browser.exposeBrowserJournal(fixture.cases.nul.session,fixture.cases.nul.request),true);fixture.settleNul();assert.equal(await payments.settlePendingPayment(fixture.cases.nul.id,fixture.cases.nul.nonce,PAYMENT_CONSUMED_FIXTURE_RECEIPTS.nul),true);exactPayment('nul');assert.equal(fixture.read('nul').confirmed,1);assert(fixture.payment('nul').unprojectedFields.includes('tx_hash'));await readRefuses('nul');
  await directRefusal('SELECT public.storage_session_funding_accounting($1::jsonb,$2::text,$3::text,$4::text)',[fixture.cases.nul.signer,null],false,'raw');await writeAdmissionRefusals('raw');
  for(const key of Object.keys(fixture.cases) as PaymentConsumedFixtureCase[])exactPayment(key);tokensEmpty();
  return {vectors,sourcePayments:3,genuineFreshSource:true,exactSourcePrivateCells:true,immutableFirstOriginalAndCurrentSha:true,unrelatedNineGapsIgnored:true,fourFinancialObservationsQualified:true,coreConfirmedAliasCompositionQualified:true,installedNativeFactoryQualified:false,sourcePaddedReceiptPositive:true,actualWhitespaceFirstRefusal:true,actualNulRawHoldAfterWhitespace:true,installedExact25WhitespacePredicateQualified:true,eachWhitespaceClassTraversedWholeFinancialPath:false,unknownFlagAndForeignMissingStaleTamperRefused:true,twoWriteAdmissionGuardsQualified:true,positiveWithdrawalWritesQualified:false,genuineSignedWithdrawalOriginalsProvided:false,noOriginalOverwriteOrBackfill:true,finalWriterTokensEmpty:true,newSumEquivalenceClaim:false,fullWriterQualified:false,fundingActions:0,providerActions:0,realSignatures:0};
 }finally{await foreign?.close();await channel.close();fixture.close();}
}
