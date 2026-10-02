import { createPublicClient } from "viem";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { chainForProfile } from "../chains";
import { browserSessionCashoutMaxAheadBlocks } from "../session/browser-session-cashout-policy";
import { withdrawalRpcTransport } from "./withdrawal-rpc-transport";
import type { WithdrawRequest } from "./withdraw-protocol";

/** Creator's independently compiled profile and finite block window. Never derive
 * expiry authority from a preparation response's claimed network or block rate. */
export async function readCreatorOwnerBrowserWindow(intent:WithdrawRequest["burnIntent"],signal:AbortSignal){
  const client=createPublicClient({chain:chainForProfile(profile),transport:withdrawalRpcTransport(profile.rpcUrl,AbortSignal.any([signal,AbortSignal.timeout(12000)]))});
  if(await client.getChainId()!==profile.chainId)throw new Error("Creator withdrawal network differs");
  const block=await client.getBlock({blockTag:"latest"}),age=Date.now()-Number(block.timestamp)*1000;
  if(block.number===null||!block.hash||age< -5000||age>60000||!Number.isFinite(age)||
    BigInt(intent.maxBlockHeight)<=block.number||BigInt(intent.maxBlockHeight)>block.number+BigInt(browserSessionCashoutMaxAheadBlocks()))
    throw new Error("Creator withdrawal finite window differs");
  for(const address of [profile.gatewayWallet,profile.gatewayMinter]){
    const code=await client.getCode({address,blockNumber:block.number});
    if(!code||!/^0x(?:[a-fA-F0-9]{2})+$/.test(code))throw new Error("Creator withdrawal contract unavailable");
  }
  const again=await client.getBlock({blockNumber:block.number});
  if(again.hash!==block.hash||again.timestamp!==block.timestamp||await client.getChainId()!==profile.chainId)throw new Error("Creator withdrawal chain changed");
  signal.throwIfAborted();
}
