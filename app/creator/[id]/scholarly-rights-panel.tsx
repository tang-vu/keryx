"use client";
import { useCallback, useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { paperDeclarationMessage, paperDeclarationSchema, type PaperDeclaration, type PaperState } from "@/lib/scholarly/rights-protocol";

type Data = { state: PaperState | null; enrolled: boolean; ready: boolean; items: number; active: boolean; verified: boolean;
  binding: Pick<PaperDeclaration, "protocol" | "network" | "deploymentOrigin" | "sourceId" | "itemId" | "registry" | "onchainId" | "creator" | "recipient" | "priceMicros" | "canonicalUrl" | "contentVersion" | "bodyHash" | "plaintextBytes" | "manifestId"> | null };
const date = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
export function ScholarlyRightsPanel({ creatorId }: { creatorId: string }) {
  const [data, setData] = useState<Data | null>(null), [working, setWorking] = useState(false), [message, setMessage] = useState("");
  const [unavailable, setUnavailable] = useState("Loading creator rights status…");
  const { address } = useAccount(), { signMessageAsync } = useSignMessage();
  const load = useCallback(async () => {
    const response = await fetch(`/api/creator/${creatorId}/scholarly`, { cache: "no-store" });
    if (response.ok) setData(await response.json());
    else if (response.status === 401) setUnavailable("Sign in with the registry creator wallet to prepare manuscript rights.");
    else if (response.status === 403) setUnavailable("Only this source’s registry creator can submit manuscript rights.");
    else setUnavailable("Manuscript enrollment is unavailable. It requires a registered source, fresh registry authority, and the supported SQLite pilot datastore.");
  }, [creatorId]);
  useEffect(() => {
    // The first update happens after the owner-status request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch(() => setUnavailable("Creator rights status is temporarily unavailable."));
  }, [load]);
  if (!data) return <section className="mt-6 rounded-xl border border-line p-4" aria-label="Scholarly manuscript opt-in"><h2 className="font-display text-xl">Offer a research manuscript</h2><p className="mt-2 text-sm">{unavailable}</p><a href="/connect" className="mt-2 inline-block underline text-sm">Connect and sign in</a><p className="mt-2 text-xs text-ink-3">Supervised Arc testnet pilot. Independent distribution-rights review is required before earning. Register a dedicated source at <a href="/register" className="underline">creator registration</a>.</p></section>;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.binding || !address || address.toLowerCase() !== data.binding.creator.toLowerCase()) { setMessage("Connect the registry creator wallet first."); return; }
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
      if (!response.ok) throw new Error(result.error ?? "Submission failed");
      setMessage("Signed declaration saved. New paid reads stay blocked until independent review approves this exact version.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Submission failed"); }
    finally { setWorking(false); }
  }
  const current = data.state;
  const status = current?.review?.decision.declarationId === current?.declarationId ? current?.review?.decision.outcome ?? "submitted" : "submitted";
  return <section className="mt-6 rounded-xl border border-line p-4" aria-label="Scholarly manuscript opt-in">
    <h2 className="font-display text-xl">Offer a research manuscript</h2>
    <p className="mt-2 text-sm text-ink-2">Supervised Arc testnet pilot. Register a dedicated source with one manuscript, verify your feed, begin enrollment here, then publish signed full text in the uploader below. Your wallet controls payment; independent review checks permission to distribute this exact version. DOI metadata does not establish rights.</p>
    <p className="mt-2 text-sm">Rights status: <strong>{current ? status : data.enrolled ? "draft — earning blocked" : "not enrolled"}</strong>. Approval is separate from settlement.</p>
    {!data.enrolled && <><p className="mt-2 text-sm">Begin enrollment before uploading your manuscript. This permanently places the dedicated source behind the rights gate; pending drafts cannot earn through ordinary source payments.</p><button type="button" disabled={working} className="mt-2 rounded border px-3 py-2" onClick={async () => { setWorking(true); try { const response = await fetch(`/api/creator/${creatorId}/scholarly`, { method: "PUT" }); if (!response.ok) throw new Error((await response.json()).error); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Enrollment unavailable"); } finally { setWorking(false); } }}>Begin manuscript enrollment</button></>}
    {current?.review?.decision.declarationId === current?.declarationId && current?.review && <p className="mt-2 text-sm">Review: {current.review.decision.publicSummary}</p>}
    {current && <p className="mt-2 break-all font-mono text-xs">Declaration: {current.declarationId}{current.decisionId && <> · Review: {current.decisionId}</>}</p>}
    <button type="button" className="mt-2 underline text-sm" onClick={() => void load().catch(() => setMessage("Status unavailable"))}>Refresh after upload or review</button>
    {!data.ready || !data.active || !data.verified ? <p className="mt-3 text-sm">Prepare one signed full-text item on an active, verified registered source before submitting. Current item count: {data.items}.</p> : <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Exact version<select name="manuscriptVersion" className="block w-full rounded border p-2"><option value="author-manuscript">Author manuscript</option><option value="accepted-manuscript">Accepted manuscript</option><option value="publisher-authorized-version">Publisher-authorized version</option></select></label>
      <label className="text-sm">Your distribution role<select name="role" className="block w-full rounded border p-2"><option value="author">Author</option><option value="authorized-publisher">Authorized publisher</option></select></label>
      <label className="text-sm">DOI (optional; metadata only)<input name="doi" maxLength={256} className="block w-full rounded border p-2" /></label>
      {([ ["license", "Public license / permission summary"], ["permissionEvidence", "Private evidence reference (agreement or license record)"], ["redistributionScope", "Commercial redistribution scope"], ["attributionConditions", "Required attribution"], ["revocationContact", "Dispute / revocation contact"] ] as const).map(([name, label]) => <label key={name} className="text-sm">{label}<textarea name={name} required maxLength={2000} className="block w-full rounded border p-2" /></label>)}
      {([ ["effectiveAt", "Permission starts", date(-1)], ["embargoUntil", "Embargo ends", date(-1)], ["expiresAt", "Permission expires", date(365)] ] as const).map(([name, label, initial]) => <label key={name} className="text-sm">{label}<input name={name} type="date" required defaultValue={initial} className="block w-full rounded border p-2" /></label>)}
      <label className="text-sm sm:col-span-2"><input name="commercialDistribution" type="checkbox" required /> I am authorized to commercially distribute these exact bytes under the declared scope. Coauthor or publisher permission is documented where required. Submission does not grant approval.</label>
      <p className="text-xs text-ink-3 sm:col-span-2">One recipient, browser funded reads only. License summary, approved version and safe review summary are public. Permission evidence and revocation contact are private to the authenticated creator and local reviewer, excluded from public receipts. A public copy remains free. New revisions require review; enrollment cannot revert to ordinary source payment.</p>
      <button disabled={working} className="rounded bg-ink px-4 py-2 text-paper sm:col-span-2">{working ? "Signing and saving…" : current ? "Sign a new rights revision" : "Sign and submit for independent review"}</button>
    </form>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
  </section>;
}
