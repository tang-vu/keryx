"use client";
import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import { useCallback, useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { paperDeclarationMessage, paperDeclarationSchema, type PaperDeclaration, type PaperState } from "@/lib/scholarly/rights-protocol";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";

const uiCopy = createMessages("en");
const uiRichCopy = createRichMessages("en");

type Data = { state: PaperState | null; enrolled: boolean; ready: boolean; items: number; active: boolean; verified: boolean;
  binding: Pick<PaperDeclaration, "protocol" | "network" | "deploymentOrigin" | "sourceId" | "itemId" | "registry" | "onchainId" | "creator" | "recipient" | "priceMicros" | "canonicalUrl" | "contentVersion" | "bodyHash" | "plaintextBytes" | "manifestId"> | null };
const date = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
export function ScholarlyRightsPanel({creatorId}:{creatorId:string}){
  return browserPaymentProfile().testnet?<TestnetScholarlyRightsPanel creatorId={creatorId}/>:<section className="mt-6 rounded-xl border border-line p-4" aria-label={uiCopy("creatorRights.aria")}>
    <h2 className="font-display text-xl">{uiCopy("creatorRights.mainnetTitle")}</h2>
    <p className="mt-2 text-sm">{uiCopy("creatorRights.mainnetHeld")}</p>
  </section>;
}
function TestnetScholarlyRightsPanel({ creatorId }: { creatorId: string }) {
  const [data, setData] = useState<Data | null>(null), [working, setWorking] = useState(false), [message, setMessage] = useState("");
  const [unavailable, setUnavailable] = useState(uiCopy("creatorRights.loading"));
  const { address } = useAccount(), { signMessageAsync } = useSignMessage();
  const load = useCallback(async () => {
    const response = await fetch(`/api/creator/${creatorId}/scholarly`, { cache: "no-store" });
    if (response.ok) setData(await response.json());
    else if (response.status === 401) setUnavailable(uiCopy("creatorRights.signIn"));
    else if (response.status === 403) setUnavailable(uiCopy("creatorRights.onlyCreator"));
    else setUnavailable(uiCopy("creatorRights.unavailable"));
  }, [creatorId]);
  useEffect(() => {
    // The first update happens after the owner-status request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch(() => setUnavailable(uiCopy("creatorRights.temporarilyUnavailable")));
  }, [load]);
  if (!data) return <section className="mt-6 rounded-xl border border-line p-4" aria-label={uiCopy("creatorRights.aria")}><h2 className="font-display text-xl">{uiCopy("creatorRights.title")}</h2><p className="mt-2 text-sm">{unavailable}</p><a href="/connect" className="mt-2 inline-block underline text-sm">{uiCopy("creatorRights.connect")}</a><p className="mt-2 text-xs text-ink-3">{uiRichCopy("creatorRights.registrationInstruction", { registrationLink: <a href="/register" className="underline">{uiCopy("creatorRights.registration")}</a> })}</p></section>;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.binding || !address || address.toLowerCase() !== data.binding.creator.toLowerCase()) { setMessage(uiCopy("creatorRights.walletFirst")); return; }
    const form = new FormData(event.currentTarget);
    setWorking(true); setMessage("");
    try {
      const nonce = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("")}`;
      const declaration = paperDeclarationSchema.parse({ ...data.binding, nonce,
        manuscriptVersion: form.get("manuscriptVersion"), role: form.get("role"), doi: form.get("doi") ?? "",
        license: form.get("license"), permissionEvidence: form.get("permissionEvidence"), commercialDistribution: form.get("commercialDistribution") === "on",
        redistributionScope: form.get("redistributionScope"), attributionConditions: form.get("attributionConditions"), revocationContact: form.get("revocationContact"),
        effectiveAt: new Date(String(form.get("effectiveAt"))).toISOString(), expiresAt: new Date(String(form.get("expiresAt"))).toISOString(),
        embargoUntil: new Date(String(form.get("embargoUntil"))).toISOString() });
      const signature = await signMessageAsync({ message: paperDeclarationMessage(declaration) });
      const response = await fetch(`/api/creator/${creatorId}/scholarly`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ declaration, signature }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? uiCopy("creatorRights.submitFailed"));
      setMessage(uiCopy("creatorRights.saved"));
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : uiCopy("creatorRights.submitFailed")); }
    finally { setWorking(false); }
  }
  const current = data.state;
  const status = current?.review?.decision.declarationId === current?.declarationId ? current?.review?.decision.outcome ?? "submitted" : "submitted";
  return <section className="mt-6 rounded-xl border border-line p-4" aria-label={uiCopy("creatorRights.aria")}>
    <h2 className="font-display text-xl">{uiCopy("creatorRights.title")}</h2>
    <p className="mt-2 text-sm text-ink-2">{uiCopy("creatorRights.introduction")}</p>
    <p className="mt-2 text-sm">{uiRichCopy("creatorRights.status", { status: <strong>{current ? status : data.enrolled ? uiCopy("creatorRights.draft") : uiCopy("creatorRights.notEnrolled")}</strong> })}</p>
    {!data.enrolled && <><p className="mt-2 text-sm">{uiCopy("creatorRights.enrollmentBoundary")}</p><button type="button" disabled={working} className="mt-2 rounded border px-3 py-2" onClick={async () => { setWorking(true); try { const response = await fetch(`/api/creator/${creatorId}/scholarly`, { method: "PUT" }); if (!response.ok) throw new Error((await response.json()).error); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : uiCopy("creatorRights.enrollmentUnavailable")); } finally { setWorking(false); } }}>{uiCopy("creatorRights.begin")}</button></>}
    {current?.review?.decision.declarationId === current?.declarationId && current?.review && <p className="mt-2 text-sm">{uiCopy("creatorRights.review", { summary: current.review.decision.publicSummary })}</p>}
    {current && <p className="mt-2 break-all font-mono text-xs">{current.decisionId ? uiCopy("creatorRights.declarationWithReview", { declarationId: current.declarationId, reviewId: current.decisionId }) : uiCopy("creatorRights.declaration", { declarationId: current.declarationId })}</p>}
    <button type="button" className="mt-2 underline text-sm" onClick={() => void load().catch(() => setMessage(uiCopy("creatorRights.statusUnavailable")))}>{uiCopy("creatorRights.refresh")}</button>
    {!data.ready || !data.active || !data.verified ? <p className="mt-3 text-sm">{uiCopy(data.items === 1 ? "creatorRights.prepare.one" : "creatorRights.prepare.other", { count: data.items })}</p> : <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-sm">{uiCopy("creatorRights.version")}<select name="manuscriptVersion" className="block w-full rounded border p-2"><option value="author-manuscript">{uiCopy("creatorRights.authorManuscript")}</option><option value="accepted-manuscript">{uiCopy("creatorRights.acceptedManuscript")}</option><option value="publisher-authorized-version">{uiCopy("creatorRights.publisherVersion")}</option></select></label>
      <label className="text-sm">{uiCopy("creatorRights.role")}<select name="role" className="block w-full rounded border p-2"><option value="author">{uiCopy("creatorRights.author")}</option><option value="authorized-publisher">{uiCopy("creatorRights.publisher")}</option></select></label>
      <label className="text-sm">{uiCopy("creatorRights.doi")}<input name="doi" maxLength={256} className="block w-full rounded border p-2" /></label>
      {([ ["license", uiCopy("creatorRights.license")], ["permissionEvidence", uiCopy("creatorRights.evidence")], ["redistributionScope", uiCopy("creatorRights.scope")], ["attributionConditions", uiCopy("creatorRights.attribution")], ["revocationContact", uiCopy("creatorRights.revocation")] ] as const).map(([name, label]) => <label key={name} className="text-sm">{label}<textarea name={name} required maxLength={2000} className="block w-full rounded border p-2" /></label>)}
      {([ ["effectiveAt", uiCopy("creatorRights.starts"), date(-1)], ["embargoUntil", uiCopy("creatorRights.embargo"), date(-1)], ["expiresAt", uiCopy("creatorRights.expires"), date(365)] ] as const).map(([name, label, initial]) => <label key={name} className="text-sm">{label}<input name={name} type="date" required defaultValue={initial} className="block w-full rounded border p-2" /></label>)}
      <label className="text-sm sm:col-span-2"><input name="commercialDistribution" type="checkbox" required /> {uiCopy("creatorRights.attestation")}</label>
      <p className="text-xs text-ink-3 sm:col-span-2">{uiCopy("creatorRights.privacy")}</p>
      <button disabled={working} className="rounded bg-ink px-4 py-2 text-paper sm:col-span-2">{working ? uiCopy("creatorRights.saving") : current ? uiCopy("creatorRights.revise") : uiCopy("creatorRights.submit")}</button>
    </form>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
  </section>;
}
