import { createHash } from "node:crypto";
import { createPublicClient, keccak256,toBytes,decodeFunctionData,parseTransaction,encodeFunctionData,recoverTransactionAddress,recoverTypedDataAddress,type Hex,type TransactionSerializableEIP1559 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config";
import { chainForProfile } from "../chains";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { attestedArcAuthorityHttp } from "../arc-rpc-attestation";
import { getDb } from "../db";
import { applicationSqliteIdentity } from "../db/application-storage";
import { readRuntimeStorageDeployment } from "../db/runtime-storage-config";
import type { StorageIdentity } from "../db/storage-identity";
import type { KeryxDB } from "../db/keryx-db";
import { canonicalJson } from "../canonical-json";
import { REGISTRATION_SPONSOR_ABI,registrationParamsSchema,registrationSponsorFundingObservationSchema,registrationTypedData,registrationPolicyDigest,registrationIntentDigest,registrationContractRequest,registrationPolicyExpired, activeRegistrationSponsorPolicySchema, type ActiveRegistrationSponsorPolicy,type RegistrationSponsorFundingObservation,type SponsoredRegistration } from "./registration-sponsor-protocol";
import type { RegistrationSponsorChain, RegistrationSponsorContext } from "./registration-sponsor-context";
import { getServerRegistryVersion } from "../registry/registry-version";
import { configuredRegistrationRegistryAuthority } from "../registry/source-registry-authority";

type SponsorPurpose='read'|'new-exposure';
type OriginalIdentity=Pick<SponsoredRegistration,'chainId'|'registryAddress'|'registryCodeHash'|'relayer'>;
interface SponsorBinding {db:KeryxDB;policy:ActiveRegistrationSponsorPolicy;purpose:SponsorPurpose;manifest:string;identity:Readonly<StorageIdentity>;native:boolean;assertPolicy?:()=>void;original?:{wallet:string;id:string};}
interface SponsorObservation {binding:SponsorBinding;observation:Readonly<RegistrationSponsorFundingObservation>;dtoDigest:string;policyDigest:string;cohortDigest:string;manifestDigest:string;}
declare const sponsorObservationCapture:unique symbol;
export interface RegistrationSponsorObservationCapture {readonly [sponsorObservationCapture]:true;}
const issuedObservations=new WeakMap<object,SponsorObservation>(),capturedObservations=new WeakMap<object,SponsorObservation>();
const sha=(wire:string)=>createHash('sha256').update(wire).digest('hex');
function unavailableObservation():never{throw new Error('Qualified registration sponsor funding observation unavailable');}
function bindingLocal(binding:SponsorBinding){
 if(canonicalJson(readRuntimeStorageDeployment())!==binding.manifest)unavailableObservation();
 binding.assertPolicy?.();
 const policy=binding.policy;if(policy.network!==config.networkId||binding.purpose==='new-exposure'&&policy.deploymentOrigin!==new URL(config.baseUrl).origin)unavailableObservation();
 if(binding.purpose==='new-exposure'&&registrationPolicyExpired(policy,Date.now()))unavailableObservation();
}
async function assertBinding(binding:SponsorBinding){
 bindingLocal(binding);const deployment=readRuntimeStorageDeployment();let identity:Readonly<StorageIdentity>;
 if(deployment.backend.kind==='postgres'){const {assertPostgresRuntimeIdentity}=await import('../db/postgres/runtime-adapter');bindingLocal(binding);identity=await assertPostgresRuntimeIdentity(binding.db,binding.purpose==='new-exposure'?'write':'read');}
 else if(deployment.backend.kind==='sqlite')identity=applicationSqliteIdentity(binding.db,binding.purpose==='new-exposure'?'write':'read');else unavailableObservation();
 bindingLocal(binding);if(canonicalJson(identity)!==canonicalJson(binding.identity)||canonicalJson(identity)!==canonicalJson(deployment.identity)||identity.network!==binding.policy.network)unavailableObservation();
 if(binding.original){const original=await binding.db.getRegistrationSponsor?.(binding.original);bindingLocal(binding);if(!original||original.policyDigest!==registrationPolicyDigest(binding.policy)||original.registryAddress!==binding.policy.registryAddress||original.registryCodeHash!==binding.policy.registryCodeHash||original.relayer!==binding.policy.sponsorAddress||`eip155:${original.chainId}`!==binding.policy.network)unavailableObservation();}
}
async function createBinding(db:KeryxDB,policy:ActiveRegistrationSponsorPolicy,purpose:SponsorPurpose,assertPolicy?:()=>void,original?:{wallet:string;id:string}):Promise<SponsorBinding>{
 const deployment=readRuntimeStorageDeployment(),binding:SponsorBinding={db,policy:activeRegistrationSponsorPolicySchema.parse(policy),purpose,manifest:canonicalJson(deployment),identity:deployment.identity,native:deployment.backend.kind==='postgres',...(assertPolicy?{assertPolicy}:{}),...(original?{original}:{})};await assertBinding(binding);return binding;
}
function observationLocal(record:SponsorObservation){
 bindingLocal(record.binding);if(sha(canonicalJson(record.observation))!==record.dtoDigest||registrationPolicyDigest(record.binding.policy)!==record.policyDigest)unavailableObservation();
 const now=Date.now(),o=record.observation;if(o.observedAt>now||now-o.observedAt>5000||o.blockTimestamp*1000>now+5000||o.blockTimestamp*1000<now-60000)unavailableObservation();
}
/** Validate the original RPC result reference BEFORE any cloning or await.
 * Copies, policy rows and arbitrary callbacks never acquire this provenance. */
export function captureRegistrationSponsorObservation(value:unknown,db:KeryxDB,purpose:SponsorPurpose,policy?:ActiveRegistrationSponsorPolicy):RegistrationSponsorObservationCapture{
 if(arguments.length<3||arguments.length>4||!['read','new-exposure'].includes(purpose))unavailableObservation();const record=value&&typeof value==='object'?issuedObservations.get(value):undefined;if(!record||record.binding.db!==db||policy!==undefined&&record.policyDigest!==registrationPolicyDigest(policy)||purpose==='new-exposure'&&record.binding.purpose!=='new-exposure')unavailableObservation();observationLocal(record);
 const token=Object.freeze({}) as RegistrationSponsorObservationCapture;capturedObservations.set(token,record);return token;
}
/** Revalidate genuine facade identity, the full manifest and custody/policy after
 * awaits. Returned values are private audit metadata, not a reusable proof DTO. */
export async function validateRegistrationSponsorObservation(token:RegistrationSponsorObservationCapture,db:KeryxDB,policy:ActiveRegistrationSponsorPolicy,purpose:SponsorPurpose){
 if(arguments.length!==4||!['read','new-exposure'].includes(purpose))unavailableObservation();const record=token&&typeof token==='object'?capturedObservations.get(token):undefined;if(!record||record.binding.db!==db||record.policyDigest!==registrationPolicyDigest(policy)||purpose==='new-exposure'&&record.binding.purpose!=='new-exposure')unavailableObservation();observationLocal(record);await assertBinding(record.binding);observationLocal(record);
 return Object.freeze({observation:record.observation,dtoDigest:record.dtoDigest,identity:Object.freeze({...record.binding.identity}),manifestDigest:record.manifestDigest,policyDigest:record.policyDigest,cohortDigest:record.cohortDigest,purpose:record.binding.purpose,role:record.binding.purpose==='new-exposure'?'registration-sponsor-write' as const:'registration-sponsor-read' as const});
}
function finalExecutionLocal(binding:SponsorBinding,row:SponsoredRegistration,observation?:RegistrationSponsorFundingObservation){
 bindingLocal(binding);const at=Date.now();if(row.expiredResolution?at<=row.deadline*1000:at>row.deadline*1000)unavailableObservation();
 if(binding.policy.protocol==='keryx-registration-sponsor-v2'){if(!observation)unavailableObservation();const record=issuedObservations.get(observation);if(!record||record.binding!==binding||record.binding.purpose!=='new-exposure')unavailableObservation();observationLocal(record);}
}
async function nativeExecutionGate(binding:SponsorBinding,transaction:TransactionSerializableEIP1559,phase:'sign'|'broadcast',observation?:RegistrationSponsorFundingObservation,raw?:Hex){
 await assertBinding(binding);const decoded=decodeFunctionData({abi:REGISTRATION_SPONSOR_ABI,data:transaction.data!});if(decoded.functionName!=='registerWithSignature')unavailableObservation();const request=decoded.args[0],params=registrationParamsSchema.parse({urlHash:request.urlHash,payoutWallet:request.payoutWallet,authors:request.authors,fetchPriceUsdc6:String(request.fetchPriceUsdc6),contentCid:request.contentCid,tags:request.tags});
 // Only these exact ABI/EIP-712 fields participate in the intent digest. The
 // complete stored original is fetched and validated independently below.
 const intent=registrationIntentDigest({chainId:transaction.chainId,registryAddress:binding.policy.registryAddress,creator:request.creator,relayer:request.relayer,params:{...params,fetchPriceUsdc6:String(request.fetchPriceUsdc6)},nonce:String(request.nonce),deadline:Number(request.deadline)} as SponsoredRegistration);
 const row=await binding.db.getRegistrationSponsor?.({wallet:request.creator,id:intent});bindingLocal(binding);
 if(!row||row.state!==(phase==='sign'?'signing':'submitted')||row.policyDigest!==registrationPolicyDigest(binding.policy)||row.relayer!==binding.policy.sponsorAddress||transaction.nonce!==row.transactionNonce||transaction.chainId!==row.chainId||transaction.to?.toLowerCase()!==row.registryAddress||row.registryCodeHash!==binding.policy.registryCodeHash)unavailableObservation();
 const execution=await binding.db.getRegistrationSponsorExecution?.({wallet:row.creator,id:row.id});bindingLocal(binding);
 if(!execution||encodeFunctionData({abi:REGISTRATION_SPONSOR_ABI,functionName:'registerWithSignature',args:[registrationContractRequest(row),execution.creatorSignature]}).toLowerCase()!==transaction.data?.toLowerCase()||phase==='broadcast'&&(!raw||execution.signedTransaction!==raw||row.transactionHash!==keccak256(raw)))unavailableObservation();
 if((await recoverTypedDataAddress({...registrationTypedData(row),signature:execution.creatorSignature})).toLowerCase()!==row.creator)unavailableObservation();bindingLocal(binding);
 const token=binding.policy.protocol==='keryx-registration-sponsor-v2'&&observation?captureRegistrationSponsorObservation(observation,binding.db,'new-exposure',binding.policy):undefined;
 if(binding.policy.protocol==='keryx-registration-sponsor-v2'&&!token)unavailableObservation();if(token)await validateRegistrationSponsorObservation(token,binding.db,binding.policy,'new-exposure');
 const current=await binding.db.transitionRegistrationSponsor?.({wallet:row.creator,id:row.id,expectedState:row.state,nextState:row.state,transactionNonce:row.transactionNonce,...(row.transactionHash?{transactionHash:row.transactionHash}:{}),...(row.expiredResolution?{expiredResolution:true}:{}),...(observation?{fundingObservation:observation}:{}),now:Date.now()});
 if(!current)unavailableObservation();await assertBinding(binding);if(token)await validateRegistrationSponsorObservation(token,binding.db,binding.policy,'new-exposure');finalExecutionLocal(binding,current,observation);return current;
}

/** No key generation, treasury fallback, wallet enrollment or implicit funding. */
export async function registrationSponsorRuntime(): Promise<RegistrationSponsorContext<ActiveRegistrationSponsorPolicy> | null> {
  const text = process.env.KERYX_REGISTRATION_SPONSOR_POLICY;
  if (!text) return null;
  try {
    if (text.length > 64_000 || process.env.KERYX_FORCE_OFFLINE === "1" || getServerRegistryVersion() !== 3) throw new Error();
    const policy = activeRegistrationSponsorPolicySchema.parse(JSON.parse(text));
    if (policy.network !== config.networkId || policy.deploymentOrigin !== new URL(config.baseUrl).origin ||
      policy.registryAddress !== config.registryAddress?.toLowerCase() || policy.registryAddress !== config.registryReadAddress?.toLowerCase()) throw new Error();
    const origin = configuredRegistrationRegistryAuthority();
    if (origin && (origin.network !== policy.network || origin.address !== policy.registryAddress ||
      origin.version !== 3 || origin.codeHash !== policy.registryCodeHash)) throw new Error();
    const key = process.env.KERYX_REGISTRATION_SPONSOR_PRIVATE_KEY;
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error();
    const account = privateKeyToAccount(key as Hex);
    if (account.address.toLowerCase() !== policy.sponsorAddress) throw new Error();
    const policyWire=canonicalJson(policy),originSelection=canonicalJson(configuredRegistrationRegistryAuthority()??null),configuration=canonicalJson({network:config.networkId,origin:new URL(config.baseUrl).origin,registry:config.registryAddress,readRegistry:config.registryReadAddress,rpc:config.rpcUrl});
    const assertPolicy = () => {
      if (process.env.KERYX_REGISTRATION_SPONSOR_POLICY !== text || process.env.KERYX_REGISTRATION_SPONSOR_PRIVATE_KEY !== key || process.env.KERYX_FORCE_OFFLINE==='1'||getServerRegistryVersion()!==3||canonicalJson(configuredRegistrationRegistryAuthority()??null)!==originSelection||canonicalJson(policy)!==policyWire||canonicalJson({network:config.networkId,origin:new URL(config.baseUrl).origin,registry:config.registryAddress,readRegistry:config.registryReadAddress,rpc:config.rpcUrl})!==configuration||registrationPolicyExpired(policy, Date.now())) throw new Error("Registration sponsor policy unavailable");
    };
    assertPolicy();
    const db = await getDb();
    if (!db.admitRegistrationSponsor || !db.getRegistrationSponsor || !db.transitionRegistrationSponsor || !db.getRegistrationSponsorExecution) throw new Error();
    if (policy.protocol === "keryx-registration-sponsor-v2" && !db.inspectRegistrationSponsorFunding) throw new Error();
    const binding=await createBinding(db,policy,'new-exposure',assertPolicy),chain=readChain({chainId:policy.network==='eip155:5042'?5042:5042002,registryAddress:policy.registryAddress,registryCodeHash:policy.registryCodeHash,relayer:policy.sponsorAddress},binding),client=sponsorClient(policy.network==='eip155:5042'?5042:5042002);let lastObservation:RegistrationSponsorFundingObservation|undefined;
    return { db, policy, assertPolicy, chain: { ...chain,
      async fundingObservation(){const value=await chain.fundingObservation!();assertPolicy();const token=captureRegistrationSponsorObservation(value,db,'new-exposure',policy);await validateRegistrationSponsorObservation(token,db,policy,'new-exposure');lastObservation=value;return value;},
      async sign(transaction) {
        assertPolicy();
        if (transaction.chainId !== chainForProfile(policy.network === "eip155:5042" ? ARC_MAINNET_PROFILE : ARC_TESTNET_PROFILE).id ||
          transaction.to?.toLowerCase() !== policy.registryAddress || transaction.value !== BigInt(0) ||
          transaction.gas !== BigInt(policy.maxGas) || transaction.maxFeePerGas !== BigInt(policy.maxFeePerGasWei) ||
          transaction.maxPriorityFeePerGas !== BigInt(1) || transaction.type !== "eip1559") throw new Error();
        const original=binding.native?await nativeExecutionGate(binding,transaction,'sign',lastObservation):undefined;await assertBinding(binding);assertPolicy();if(original)finalExecutionLocal(binding,original,lastObservation);
        const raw=await account.signTransaction(transaction);await assertBinding(binding);assertPolicy();if(original)finalExecutionLocal(binding,original,lastObservation);return raw;
      },
      async broadcast(raw) { assertPolicy();let original:SponsoredRegistration|undefined;if(binding.native){const transaction=parseTransaction(raw);if(transaction.type!=='eip1559'||(await recoverTransactionAddress({serializedTransaction:raw as Parameters<typeof recoverTransactionAddress>[0]['serializedTransaction']})).toLowerCase()!==policy.sponsorAddress||transaction.value!==undefined&&transaction.value!==BigInt('0')||transaction.gas!==BigInt(policy.maxGas)||transaction.maxFeePerGas!==BigInt(policy.maxFeePerGasWei)||transaction.maxPriorityFeePerGas!==BigInt('1')||transaction.accessList?.length)unavailableObservation();original=await nativeExecutionGate(binding,transaction as TransactionSerializableEIP1559,'broadcast',lastObservation,raw);}await assertBinding(binding);assertPolicy();if(original)finalExecutionLocal(binding,original,lastObservation);const returned=await client.sendRawTransaction({ serializedTransaction: raw });await assertBinding(binding);assertPolicy();return returned; },
    } };
  } catch { throw new Error("Registration sponsorship configuration is unavailable"); }
}
/** Original receipt recovery needs no private key or active sponsor allowance. */
export function registrationSponsorReadChain(row:OriginalIdentity,selected?:{db:KeryxDB;policy:ActiveRegistrationSponsorPolicy;original:{wallet:string;id:string}}):RegistrationSponsorChain{return readChain(row,undefined,selected);}
function readChain(row:OriginalIdentity,qualified?:SponsorBinding,selected?:{db:KeryxDB;policy:ActiveRegistrationSponsorPolicy;original:{wallet:string;id:string}}):RegistrationSponsorChain {
  const client = sponsorClient(row.chainId);
  return {
    async fundingObservation() {
      const binding=qualified??(selected?await createBinding(selected.db,selected.policy,'read',undefined,{...selected.original}):undefined);
      if(binding&&(row.relayer!==binding.policy.sponsorAddress||row.registryAddress!==binding.policy.registryAddress||row.registryCodeHash!==binding.policy.registryCodeHash||`eip155:${row.chainId}`!==binding.policy.network))unavailableObservation();if(binding)await assertBinding(binding);
      const block = await client.getBlock({ blockTag: "latest" }), now = Date.now();
      if(binding)await assertBinding(binding);
      if (!block.hash || block.number === null || block.timestamp > BigInt(Math.floor(now / 1000) + 5) ||
          block.timestamp < BigInt(Math.floor(now / 1000) - 60)) throw new Error("Fresh sponsor funds are unavailable");
      const [nativeBalanceWei, latestTransactionNonce] = await Promise.all([
        client.getBalance({ address: row.relayer, blockNumber: block.number }),
        client.getTransactionCount({ address: row.relayer, blockNumber: block.number }),
      ]);
      if(binding)await assertBinding(binding);
      const confirmed = await client.getBlock({ blockNumber: block.number }), observedAt = Date.now();
      if(binding)await assertBinding(binding);
      if (confirmed.hash !== block.hash || confirmed.number !== block.number || confirmed.timestamp !== block.timestamp ||
          block.timestamp > BigInt(Math.floor(observedAt / 1000) + 5) || block.timestamp < BigInt(Math.floor(observedAt / 1000) - 60))
        throw new Error("Consistent sponsor funds are unavailable");
      const observation=registrationSponsorFundingObservationSchema.parse({ network: row.chainId === 5042 ? "eip155:5042" as const : "eip155:5042002" as const,
        sponsorAddress: row.relayer, blockNumber: block.number.toString(), blockHash: block.hash,
        blockTimestamp: Number(block.timestamp), observedAt, nativeBalanceWei: nativeBalanceWei.toString(), latestTransactionNonce });
      if(binding){const record:SponsorObservation={binding,observation:Object.freeze(observation),dtoDigest:sha(canonicalJson(observation)),policyDigest:registrationPolicyDigest(binding.policy),cohortDigest:keccak256(toBytes(canonicalJson({network:binding.policy.network,deploymentOrigin:binding.policy.deploymentOrigin,registryAddress:binding.policy.registryAddress,sponsorAddress:binding.policy.sponsorAddress,...(binding.policy.protocol==='keryx-registration-sponsor-v2'?{protocol:binding.policy.protocol}:{})}))),manifestDigest:sha(binding.manifest)};observationLocal(record);issuedObservations.set(observation,record);}return observation;
    },
    async hasExpiredDeadline(deadline) {
      const block = await client.getBlock({ blockTag: "latest" });
      const now = BigInt(Math.floor(Date.now() / 1000));
      if (!Number.isSafeInteger(deadline) || !block.hash || block.number === null || block.timestamp > now + BigInt(5) || block.timestamp < now - BigInt(60))
        throw new Error("Fresh original expiry observation is unavailable");
      return block.timestamp > BigInt(deadline);
    },
    async assertRegistry() {
      const code = await client.getCode({ address: row.registryAddress });
      if (!code || code === "0x" || keccak256(code) !== row.registryCodeHash ||
        await client.readContract({ address: row.registryAddress, abi: REGISTRATION_SPONSOR_ABI, functionName: "registryVersion" }) !== 3) throw new Error("Reviewed sponsored registry is unavailable");
    },
    async registrationNonce(creator) { return client.readContract({ address: row.registryAddress, abi: REGISTRATION_SPONSOR_ABI, functionName: "registrationNonces", args: [creator] }); },
    async transactionNonce() {
      const pending = await client.getTransactionCount({ address: row.relayer, blockTag: "pending" });
      const latest = await client.getTransactionCount({ address: row.relayer, blockTag: "latest" });
      if (pending !== latest) throw new Error("The dedicated sponsor has another unresolved transaction");
      return pending;
    },
    async estimateGas(data) { return client.estimateGas({ account: row.relayer, to: row.registryAddress, data, value: BigInt(0) }); },
    async sign() { throw new Error("Original receipt reader cannot sign"); },
    async broadcast() { throw new Error("Original receipt reader cannot broadcast"); },
    async receipt(hash) {
      try { return await client.getTransactionReceipt({ hash }); }
      catch (error) { if ((error as { name?: string }).name === "TransactionReceiptNotFoundError") return null; throw new Error("Original registration receipt unavailable"); }
    },
  };
}
function sponsorClient(chainId: 5042 | 5042002) {
  const profile = chainId === 5042 ? ARC_MAINNET_PROFILE : ARC_TESTNET_PROFILE;
  if (profile.networkId !== config.networkId) throw new Error("Original registration belongs to another network");
  return createPublicClient({ chain: chainForProfile(profile), transport: attestedArcAuthorityHttp(config.rpcUrl, { timeout: 4000, retryCount: 0 }, profile) });
}
