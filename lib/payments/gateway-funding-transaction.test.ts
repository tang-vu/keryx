import { describe,expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";
import { encodeFunctionData,erc20Abi,keccak256,parseTransaction,serializeTransaction,toRlp,type Hex,type TransactionSerializableEIP1559 } from "viem";
import { generatePrivateKey,privateKeyToAccount } from "viem/accounts";
import { syntheticStorageIdentity } from "../db/storage-identity-fixture";
import { prepareGatewayFundingTransaction,validatePreparedGatewayFundingTransaction,validateSignedGatewayFundingTransaction,
  type FundingTransactionStep } from "./gateway-funding-transaction";

function fixture() {
  const funder=privateKeyToAccount(generatePrivateKey()),spend=privateKeyToAccount(generatePrivateKey());
  const operation={format:"gateway-funding-operation-v1",policy:{format:"gateway-funding-policy-v1",
    identity:syntheticStorageIdentity("testnet-real"),policyId:randomUUID(),funder:funder.address.toLowerCase(),spend:spend.address.toLowerCase(),
    lifetimeLimits:{nativeWei:"500",usdcMicros:"1000",depositMicros:"1000",gasWei:"10000000"},maxTransactionGas:"120000",maxFeePerGasWei:"20"},
    operationId:randomUUID(),ownerAuthorizationId:randomUUID(),ownerAuthorizationDigest:"b".repeat(64),
    minimumAvailableMicros:"100",initialAvailableMicros:"0",nativeTransferWei:"50",usdcTransferMicros:"100",approvalMicros:"100",depositMicros:"100",
    gasLimits:{nativeTransfer:"21000",usdcTransfer:"60000",approval:"60000",deposit:"120000"},maxFeePerGasWei:"10",maxPriorityFeePerGasWei:"1"};
  return {operation,funder,spend};
}
const steps:FundingTransactionStep[]=["nativeTransfer","usdcTransfer","approval","deposit"];
async function signed(f:ReturnType<typeof fixture>,step:FundingTransactionStep,mutate?:(tx:TransactionSerializableEIP1559)=>void) {
  const tx=prepareGatewayFundingTransaction(f.operation,step,"7");
  const unsigned=parseTransaction(tx.serializedUnsigned) as TransactionSerializableEIP1559;
  mutate?.(unsigned);
  const rawTransaction=await (step === "nativeTransfer" || step === "usdcTransfer" ? f.funder : f.spend).signTransaction(unsigned);
  return {rawTransaction,transactionHash:keccak256(rawTransaction)};
}

describe("canonical funding transaction evidence",()=>{
  it.each(steps)("validates actual installed viem signing for %s without signing/provider authority",async step=>{
    const f=fixture(),dto=prepareGatewayFundingTransaction(f.operation,step,"7"),guard=vi.fn();
    const evidence=await signed(f,step),result=await validateSignedGatewayFundingTransaction(f.operation,step,"7",evidence,guard);
    expect(result.transaction).toEqual(dto);expect(result.transactionHash).toBe(keccak256(evidence.rawTransaction));
    expect(guard).toHaveBeenCalledTimes(2);expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result.transaction)).toBe(true);
    expect(dto.worstCaseGasWei).toBe((BigInt(dto.gas)*BigInt(dto.maxFeePerGasWei)).toString());
    expect(validatePreparedGatewayFundingTransaction(f.operation,step,"7",dto)).toEqual(dto);
  });
  it.each([
    ["nativeTransfer","native payee",(tx:TransactionSerializableEIP1559)=>{tx.to=`0x${"33".repeat(20)}`;}],
    ["nativeTransfer","native amount",(tx:TransactionSerializableEIP1559)=>{tx.value=BigInt(51);}],
    ["usdcTransfer","USDC payee",(tx:TransactionSerializableEIP1559)=>{tx.data=encodeFunctionData({abi:erc20Abi,functionName:"transfer",args:[`0x${"33".repeat(20)}`,BigInt(100)]});}],
    ["approval","unlimited approval",(tx:TransactionSerializableEIP1559)=>{tx.data=encodeFunctionData({abi:erc20Abi,functionName:"approve",args:["0x0077777d7eba4688bdef3e311b846f25870a19b9",BigInt(2)**BigInt(256)-BigInt(1)]});}],
    ["approval","wrong gateway",(tx:TransactionSerializableEIP1559)=>{tx.to=`0x${"33".repeat(20)}`;}],
    ["deposit","wrong token",(tx:TransactionSerializableEIP1559)=>{tx.data=(tx.data!.slice(0,10)+"0".repeat(24)+"33".repeat(20)+tx.data!.slice(74)) as Hex;}],
    ["deposit","wrong amount",(tx:TransactionSerializableEIP1559)=>{tx.data=(tx.data!.slice(0,-2)+"65") as Hex;}],
    ["deposit","native value",(tx:TransactionSerializableEIP1559)=>{tx.value=BigInt(1);}],
    ["deposit","chain",(tx:TransactionSerializableEIP1559)=>{tx.chainId=5042;}],
    ["deposit","nonce",(tx:TransactionSerializableEIP1559)=>{tx.nonce=8;}],
    ["deposit","fee",(tx:TransactionSerializableEIP1559)=>{tx.maxFeePerGas=BigInt(11);}],
    ["deposit","priority",(tx:TransactionSerializableEIP1559)=>{tx.maxPriorityFeePerGas=BigInt(2);}],
    ["deposit","gas",(tx:TransactionSerializableEIP1559)=>{tx.gas=BigInt(120001);}],
    ["deposit","trailing calldata",(tx:TransactionSerializableEIP1559)=>{tx.data=`${tx.data!}00`;}],
    ["deposit","access list",(tx:TransactionSerializableEIP1559)=>{tx.accessList=[{address:`0x${"33".repeat(20)}`,storageKeys:[]}];}],
  ] as const)("refuses signed %s %s",async(step,_name,mutate)=>{
    const f=fixture();await expect(validateSignedGatewayFundingTransaction(f.operation,step,"7",await signed(f,step,mutate),()=>{})).rejects.toThrow("refused");
  });
  it("refuses a valid original signed by another synthetic account",async()=>{
    const f=fixture(),dto=prepareGatewayFundingTransaction(f.operation,"deposit","7");
    const rawTransaction=await f.funder.signTransaction(parseTransaction(dto.serializedUnsigned));
    await expect(validateSignedGatewayFundingTransaction(f.operation,"deposit","7",{rawTransaction,transactionHash:keccak256(rawTransaction)},()=>{})).rejects.toThrow("refused");
  });
  it.each(["01","-1","1.0","1e2","9007199254740992",(BigInt(2)**BigInt(256)).toString()])("refuses unsafe/noncanonical original nonce %s",nonce=>{
    expect(()=>prepareGatewayFundingTransaction(fixture().operation,"deposit",nonce)).toThrow("refused");
  });
  it("copies prepared terms and rejects unknown, accessor and changed DTOs without evaluating getters",()=>{
    const f=fixture(),dto=prepareGatewayFundingTransaction(f.operation,"deposit","0"),getter=vi.fn();
    const evil={...dto};Object.defineProperty(evil,"nonce",{enumerable:true,get:getter});
    for(const input of [evil,{...dto,nonce:0},{...dto,from:dto.sender},{...dto,gas:"1"},{...dto,serializedUnsigned:`${dto.serializedUnsigned}00`}])
      expect(()=>validatePreparedGatewayFundingTransaction(f.operation,"deposit","0",input)).toThrow("refused");
    expect(getter).not.toHaveBeenCalled();f.operation.gasLimits.deposit="1";expect(dto.gas).toBe("120000");
  });
  it("refuses malformed/oversized raw evidence, altered hash and raw accessors",async()=>{
    const f=fixture(),good=await signed(f,"deposit"),getter=vi.fn();
    const evil={...good};Object.defineProperty(evil,"rawTransaction",{enumerable:true,get:getter});
    for(const evidence of [evil,{...good,extra:true},{...good,transactionHash:`0x${"11".repeat(32)}`},
      {...good,rawTransaction:"0x02"},{...good,rawTransaction:`0x02${"aa".repeat(2049)}`},
      {...good,rawTransaction:`${good.rawTransaction}00`},{...good,rawTransaction:good.rawTransaction.toUpperCase()}])
      await expect(validateSignedGatewayFundingTransaction(f.operation,"deposit","7",evidence,()=>{})).rejects.toThrow("refused");
    expect(getter).not.toHaveBeenCalled();
  });
  it("refuses high-S malleability and invalid parity even with the corresponding local hash",async()=>{
    const f=fixture(),good=await signed(f,"deposit"),parsed=parseTransaction(good.rawTransaction);
    const order=BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
    const rawTransaction=serializeTransaction({...parsed,s:`0x${(order-BigInt(parsed.s!)).toString(16)}`,yParity:parsed.yParity === 0 ? 1 : 0,v:undefined});
    await expect(validateSignedGatewayFundingTransaction(f.operation,"deposit","7",{rawTransaction,transactionHash:keccak256(rawTransaction)},()=>{})).rejects.toThrow("refused");
    // A raw RLP tuple with parity 2 must refuse before recovery.
    const tuple=[`0x${(5042002).toString(16)}`,"0x07","0x01","0x0a","0x01d4c0",parsed.to!,"0x",parsed.data!,[],"0x02",parsed.r!,parsed.s!] as const;
    const parity=`0x02${toRlp(tuple).slice(2)}` as Hex;
    await expect(validateSignedGatewayFundingTransaction(f.operation,"deposit","7",{rawTransaction:parity,transactionHash:keccak256(parity)},()=>{})).rejects.toThrow("refused");
  });
  it("rejects legacy/type1 signatures and unsupported typed envelopes",async()=>{
    const f=fixture(),original=prepareGatewayFundingTransaction(f.operation,"nativeTransfer","7");
    for(const type of ["legacy","eip2930"] as const) {
      const rawTransaction=await f.funder.signTransaction({type,chainId:5042002,nonce:7,to:original.to,
        value:BigInt(original.valueWei),gas:BigInt(original.gas),gasPrice:BigInt(10)});
      await expect(validateSignedGatewayFundingTransaction(f.operation,"nativeTransfer","7",{rawTransaction,transactionHash:keccak256(rawTransaction)},()=>{})).rejects.toThrow("refused");
    }
    const good=await signed(f,"deposit");
    for(const prefix of ["03","04"]) {
      const rawTransaction=`0x${prefix}${good.rawTransaction.slice(4)}` as Hex;
      await expect(validateSignedGatewayFundingTransaction(f.operation,"deposit","7",{rawTransaction,transactionHash:keccak256(rawTransaction)},()=>{})).rejects.toThrow("refused");
    }
  });
  it("rejects nonminimal RLP integers, unsafe wire nonce and unsigned envelopes",async()=>{
    const f=fixture(),good=await signed(f,"deposit"),parsed=parseTransaction(good.rawTransaction);
    const base=[`0x${(5042002).toString(16)}`,"0x07","0x01","0x0a","0x01d4c0",parsed.to!,"0x",parsed.data!,[],
      parsed.yParity === 0 ? "0x" : "0x01",parsed.r!,parsed.s!] as const;
    for(const nonce of ["0x0007","0x20000000000000"]) {
      const tuple=[...base];tuple[1]=nonce as typeof tuple[1];
      const rawTransaction=`0x02${toRlp(tuple).slice(2)}` as Hex;
      await expect(validateSignedGatewayFundingTransaction(f.operation,"deposit","7",{rawTransaction,transactionHash:keccak256(rawTransaction)},()=>{})).rejects.toThrow("refused");
    }
    const rawTransaction=prepareGatewayFundingTransaction(f.operation,"deposit","7").serializedUnsigned;
    await expect(validateSignedGatewayFundingTransaction(f.operation,"deposit","7",{rawTransaction,transactionHash:keccak256(rawTransaction)},()=>{})).rejects.toThrow("refused");
  });
  it("retains the exact largest safe nonce and refuses zero-transfer steps or overflowing operation terms",async()=>{
    const f=fixture(),nonce=Number.MAX_SAFE_INTEGER.toString(),dto=prepareGatewayFundingTransaction(f.operation,"deposit",nonce);
    const rawTransaction=await f.spend.signTransaction(parseTransaction(dto.serializedUnsigned));
    expect((await validateSignedGatewayFundingTransaction(f.operation,"deposit",nonce,{rawTransaction,transactionHash:keccak256(rawTransaction)},()=>{})).transaction.nonce).toBe(nonce);
    f.operation.nativeTransferWei="0";expect(()=>prepareGatewayFundingTransaction(f.operation,"nativeTransfer","0")).toThrow("refused");
    f.operation.usdcTransferMicros="0";expect(()=>prepareGatewayFundingTransaction(f.operation,"usdcTransfer","0")).toThrow("refused");
    f.operation.maxFeePerGasWei=(BigInt(2)**BigInt(256)).toString();expect(()=>prepareGatewayFundingTransaction(f.operation,"deposit","0")).toThrow("refused");
  });
  it("repeats current authority after real async recovery rather than returning stale evidence",async()=>{
    const f=fixture(),evidence=await signed(f,"deposit");let enabled=true,calls=0;
    const guard=()=>{calls++;if(!enabled)throw new Error("changed");queueMicrotask(()=>{enabled=false;});};
    await expect(validateSignedGatewayFundingTransaction(f.operation,"deposit","7",evidence,guard)).rejects.toThrow("refused");expect(calls).toBe(2);
  });
  it("refuses promise-returning authority guards",async()=>{
    const f=fixture(),evidence=await signed(f,"deposit");
    await expect(validateSignedGatewayFundingTransaction(f.operation,"deposit","7",evidence,async()=>{})).rejects.toThrow("refused");
  });
});
