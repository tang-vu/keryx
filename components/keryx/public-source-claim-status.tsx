import { DisplayTime } from "@/components/keryx/display-time";
import { createMessages } from "@/lib/i18n/messages";

import { claimControlIsFresh, SOURCE_CLAIM_PROOF_MAX_AGE_MS, type SourceClaim } from "@/lib/sources/public-source-claim";
import { UiRichMessage, UiText } from "@/lib/i18n/ui-copy";



const uiCopy = createMessages("en");


export function ClaimTime({ value }: { value: string }) {
  return <DisplayTime value={value} />;
}

export function ClaimControlStatus({ claim, now }: { claim: SourceClaim; now: number }) {
  const clockReady = now > 0 && Number.isFinite(now);
  const fresh = claimControlIsFresh(claim, now);
  const deadline = new Date(Date.parse(claim.verifiedAt) + SOURCE_CLAIM_PROOF_MAX_AGE_MS).toISOString();
  return <div className="space-y-2 text-sm">
    <p><UiRichMessage messageKey={"sourceClaimStatus.lastVerified"} values={{ time: <ClaimTime value={claim.verifiedAt} /> }} /></p>
    <p><UiRichMessage messageKey={"sourceClaimStatus.deadline"} values={{ time: <ClaimTime value={deadline} /> }} /></p>
    <p role="status" className={!clockReady || fresh ? "text-ink-2" : "text-seal"}><UiText source={!clockReady ? uiCopy("sourceClaimStatus.checking") : fresh ? uiCopy("sourceClaimStatus.current") : uiCopy("sourceClaimStatus.expired")} /></p>
  </div>;
}
