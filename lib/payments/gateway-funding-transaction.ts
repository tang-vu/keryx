import { encodeFunctionData, erc20Abi, keccak256, parseTransaction, recoverTransactionAddress,
  serializeTransaction, type Hex, type TransactionSerializableEIP1559 } from "viem";
import { canonicalJson } from "../canonical-json";
import { gatewayFundingReplayDigest, validateGatewayFundingOperation } from "./gateway-funding-policy";

export type FundingTransactionStep = "nativeTransfer" | "usdcTransfer" | "approval" | "deposit";
export interface GatewayFundingTransaction {
  readonly format:"gateway-funding-transaction-v1";
  readonly operationDigest:string; readonly step:FundingTransactionStep;
  readonly chainId:"5042002"; readonly sender:Hex; readonly nonce:string;
  readonly to:Hex; readonly data:Hex; readonly valueWei:string; readonly gas:string;
  readonly maxFeePerGasWei:string; readonly maxPriorityFeePerGasWei:string;
  readonly worstCaseGasWei:string; readonly serializedUnsigned:Hex;
}
export interface SignedGatewayFundingTransaction {
  readonly format:"gateway-funding-signed-transaction-v1";
  readonly transaction:Readonly<GatewayFundingTransaction>;
  readonly rawTransaction:Hex; readonly transactionHash:Hex;
}
const CHAIN=5042002, USDC="0x3600000000000000000000000000000000000000" as const;
const GATEWAY="0x0077777d7eba4688bdef3e311b846f25870a19b9" as const;
const DEPOSIT_ABI=[{name:"deposit",type:"function",stateMutability:"nonpayable",
  inputs:[{name:"token",type:"address"},{name:"value",type:"uint256"}],outputs:[]}] as const;
const SECP_ORDER=BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const STEPS=["nativeTransfer","usdcTransfer","approval","deposit"] as const;
const TRANSACTION_KEYS=["format","operationDigest","step","chainId","sender","nonce","to","data","valueWei",
  "gas","maxFeePerGasWei","maxPriorityFeePerGasWei","worstCaseGasWei","serializedUnsigned"];
function refuse():never { throw new Error("Gateway funding transaction refused"); }
function record(input:unknown,keys:readonly string[]):Record<string,unknown> {
  if(!input || typeof input !== "object" || Array.isArray(input) || ![Object.prototype,null].includes(Object.getPrototypeOf(input))
    || Object.getOwnPropertySymbols(input).length) refuse();
  const descriptors=Object.getOwnPropertyDescriptors(input),observed=Object.keys(descriptors).sort(),expected=[...keys].sort();
  if(observed.length !== expected.length || observed.some((key,i)=>key !== expected[i])
    || Object.values(descriptors).some(value=>!value.enumerable || !("value" in value))) refuse();
  return Object.fromEntries(Object.entries(descriptors).map(([key,value])=>[key,value.value]));
}
function nonceNumber(nonce:unknown):number {
  if(typeof nonce !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(nonce) || BigInt(nonce)>BigInt(Number.MAX_SAFE_INTEGER)) refuse();
  return Number(nonce);
}
function unsigned(transaction:Omit<GatewayFundingTransaction,"serializedUnsigned">):TransactionSerializableEIP1559 {
  return {type:"eip1559",chainId:CHAIN,nonce:nonceNumber(transaction.nonce),to:transaction.to,data:transaction.data,
    value:BigInt(transaction.valueWei),gas:BigInt(transaction.gas),maxFeePerGas:BigInt(transaction.maxFeePerGasWei),
    maxPriorityFeePerGas:BigInt(transaction.maxPriorityFeePerGasWei)};
}

/** Derives only four pinned transactions. The caller/ledger must separately
 * establish operation authorization, original nonce admission and lease rights. */
