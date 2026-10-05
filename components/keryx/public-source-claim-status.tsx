import { claimControlIsFresh, SOURCE_CLAIM_PROOF_MAX_AGE_MS, type SourceClaim } from "@/lib/sources/public-source-claim";

export function ClaimTime({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" })}</time>;
}

export function ClaimControlStatus({ claim, now }: { claim: SourceClaim; now: number }) {
  const clockReady = now > 0 && Number.isFinite(now);
  const fresh = claimControlIsFresh(claim, now);
  const deadline = new Date(Date.parse(claim.verifiedAt) + SOURCE_CLAIM_PROOF_MAX_AGE_MS).toISOString();
  return <div className="space-y-2 text-sm">
    <p>Last verified: <ClaimTime value={claim.verifiedAt} />.</p>
    <p>Verify again by: <ClaimTime value={deadline} />. Each control proof lasts 24 hours.</p>
    <p role="status" className={!clockReady || fresh ? "text-ink-2" : "text-seal"}>{!clockReady ? "Checking control proof freshness. No earning eligibility is confirmed here yet." : fresh ? "Control proof is current. Earnings also require your saved permission, matching live registry authority and a qualifying new use." : "Control verification expired. Earning eligibility is paused until you publish and check a fresh proof. Your saved policy and past receipts are retained."} Public free reads are unaffected.</p>
  </div>;
}
