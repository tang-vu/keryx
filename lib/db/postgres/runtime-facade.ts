/** Internal Source-surface composition only. This does not select a backend,
 * enroll a facade, issue provenance, or admit a complete application writer. */
import type { KeryxDB } from '../keryx-db';
import { refuseStorage } from '../storage-identity';
import { PostgresDomainWriteOutcomeUnknown } from './domain-channel';
import type { NativeFinancialObservation } from './financial-observation';
import { POSTGRES_RUNTIME_STORE_NAMES,guardPostgresRuntimeIterator,type NativePostgresRuntimeStores } from './runtime-stores';
import { POSTGRES_SOURCE_METHOD_ACCESS,POSTGRES_SOURCE_PROPERTIES,assertPostgresSourceMethodAccess,postgresSourcePropertyEnabled,type PostgresSourceMethod,type PostgresSourceSurface } from './runtime-surface';

type ObservationNames='getWebSession'|'getSyncStates'|'readPublicHealthSnapshot'|'a2aOperationsSnapshot'|
 'getQueryRun'|'listRecentQueries'|'listQueryRunsByAsker'|'listFollowUps'|'iterateRecentQueries';
export type PostgresRuntimeFacadeOverrides=Partial<Pick<KeryxDB,ObservationNames>&NativeFinancialObservation>;
const overrideNames=Object.freeze([
 'getWebSession','getSyncStates','readPublicHealthSnapshot','a2aOperationsSnapshot',
 'getQueryRun','listRecentQueries','listQueryRunsByAsker','listFollowUps','iterateRecentQueries',
 'hasA2aOriginalSettlement','listUnfinishedA2aOrders','getSessionGrantConsent','browserSignerRetainedSpendMicro','sessionFundingAccounting',
 'sessionWithdrawalAccounting','getSessionWithdrawal','pendingSessionWithdrawal','getSessionWithdrawalCompletion',
 'getSessionWithdrawalSigningPhase','getSessionWithdrawalAbort','listCreatorWithdrawalHistory','getCreatorWithdrawal',
 'getCreatorWithdrawalTransferClaim','getCreatorWithdrawalAttestation','creatorOwnerWithdrawalAccounting',
 'getCreatorOwnerWithdrawalCompletion','hostedTreasuryAccounting',
] as const satisfies readonly (keyof PostgresRuntimeFacadeOverrides)[]);
export interface PostgresRuntimeFacadeOptions {
 readonly core:KeryxDB;
 readonly surface:PostgresSourceSurface;
 /** The identical already-guarded objects supplied to Core. No store is rebuilt. */
 readonly stores:NativePostgresRuntimeStores;
 /** Existing internal factory closures, never caller-issued authority or proof. */
 readonly entry:()=>void;
 readonly guard:()=>Promise<void>;
 readonly close:()=>Promise<void>;
 /** Bound/standalone fixed observations only; no arbitrary method or SQL router. */
 readonly overrides?:PostgresRuntimeFacadeOverrides;
}
const refuse:()=>never=()=>refuseStorage('invalid_operation');
function record(value:unknown):asserts value is Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))
  ||Object.getOwnPropertySymbols(value).length||Object.values(Object.getOwnPropertyDescriptors(value)).some(d=>!d.enumerable||!('value'in d)))refuse();
}
/** The later zero-argument factory alone may register this plain internal object.
 * The supplied callbacks must be the same closures guarding Core and its stores. */
