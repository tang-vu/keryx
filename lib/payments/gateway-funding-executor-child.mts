/** Dedicated synthetic subprocess fixture. Inputs travel over bounded stdin,
 * never argv/env/logs. It is not an operator or production funding command. */
import { openGatewayFundingSqliteLedger,openGatewayFundingSqliteTerminalObserver } from "../db/gateway-funding-sqlite.ts";
import { createGatewayFundingExecutorForTrustedSyntheticComposition,createKeylessGatewayFundingReconcilerForTrustedSyntheticComposition } from "./gateway-funding-executor.ts";
import type { GatewayFundingLedger } from "../db/gateway-funding-ledger-types.ts";
let text="";for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>16384)process.exit(2);}
try {
  const input=JSON.parse(text),ledger=openGatewayFundingSqliteLedger(input.file,input.identity);
  const binding={ledger,expectedIdentity:input.identity,installedPolicyDigest:input.installedPolicyDigest,
    expectedBackendBindingDigest:input.expectedBackendBindingDigest,finalityPolicyDigest:input.finalityPolicyDigest,assertCurrentAuthority:()=>{}};
  if(input.mode==="keyless") {
    if(Object.hasOwn(input,"funderPrivateKey") || Object.hasOwn(input,"spendPrivateKey"))throw new Error();
    const store=openGatewayFundingSqliteTerminalObserver(input.file,input.identity);
    const answer=await createKeylessGatewayFundingReconcilerForTrustedSyntheticComposition({...binding,terminalStore:store},async()=>null)
      .reconcileStep(input.operationId,"nativeTransfer");
    process.stdout.write(`RESULT ${JSON.stringify(answer)}\n`);store.close();ledger.close();
  } else {
    const method=input.mode==="crypto" ? "claimCrypto" : input.mode==="prepared" ? "savePrepared" : input.mode==="broadcast" ? "claimBroadcast" : null;
    const wrapped=method ? {...ledger,[method]:async(...args:unknown[])=>{
      await (ledger[method as "claimCrypto"] as (...args:unknown[])=>Promise<unknown>)(...args);
      process.stdout.write("COMMITTED\n");await new Promise(()=>{});
    }} as GatewayFundingLedger : ledger;
    const answer=await createGatewayFundingExecutorForTrustedSyntheticComposition({...binding,ledger:wrapped,
      funderPrivateKey:input.funderPrivateKey,spendPrivateKey:input.spendPrivateKey},input.endpoint).executeStep(input.operationId,"nativeTransfer");
    process.stdout.write(`RESULT ${JSON.stringify(answer)}\n`);ledger.close();
  }
}catch{process.stdout.write("REFUSED\n");process.exitCode=2;}