export function prepareGatewayFundingTransaction(input:unknown,step:FundingTransactionStep,originalNonce:string):Readonly<GatewayFundingTransaction> {
  try {
    const operation=validateGatewayFundingOperation(input);nonceNumber(originalNonce);
    if(!STEPS.includes(step)) refuse();
    const funder=operation.policy.funder as Hex,spend=operation.policy.spend as Hex;
    let sender:Hex=funder,to:Hex=spend,data:Hex="0x",valueWei="0";
    if(step === "nativeTransfer") { valueWei=operation.nativeTransferWei;if(valueWei === "0") refuse(); }
    else if(step === "usdcTransfer") {
      if(operation.usdcTransferMicros === "0") refuse();to=USDC;
      data=encodeFunctionData({abi:erc20Abi,functionName:"transfer",args:[spend,BigInt(operation.usdcTransferMicros)]});
    } else if(step === "approval") {
      sender=spend;to=USDC;data=encodeFunctionData({abi:erc20Abi,functionName:"approve",args:[GATEWAY,BigInt(operation.approvalMicros)]});
    } else {
      sender=spend;to=GATEWAY;data=encodeFunctionData({abi:DEPOSIT_ABI,functionName:"deposit",args:[USDC,BigInt(operation.depositMicros)]});
    }
    const gas=operation.gasLimits[step];
    const transaction:Omit<GatewayFundingTransaction,"serializedUnsigned">={format:"gateway-funding-transaction-v1",
      operationDigest:gatewayFundingReplayDigest(operation),step,chainId:"5042002",sender,nonce:originalNonce,to,data,valueWei,gas,
      maxFeePerGasWei:operation.maxFeePerGasWei,maxPriorityFeePerGasWei:operation.maxPriorityFeePerGasWei,
      worstCaseGasWei:(BigInt(gas)*BigInt(operation.maxFeePerGasWei)).toString()};
    return Object.freeze({...transaction,serializedUnsigned:serializeTransaction(unsigned(transaction))});
  } catch { return refuse(); }
}

/** Exact canonical DTO comparison, copied output. Not a nonce/lease permission. */
export function validatePreparedGatewayFundingTransaction(operation:unknown,step:FundingTransactionStep,nonce:string,input:unknown):Readonly<GatewayFundingTransaction> {
  try {
    const expected=prepareGatewayFundingTransaction(operation,step,nonce),observed=record(input,TRANSACTION_KEYS);
    // Bound primitives before canonical encoding; never stringify a nested
    // caller payload/accessor or accept aliases and numeric coercion.
    if(Object.values(observed).some(value=>typeof value !== "string" || value.length>2048)
      || canonicalJson(observed) !== canonicalJson(expected)) refuse();
    return expected;
  } catch { return refuse(); }
}

/** Actual type-2 bytes, exact original terms, canonical RLP, low-S/parity,
 * recovered sender and local hash. Pure evidence validation only: the trusted
 * controlled caller must still authorize and fence persistence/send. */
export async function validateSignedGatewayFundingTransaction(operation:unknown,step:FundingTransactionStep,nonce:string,
  input:unknown,assertCurrentAuthority:()=>void):Promise<Readonly<SignedGatewayFundingTransaction>> {
  try {
    if(typeof assertCurrentAuthority !== "function") refuse();if(assertCurrentAuthority() !== undefined) refuse();
    const expected=prepareGatewayFundingTransaction(operation,step,nonce),evidence=record(input,["rawTransaction","transactionHash"]);
    const raw=evidence.rawTransaction,hash=evidence.transactionHash;
    if(typeof raw !== "string" || raw.length>4098 || !/^0x02(?:[0-9a-f]{2})+$/.test(raw)
      || typeof hash !== "string" || !/^0x[0-9a-f]{64}$/.test(hash)) refuse();
    const parsed=parseTransaction(raw as Hex);
    if(parsed.type !== "eip1559" || parsed.accessList !== undefined || parsed.chainId !== CHAIN
      || parsed.nonce !== nonceNumber(nonce) || parsed.to !== expected.to || (parsed.data ?? "0x") !== expected.data
      || (parsed.value ?? BigInt(0)).toString() !== expected.valueWei || parsed.gas?.toString() !== expected.gas
      || parsed.maxFeePerGas?.toString() !== expected.maxFeePerGasWei
      || (parsed.maxPriorityFeePerGas ?? BigInt(0)).toString() !== expected.maxPriorityFeePerGasWei
      || !parsed.r || !parsed.s || ![0,1].includes(parsed.yParity ?? -1)
      || BigInt(parsed.r)<=BigInt(0) || BigInt(parsed.r)>=SECP_ORDER
      || BigInt(parsed.s)<=BigInt(0) || BigInt(parsed.s)>SECP_ORDER/BigInt(2)
      || serializeTransaction(parsed) !== raw || keccak256(raw as Hex) !== hash) refuse();
    const sender=await recoverTransactionAddress({serializedTransaction:raw as `0x02${string}`});
    if(assertCurrentAuthority() !== undefined) refuse();
    if(sender.toLowerCase() !== expected.sender) refuse();
    return Object.freeze({format:"gateway-funding-signed-transaction-v1",transaction:expected,rawTransaction:raw as Hex,transactionHash:hash as Hex});
  } catch { return refuse(); }
}