export function composePostgresRuntimeFacade(options:PostgresRuntimeFacadeOptions):KeryxDB {
 record(options);
 if(Object.keys(options).sort().join(',')!==(Object.hasOwn(options,'overrides')?'close,core,entry,guard,overrides,stores,surface':'close,core,entry,guard,stores,surface'))refuse();
 const {core,entry,guard,close:dispose}=options;
 if(!core||typeof core!=='object'||typeof entry!=='function'||typeof guard!=='function'||typeof dispose!=='function')refuse();
 record(options.surface);
 if(Object.keys(options.surface).sort().join(',')!=='claimsEnabled,mainnet,privacyActive,publicProfilesActive,readOnly'
  ||Object.values(options.surface).some(value=>typeof value!=='boolean'))refuse();
 const surface=Object.freeze({...options.surface});
 let closed=false,closing:Promise<void>|undefined;
 const current=()=>{
  if(closed)refuseStorage('adapter_not_initialized');
  const result:unknown=entry();
  if(result!==undefined){if(result instanceof Promise)void result.catch(()=>{});refuse();}
  if(closed)refuseStorage('adapter_not_initialized');
 };
 const fresh=async()=>{current();await guard();current();};
 current();
 const supplied:unknown=options.overrides??{};record(supplied);
 const overrides:Record<string,Function>=Object.create(null);
 for(const name of Object.keys(supplied)){
  const method=supplied[name];
  if(!(overrideNames as readonly string[]).includes(name)||typeof method!=='function')refuse();
  overrides[name]=method;
 }
 Object.freeze(overrides);
 record(options.stores);
 for(const name of Object.keys(options.stores))if(!(POSTGRES_RUNTIME_STORE_NAMES as readonly string[]).includes(name)
  ||!postgresSourcePropertyEnabled(name as typeof POSTGRES_RUNTIME_STORE_NAMES[number],surface))refuse();
 const stores:Record<string,unknown>=Object.create(null);
 for(const name of POSTGRES_RUNTIME_STORE_NAMES){
  if(!postgresSourcePropertyEnabled(name,surface))continue;
  const store=options.stores[name];
  if(!store||typeof store!=='object'||Reflect.get(core,name)!==store)refuse();
  stores[name]=store;
 }
 Object.freeze(stores);
 if(core.runPrivacyActive!==surface.privacyActive)refuse();
 const methods:Record<string,Readonly<{method:Function;receiver:unknown;write:boolean}>>=Object.create(null);
 for(const name of Object.keys(POSTGRES_SOURCE_METHOD_ACCESS) as PostgresSourceMethod[]){
  const overridden=Object.hasOwn(overrides,name),method:unknown=overridden?overrides[name]:Reflect.get(core,name);
  if(typeof method!=='function')refuse();
  const access=POSTGRES_SOURCE_METHOD_ACCESS[name];
  methods[name]=Object.freeze({method,receiver:overridden?undefined:core,write:access==='write'||access==='mainnet-write'});
 }
 Object.freeze(methods);
 const target:Record<PropertyKey,unknown>=Object.create(null);
 for(const name of Object.keys(methods) as PostgresSourceMethod[]){
  const selected=methods[name];
  const invoke=name==='iterateRecentQueries'?(...args:unknown[])=>{
   current();assertPostgresSourceMethodAccess(name,surface);
   // Invoke now so the selected typed port captures arguments before any await.
   const iterable=Reflect.apply(selected.method,selected.receiver,args) as AsyncIterable<unknown>;
   return guardPostgresRuntimeIterator(()=>iterable[Symbol.asyncIterator](),current,fresh);
  }:async(...args:unknown[])=>{
   current();assertPostgresSourceMethodAccess(name,surface);
   let value:unknown;
   try{value=await Reflect.apply(selected.method,selected.receiver,args);}
   catch(error){
    // Ports classify actual dispatch. A known pre-SQL rejection must never turn
    // into an unknown write merely because the subsequent context check fails.
    if(selected.write||error instanceof PostgresDomainWriteOutcomeUnknown){try{await fresh();}catch{}throw error;}
    await fresh();
    // This is Source's exact health-read error boundary under still-valid entry.
    if(name==='readPublicHealthSnapshot')return undefined;
    throw error;
   }
   try{await fresh();}catch(error){if(selected.write)throw new PostgresDomainWriteOutcomeUnknown();throw error;}
   return value;
  };
  Object.defineProperty(target,name,{value:invoke,enumerable:true});
 }
 Object.defineProperty(target,'init',{value:async()=>{await fresh();}});
 Object.defineProperty(target,'close',{value:()=>{
  if(!closing){closed=true;try{closing=Promise.resolve(dispose());}catch(error){closing=Promise.reject(error);}}
  return closing;
 }});
 Object.defineProperty(target,'runPrivacyActive',{value:surface.privacyActive});
 for(const [name,store] of Object.entries(stores))Object.defineProperty(target,name,{value:store});
 for(const name of Object.keys(POSTGRES_SOURCE_PROPERTIES) as (keyof typeof POSTGRES_SOURCE_PROPERTIES)[])
  if(postgresSourcePropertyEnabled(name,surface)&&!Object.hasOwn(target,name))refuse();
 Object.freeze(target);
 return new Proxy(target,{
  get(object,name){if(name==='then')return undefined;if(name!=='close')current();return Reflect.get(object,name);},
  ownKeys(object){current();return Reflect.ownKeys(object);},
  getOwnPropertyDescriptor(object,name){if(name!=='close')current();return Reflect.getOwnPropertyDescriptor(object,name);},
  getPrototypeOf(){current();return null;},
 }) as unknown as KeryxDB;
}
