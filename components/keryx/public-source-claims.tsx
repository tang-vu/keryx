"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { sourceClaimSchema, type SourceClaim } from "@/lib/sources/public-source-claim";
import { sourceClaimTarget } from "@/lib/registration-return";
import { claimRequest } from "./public-source-claim-api";
import { ClaimControlStatus } from "./public-source-claim-status";

const policyLabels = { free: "Free", "citation-only": "Citation rewards", paid: "Paid reads" };

/** Manual authenticated discovery only: opening a saved claim never renews or activates it. */
export function PublicSourceClaims({ owner, network, enabled, now }: { owner: string; network: string; enabled: boolean; now: number }) {
  const [claims, setClaims] = useState<SourceClaim[] | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const scope = `${owner}:${network}`;
  const latest = useRef({ scope, enabled }), mounted = useRef(true), busy = useRef(false);
  useLayoutEffect(() => { latest.current = { scope, enabled }; }, [scope, enabled]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const loadClaims = async () => {
    if (!enabled || busy.current) return;
    const captured = scope;
    busy.current = true; setWorking(true); setMessage("");
    const current = () => mounted.current && latest.current.scope === captured && latest.current.enabled;
    try {
      const data = await claimRequest("/api/source-claims");
      if (!current()) return;
      if (!Array.isArray(data.claims)) throw new Error("Your source claims are unavailable. Reload the list before opening a claim.");
      const next = data.claims.map(value => sourceClaimSchema.parse(value));
      if (next.some(claim => claim.ownerWallet !== owner || claim.network !== network || claim.deploymentOrigin !== window.location.origin)) throw new Error("The claim list does not match this wallet, network and deployment. Reconnect before reloading it.");
      setClaims(next);
    } catch (error) { if (current()) { setClaims(null); setMessage(error instanceof Error ? error.message : "Could not load your source claims."); } }
    finally { busy.current = false; if (mounted.current) setWorking(false); }
  };
  return <section className="space-y-3 border border-line bg-paper p-5" aria-labelledby="owned-source-claims-title">
    <h2 id="owned-source-claims-title" className="font-display text-2xl">Your source claims</h2>
    <p className="text-sm text-ink-2">Open a saved claim to review its policy or manually renew source control. Loading this list does not publish a proof, activate earnings or make a payment.</p>
    <button type="button" disabled={!enabled || working} onClick={() => void loadClaims()} className="min-h-11 border border-line px-3 text-sm disabled:opacity-50">{working ? "Loading your claims…" : claims ? "Reload my source claims" : "Load my source claims"}</button>
    {message && <p role="status" className="text-sm text-seal">{message}</p>}
    {claims?.length === 0 && <p role="status" className="text-sm text-ink-2">No source claims are saved for this wallet on this network.</p>}
    {enabled && claims && claims.length > 0 && <ul className="space-y-3">{claims.map(claim => <li key={claim.id} className="space-y-2 border border-line p-3">
      <p className="break-all text-sm font-semibold">{claim.canonicalUrl}</p>
      <p className="text-sm">Saved policy: {policyLabels[claim.mode]}.</p>
      <ClaimControlStatus claim={claim} now={now} />
      <Link href={sourceClaimTarget({ claimId: claim.id, url: claim.canonicalUrl, owner: claim.ownerWallet, ...(claim.publicReferenceId ? { referenceId: claim.publicReferenceId } : {}) })} className="inline-block min-h-11 py-2 text-sm underline">Review or re-verify this source</Link>
    </li>)}</ul>}
  </section>;
}
