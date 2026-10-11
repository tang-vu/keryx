import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import { claimControlIsFresh, SOURCE_CLAIM_PROOF_MAX_AGE_MS, type SourceClaim } from "@/lib/sources/public-source-claim";

const uiCopy = createMessages("en");
const uiRichCopy = createRichMessages("en");

export function ClaimTime({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" })}</time>;
}

export function ClaimControlStatus({ claim, now }: { claim: SourceClaim; now: number }) {
  const clockReady = now > 0 && Number.isFinite(now);
  const fresh = claimControlIsFresh(claim, now);
  const deadline = new Date(Date.parse(claim.verifiedAt) + SOURCE_CLAIM_PROOF_MAX_AGE_MS).toISOString();
  return <div className="space-y-2 text-sm">
    <p>{uiRichCopy("sourceClaimStatus.lastVerified", { time: <ClaimTime value={claim.verifiedAt} /> })}</p>
    <p>{uiRichCopy("sourceClaimStatus.deadline", { time: <ClaimTime value={deadline} /> })}</p>
    <p role="status" className={!clockReady || fresh ? "text-ink-2" : "text-seal"}>{!clockReady ? uiCopy("sourceClaimStatus.checking") : fresh ? uiCopy("sourceClaimStatus.current") : uiCopy("sourceClaimStatus.expired")}</p>
  </div>;
}
