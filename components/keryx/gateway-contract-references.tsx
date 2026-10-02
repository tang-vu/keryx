import { arcProfileLabel, recordedGatewayProfiles } from "@/lib/arc-network-display";

/** Contract references for the original recorded networks, not per-payment proof. */
export function GatewayContractReferences({records,className}:{records:ReadonlyArray<{network?:string}>;className?:string}){
  return <>{recordedGatewayProfiles(records).map(profile=><a key={profile.networkId}
    href={`${profile.explorerUrl}/address/${profile.gatewayWallet}`} target="_blank" rel="noopener noreferrer"
    className={className} title={`Circle Gateway contract on ${arcProfileLabel(profile)}; inspect the original receipt for payment evidence`}>
    Gateway · {arcProfileLabel(profile)} ↗
  </a>)}</>;
}
