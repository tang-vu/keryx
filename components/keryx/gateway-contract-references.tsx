import { arcProfileLabel, recordedGatewayProfiles } from "@/lib/arc-network-display";
import { createMessages } from "@/lib/i18n/messages";
import { UiAttributes, UiMessage } from "@/lib/i18n/ui-copy";



const message = createMessages("en");

/** Contract references for the original recorded networks, not per-payment proof. */
export function GatewayContractReferences({records,className}:{records:ReadonlyArray<{network?:string}>;className?:string}){
  return <>{recordedGatewayProfiles(records).map(profile=><UiAttributes key={profile.networkId} names={["title"]}><a key={profile.networkId}
    href={`${profile.explorerUrl}/address/${profile.gatewayWallet}`} target="_blank" rel="noopener noreferrer"
    className={className} title={message("creatorPayments.contractTitle", { network: arcProfileLabel(profile) })}>
    <UiMessage messageKey={"creatorPayments.contractLink"} values={{ network: arcProfileLabel(profile) }} />
  </a></UiAttributes>)}</>;
}
