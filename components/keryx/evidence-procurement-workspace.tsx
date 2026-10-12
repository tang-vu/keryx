"use client";

import { useEffect, useRef, useState } from "react";
import { downloadBrowserText } from "@/lib/browser-text-download";
import { MAX_PROCUREMENT_BYTES, parseEvidenceProcurement, type EvidenceProcurementPacket, type ProcurementOffer, type ProcurementDelivery } from "@/lib/evidence-procurement/contracts";
import { buildEvidenceProcurement, PROCUREMENT_NOTICE, procurementRequestHash, procurementBodyHash, procurementOfferHash, procurementDeliveryHash,
  procurementOfferMessage, procurementDeliveryMessage, type EvidenceProcurementResult } from "@/lib/evidence-procurement/engine";

const field = "mt-2 block w-full min-w-0 border border-line bg-paper px-3 py-2 font-serif text-sm text-ink";
const button = "inline-flex min-h-11 items-center justify-center border border-ink px-3 py-2 font-mono text-xs text-ink disabled:cursor-not-allowed disabled:opacity-50";
const label = "block font-mono text-xs text-ink-2";
const panel = "min-w-0 border border-line bg-paper p-4 sm:p-6";
const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(row => row !== value) : [...values, value];
const amount = (micros: string) => `${Math.floor(Number(micros) / 1e6)}.${String(Number(micros) % 1e6).padStart(6, "0")} USDC`;
const toMicros = (value: string) => {
  if (!/^(0|[1-9][0-9]{0,3})(\.[0-9]{1,6})?$/.test(value)) throw new Error("Use a USDC amount with at most six decimal places.");
  const [whole, fraction = ""] = value.split(".");
  return String(BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0")));
};
const expiry = (value: string) => new Date(`${value}:00Z`).toISOString();
const errorMessage = "Could not validate this change. Check the bounded fields, identifiers, signatures and exact excerpt positions. Your packet has been kept.";
type RequirementDraft = EvidenceProcurementPacket["request"]["requirements"][number];
type Signer = { address: string; signMessage: (message: string) => Promise<string> };
const reasonText: Record<string, string> = {
  eligible: "Signed quotation eligible for this proposal", "unsigned-offer": "Unsigned quotation — provider identity unverified",
  "invalid-offer-signature": "Offer signature does not authenticate this quotation", "expired-offer": "Quotation expired",
  "outside-quote-budget": "Exceeds the remaining quote budget", "no-new-proposed-coverage": "Adds no currently missing proposed coverage",
  "different-request": "Quotation is bound to another request", "request-expired": "Request expired",
  "attributed-bytes": "Signature authenticates these exact supplied bytes", "unsigned-delivery": "Unsigned delivery — withheld from review",
  "invalid-delivery-signature": "Delivery signature is invalid", "body-hash-mismatch": "Delivered text changed after hashing",
  "invalid-excerpt": "Excerpt does not bind an exact usable slice", "different-offer": "Delivery is bound to another quotation",
  "caller-reviewed": "Caller review recorded — a declaration", "unbound-review": "Review is not bound to an authenticated delivery",
};
const readableReason = (reason: string) => reasonText[reason] ?? reason.replaceAll("-", " ");
const currentObservationTime = () => Date.now();

/** Private tab-memory workbench. An optional client signer signs messages only. */
export function EvidenceProcurementWorkspace({ signer }: { signer?: Signer } = {}) {
  const [packet, setPacket] = useState<EvidenceProcurementPacket>();
  const [result, setResult] = useState<EvidenceProcurementResult>();
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const revision = useRef(0), operation = useRef(false);
  // An account switch or disconnect cannot attach a callback from a former wallet.
  useEffect(() => { revision.current++; }, [signer?.address]);
  const [requestId, setRequestId] = useState("request1"), [decision, setDecision] = useState("");
  const [network, setNetwork] = useState<EvidenceProcurementPacket["request"]["network"]>("eip155:5042");
  const [budget, setBudget] = useState("0.05"), [requestExpiry, setRequestExpiry] = useState("");
  const [requirements, setRequirements] = useState<RequirementDraft[]>([{ id: "requirement1", question: "", priority: 10, status: "missing" }]);
  const [offerId, setOfferId] = useState("offer1"), [providerWallet, setProviderWallet] = useState("");
  const [sourceUrl, setSourceUrl] = useState(""), [deliverable, setDeliverable] = useState("");
  const [price, setPrice] = useState("0.01"), [offerExpiry, setOfferExpiry] = useState(""), [nonce, setNonce] = useState("");
  const [offerRequirements, setOfferRequirements] = useState<string[]>([]), [offerSignature, setOfferSignature] = useState("");
  const [deliveryOfferId, setDeliveryOfferId] = useState(""), [body, setBody] = useState("");
  const [excerpts, setExcerpts] = useState<ProcurementDelivery["excerpts"]>([]), [excerptRequirement, setExcerptRequirement] = useState("");
  const [stance, setStance] = useState<"supports" | "refutes" | "inconclusive">("supports"), [deliverySignature, setDeliverySignature] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [reviewer, setReviewer] = useState(""), [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewIds, setReviewIds] = useState<Record<string, string[]>>({});
  const [importJson, setImportJson] = useState(""), [restore, setRestore] = useState<EvidenceProcurementPacket>();
  const [offerJson, setOfferJson] = useState(""), [deliveryJson, setDeliveryJson] = useState("");

  const edited = () => { revision.current++; setResult(undefined); setRestore(undefined); setMessage(""); };
  const offerEdited = () => { edited(); setOfferSignature(""); };
  const deliveryEdited = () => { edited(); setDeliverySignature(""); };
  const commit = (next: EvidenceProcurementPacket, note: string) => {
    const parsed = parseEvidenceProcurement(next); edited(); setPacket(parsed); setMessage(note);
  };
  const run = async (next: EvidenceProcurementPacket, note: string) => {
    if (operation.current) return;
    const observedRevision = revision.current; operation.current = true; setBusy(true);
    try {
      const checked = await buildEvidenceProcurement(next);
      if (revision.current === observedRevision) { setResult(checked); setMessage(note); }
    } catch { if (revision.current === observedRevision) { setResult(undefined); setMessage(errorMessage); } }
    finally { operation.current = false; setBusy(false); }
  };
  const selectOffer = async (id: string) => {
    if (!packet || operation.current) return;
    // Removing a historical proposal is allowed even after its quotation expires.
    if (packet.selectedOfferIds.includes(id)) {
      commit({ ...packet, selectedOfferIds: packet.selectedOfferIds.filter(value => value !== id) }, "Proposal selection removed. Compare again to inspect the remaining quotations.");
      return;
    }
    const observedRevision = revision.current; operation.current = true; setBusy(true);
    try {
      const refreshed = await buildEvidenceProcurement(packet);
      if (revision.current !== observedRevision) return;
      const quotation = packet.offers.find(row => row.id === id), checked = refreshed.offers.find(row => row.id === id);
      // Signature verification yields: inspect the clock again immediately before
      // the synchronous commit, rather than admitting an already expired quote.
      const admittedAt = currentObservationTime();
      if (!quotation || checked?.reason !== "eligible" || refreshed.state === "request-expired" ||
        Date.parse(packet.request.expiresAt) <= admittedAt || Date.parse(quotation.expiresAt) <= admittedAt) {
        setResult(undefined); setMessage("Quotation cannot be selected now. It expired or no longer adds eligible coverage. Compare again."); return;
      }
      commit({ ...packet, selectedOfferIds: [...packet.selectedOfferIds, id] }, "Proposal selection changed. Compare again before selecting another quotation.");
    } catch { if (revision.current === observedRevision) { setResult(undefined); setMessage(errorMessage); } }
    finally { operation.current = false; setBusy(false); }
  };
  const readJson = (text: string): unknown => {
    if (new TextEncoder().encode(text).length > MAX_PROCUREMENT_BYTES) throw new Error();
    return JSON.parse(text);
  };
  const prepareRestore = async (text: string) => {
    edited(); const observedRevision = revision.current;
    try {
      const candidate = parseEvidenceProcurement(readJson(text)); await buildEvidenceProcurement(candidate);
      if (revision.current === observedRevision) { setRestore(candidate); setMessage("Packet validated. Inspect the summary before replacing this tab's work."); }
    } catch { if (revision.current === observedRevision) setMessage("Unsupported or invalid packet. Existing work has been kept."); }
  };
  const draftOffer = (): ProcurementOffer => {
    if (!packet) throw new Error();
    const offer = { id: offerId, requestHash: procurementRequestHash(packet.request), providerWallet, sourceUrl, deliverable,
      priceMicroUsdc: toMicros(price), requirementIds: offerRequirements, expiresAt: expiry(offerExpiry), nonce,
      ...(offerSignature ? { signature: offerSignature } : {}) };
    return parseEvidenceProcurement({ ...packet, offers: [offer], selectedOfferIds: [], deliveries: [], reviews: [] }).offers[0];
  };
  const chosenOffer = packet?.offers.find(row => row.id === deliveryOfferId);
  const draftDelivery = (): ProcurementDelivery => {
    if (!chosenOffer) throw new Error();
    const delivery = { offerId: chosenOffer.id, offerHash: procurementOfferHash(chosenOffer), body, bodyHash: procurementBodyHash(body), excerpts,
      ...(deliverySignature ? { signature: deliverySignature } : {}) };
    return parseEvidenceProcurement({ ...packet, deliveries: [delivery], reviews: [] }).deliveries[0];
  };
  const addOffer = (input: unknown) => {
    if (!packet) throw new Error();
    const candidate = parseEvidenceProcurement({ ...packet, offers: [input], selectedOfferIds: [], deliveries: [], reviews: [] }).offers[0];
    const existing = packet.offers.find(row => row.id === candidate.id);
    if (existing && (existing.signature || !candidate.signature || procurementOfferHash(existing) !== procurementOfferHash(candidate))) throw new Error();
    commit({ ...packet, offers: existing ? packet.offers.map(row => row.id === candidate.id ? candidate : row) : [...packet.offers, candidate] },
      existing ? "Matching unsigned quotation upgraded with its provider signature. Compare to verify it." : "Quotation added. Compare to verify its signature and proposed coverage.");
  };
  const addDelivery = (input: unknown) => {
    if (!packet) throw new Error();
    const candidate = parseEvidenceProcurement({ ...packet, deliveries: [input], reviews: [] }).deliveries[0];
    const existing = packet.deliveries.find(row => row.offerId === candidate.offerId);
    if (existing && (existing.signature || !candidate.signature || procurementDeliveryHash(existing) !== procurementDeliveryHash(candidate))) throw new Error();
    commit({ ...packet, deliveries: existing ? packet.deliveries.map(row => row.offerId === candidate.offerId ? candidate : row) : [...packet.deliveries, candidate] },
      existing ? "Matching unsigned delivery upgraded with its provider signature. Compare to authenticate its bytes." : "Delivery added. Compare to authenticate supplied bytes before recording a review.");
  };
  const downloadProviderData = (kind: "offer" | "delivery") => {
    try { const value = kind === "offer" ? draftOffer() : draftDelivery();
      downloadBrowserText(JSON.stringify(value), `private-provider-${kind}.json`, "application/json");
      setMessage("Private provider fields downloaded. The provider must sign the matching canonical message; importing a signature authenticates no payment.");
    } catch { setMessage(errorMessage); }
  };
  const downloadSigningMessage = (kind: "offer" | "delivery") => {
    try {
      if (!packet) throw new Error();
      const content = kind === "offer" ? procurementOfferMessage(packet.request, draftOffer())
        : procurementDeliveryMessage(packet.request, chosenOffer!, draftDelivery());
      downloadBrowserText(content, `keryx-${kind}-signing-message.txt`, "text/plain;charset=utf-8");
      setMessage("Downloaded the exact signing message. This message authorizes no payment. Keep its matching unsigned packet fields unchanged.");
    } catch { setMessage(errorMessage); }
  };
  const sign = async (kind: "offer" | "delivery") => {
    if (!signer || !packet || operation.current) return;
    const observedRevision = revision.current; operation.current = true; setBusy(true);
    try {
      const wallet = kind === "offer" ? providerWallet : chosenOffer?.providerWallet;
      if (wallet?.toLowerCase() !== signer.address.toLowerCase()) throw new Error();
      const text = kind === "offer" ? procurementOfferMessage(packet.request, draftOffer()) : procurementDeliveryMessage(packet.request, chosenOffer!, draftDelivery());
      const signature = await signer.signMessage(text);
      if (revision.current === observedRevision) {
        if (kind === "offer") setOfferSignature(signature); else setDeliverySignature(signature);
        setMessage("Provider message signed. Add it to the packet, then compare to verify the signature.");
      }
    } catch { if (revision.current === observedRevision) setMessage("Message was not signed. Use the provider's matching wallet and unchanged fields."); }
    finally { operation.current = false; setBusy(false); }
  };
  const replacePacket = () => {
    if (!restore) return; const next = restore; commit(next, "Restored the validated private packet. Compare again to inspect current expiry and signatures.");
    setRequestId(next.request.id); setDecision(next.request.decision); setNetwork(next.request.network);
    setBudget(String(Number(next.request.budgetMicroUsdc) / 1e6)); setRequestExpiry(next.request.expiresAt.slice(0, 16)); setRequirements(next.request.requirements);
    setDeliveryOfferId(""); setBody(""); setExcerpts([]); setExcerptRequirement(""); setDeliverySignature(""); setReviewer(""); setReviewIds({}); setReviewNotes({});
    let nextOffer = 1; while (next.offers.some(row => row.id === `offer${nextOffer}`)) nextOffer++;
    setOfferId(`offer${nextOffer}`); setProviderWallet(""); setSourceUrl(""); setDeliverable(""); setPrice("0.01"); setOfferExpiry(""); setNonce("");
    setOfferRequirements([]); setOfferSignature(""); setImportJson(""); setOfferJson(""); setDeliveryJson("");
  };

  return <section className="mt-8 space-y-6" aria-label="Private evidence procurement workspace">
    <div className="border-l-2 border-seal pl-4">
      <p className="font-serif text-sm leading-relaxed text-ink-2">Prepare an evidence request, compare provider quotations, and inspect the exact evidence supplied for your decision.</p>
      <p className="mt-2 font-serif text-sm text-ink-2">Work stays in this tab&apos;s memory and is lost on reload. Exports are private plaintext files: they contain your question, provider details and supplied text.</p>
      <p className="mt-2 font-serif text-xs leading-relaxed text-ink-3">{PROCUREMENT_NOTICE}</p>
    </div>
    <ol className="grid gap-2 font-mono text-xs text-ink-2 sm:grid-cols-4" aria-label="Procurement steps">
      {["1 · Define what is missing", "2 · Collect quotations", "3 · Inspect evidence", "4 · Record your decision"].map(text => <li key={text} className="border border-line px-3 py-3">{text}</li>)}
    </ol>
    <p role="status" aria-live="polite" className="whitespace-pre-wrap font-serif text-sm text-seal">{message}</p>

    <form className={panel} onSubmit={event => {
      event.preventDefault();
      try { commit({ version: 1, scope: "private-evidence-procurement", request: { id: requestId, network, decision, budgetMicroUsdc: toMicros(budget),
        expiresAt: expiry(requestExpiry), requirements }, offers: [], selectedOfferIds: [], deliveries: [], reviews: [] }, "Request prepared. Export it for providers or add a quotation below.");
        setOfferRequirements([]); setDeliveryOfferId(""); setExcerpts([]); setBody(""); setOfferSignature(""); setDeliverySignature("");
        setReviewer(""); setReviewIds({}); setReviewNotes({}); setOfferJson(""); setDeliveryJson("");
      } catch { setMessage(errorMessage); }
    }}>
      <h2 className="font-display text-2xl text-ink">1. Define the evidence you need</h2>
      <p className="mt-2 font-serif text-sm text-ink-2">Name a decision and the missing facts that could change it. Priority is your declaration, from 1 to 10.</p>
      <div className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2">
        <label className={label}>Request identifier<input className={field} value={requestId} maxLength={80} required onChange={event => { setRequestId(event.target.value); edited(); }} /></label>
        <label className={label}>Network for quotation context<select aria-label="Network for quotation context" className={field} value={network} onChange={event => { setNetwork(event.target.value as typeof network); edited(); }}>
          <option value="eip155:5042">Arc mainnet — quotation only</option><option value="eip155:5042002">Arc testnet — quotation only</option></select></label>
      </div>
      <label className={`${label} mt-4`}>What decision are you trying to make?<textarea aria-label="What decision are you trying to make?" className={field} rows={3} value={decision} maxLength={4000} required onChange={event => { setDecision(event.target.value); edited(); }} /></label>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className={label}>Maximum quote budget (USDC)<input className={field} inputMode="decimal" value={budget} required onChange={event => { setBudget(event.target.value); edited(); }} /></label>
        <label className={label}>Request expiry (UTC)<input className={field} type="datetime-local" value={requestExpiry} required onChange={event => { setRequestExpiry(event.target.value); edited(); }} /></label>
      </div>
      <div className="mt-5 space-y-4">{requirements.map((row, index) => <fieldset key={row.id} className="min-w-0 border-t border-line pt-4">
        <legend className="font-mono text-xs text-ink-3">Requirement {index + 1} · {row.id}</legend>
        <label className={label}>Evidence question {index + 1}<textarea aria-label={`Evidence question ${index + 1}`} className={field} rows={2} value={row.question} maxLength={2000} required onChange={event => {
          setRequirements(requirements.map((entry, at) => at === index ? { ...entry, question: event.target.value } : entry)); edited();
        }} /></label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className={label}>Priority {index + 1}<select aria-label={`Priority ${index + 1}`} className={field} value={row.priority} onChange={event => {
          setRequirements(requirements.map((entry, at) => at === index ? { ...entry, priority: Number(event.target.value) } : entry)); edited();
        }}>{Array.from({ length: 10 }, (_, at) => at + 1).map(value => <option key={value}>{value}</option>)}</select></label>
        <label className={label}>Evidence status {index + 1}<select aria-label={`Evidence status ${index + 1}`} className={field} value={row.status} onChange={event => {
          setRequirements(requirements.map((entry, at) => at === index ? { ...entry, status: event.target.value as RequirementDraft["status"] } : entry)); edited();
        }}><option value="missing">Missing — request new evidence</option><option value="covered">Already covered — your declaration</option></select></label></div>
        {requirements.length > 1 && <button type="button" className={`${button} mt-3`} onClick={() => { setRequirements(requirements.filter((_, at) => at !== index)); edited(); }}>Remove requirement {index + 1}</button>}
      </fieldset>)}</div>
      <div className="mt-5 flex flex-wrap gap-3"><button type="button" className={button} disabled={requirements.length >= 16} onClick={() => {
        let next = 1; while (requirements.some(row => row.id === `requirement${next}`)) next++;
        setRequirements([...requirements, { id: `requirement${next}`, question: "", priority: 5, status: "missing" }]); edited();
      }}>Add evidence requirement</button>
      <button type="submit" className={`${button} bg-ink text-paper`}>{packet ? "Replace request and clear quotations" : "Prepare evidence request"}</button></div>
      {packet && <p className="mt-3 font-serif text-xs text-ink-3">Replacing the request clears all quotations, deliveries, selections and reviews, because their signatures bind the original request.</p>}
    </form>

    {packet && <>
      <section className={panel} aria-label="Prepared request">
        <h2 className="font-display text-xl text-ink">Prepared request: {packet.request.id}</h2>
        <p className="mt-2 whitespace-pre-wrap font-serif text-sm">{packet.request.decision}</p>
        <p className="mt-3 font-mono text-xs text-ink-2">Quote cap {amount(packet.request.budgetMicroUsdc)} · {packet.request.network} · expires {packet.request.expiresAt}</p>
        <p className="mt-2 break-all font-mono text-xs text-ink-3">Request hash {procurementRequestHash(packet.request)}</p>
        <ul className="mt-3 space-y-2 font-serif text-sm">{packet.request.requirements.map(row => <li key={row.id}>{row.id}: {row.question} <span className="font-mono text-xs text-ink-3">· {row.status}, priority {row.priority}</span></li>)}</ul>
      </section>

      <form className={panel} onSubmit={event => { event.preventDefault(); try {
        addOffer(draftOffer());
        setOfferSignature("");
      } catch { setMessage(errorMessage); } }}>
        <h2 className="font-display text-2xl text-ink">2. Collect provider quotations</h2>
        <p className="mt-2 font-serif text-sm text-ink-2">A provider promises a deliverable and coverage. A valid provider signature authenticates that promise; it does not prove ownership of the linked source.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className={label}>Offer identifier<input className={field} value={offerId} maxLength={80} required onChange={event => { setOfferId(event.target.value); offerEdited(); }} /></label>
          <label className={label}>Provider wallet<input className={field} value={providerWallet} maxLength={42} required onChange={event => { setProviderWallet(event.target.value); offerEdited(); }} /></label></div>
        <label className={`${label} mt-4`}>Source or delivery URL (HTTPS)<input className={field} type="url" value={sourceUrl} maxLength={2048} required onChange={event => { setSourceUrl(event.target.value); offerEdited(); }} /></label>
        <label className={`${label} mt-4`}>What will the provider deliver?<textarea aria-label="What will the provider deliver?" className={field} rows={3} value={deliverable} maxLength={2000} required onChange={event => { setDeliverable(event.target.value); offerEdited(); }} /></label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className={label}>Quoted price (USDC)<input className={field} inputMode="decimal" value={price} required onChange={event => { setPrice(event.target.value); offerEdited(); }} /></label>
          <label className={label}>Offer expiry (UTC)<input className={field} type="datetime-local" value={offerExpiry} required onChange={event => { setOfferExpiry(event.target.value); offerEdited(); }} /></label></div>
        <label className={`${label} mt-4`}>Provider nonce (unique for this wallet)<input className={field} value={nonce} maxLength={80} required onChange={event => { setNonce(event.target.value); offerEdited(); }} /></label>
        <fieldset className="mt-4 min-w-0"><legend className={label}>Requirements the provider promises to address</legend>
          {packet.request.requirements.map(row => <label key={row.id} className="mt-2 flex min-h-11 items-center gap-3 font-serif text-sm"><input type="checkbox" checked={offerRequirements.includes(row.id)} onChange={() => { setOfferRequirements(toggle(offerRequirements, row.id)); offerEdited(); }} /><span>{row.id}: {row.question}</span></label>)}
        </fieldset>
        <label className={`${label} mt-4`}>Offer signature (optional for a draft)<input className={field} value={offerSignature} maxLength={132} spellCheck={false} onChange={event => { edited(); setOfferSignature(event.target.value); }} /></label>
        <div className="mt-4 flex flex-wrap gap-3"><button type="submit" className={button} disabled={packet.offers.length >= 16}>Add provider quotation</button>
          <button type="button" className={button} onClick={() => downloadSigningMessage("offer")}>Download offer signing message</button>
          <button type="button" className={button} onClick={() => downloadProviderData("offer")}>Download provider offer JSON</button>
          {signer && <button type="button" className={button} disabled={busy} onClick={() => { void sign("offer"); }}>Sign offer message</button>}</div>
        <details className="mt-5"><summary className="cursor-pointer font-mono text-xs underline">Import a provider&apos;s offer JSON instead</summary>
          <label className={`${label} mt-3`}>Provider offer JSON<textarea aria-label="Provider offer JSON" className={field} rows={4} maxLength={MAX_PROCUREMENT_BYTES} value={offerJson} spellCheck={false} onChange={event => { setOfferJson(event.target.value); edited(); }} /></label>
          <button type="button" className={`${button} mt-3`} onClick={() => { try {
            addOffer(readJson(offerJson)); setOfferJson("");
          } catch { setMessage(errorMessage); } }}>Import provider offer</button>
        </details>
      </form>

      <section className={panel} aria-label="Quotation comparison">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-display text-2xl text-ink">Compare before selecting</h2>
          <button type="button" className={`${button} bg-ink text-paper`} disabled={busy} onClick={() => { void run(packet, "Comparison recomputed from the current packet. Selection remains a proposal only."); }}>Compare current quotations</button></div>
        {!packet.offers.length && <p className="mt-4 font-serif text-sm text-ink-2">No quotations yet. Add one above or import a signed provider offer.</p>}
        {!result && !!packet.offers.length && <p className="mt-4 font-serif text-sm text-ink-2">Compare to inspect signatures, remaining budget and the next recommendation.</p>}
        {packet.offers.map((offer, index) => {
          const checked = result?.offers.find(row => row.id === offer.id);
          return <article key={`${offer.id}:${index}`} className="mt-5 min-w-0 border-t border-line pt-4" aria-label={`Quotation ${offer.id}`}>
            <h3 className="font-display text-lg">{offer.id} · {amount(offer.priceMicroUsdc)}</h3>
            <p className="mt-2 whitespace-pre-wrap font-serif text-sm">{offer.deliverable}</p>
            <p className="mt-2 break-all font-mono text-xs text-ink-3">Provider {offer.providerWallet}</p>
            <p className="mt-2 break-all font-serif text-xs text-ink-2">Supplied link: {offer.sourceUrl}</p>
            <p className="mt-2 font-mono text-xs">Proposed coverage: {offer.requirementIds.join(", ")} · expires {offer.expiresAt}</p>
            {checked && <p className="mt-2 font-serif text-sm text-seal">{readableReason(checked.reason)}</p>}
            {result?.recommendation?.offerId === offer.id && <p className="mt-2 font-serif text-sm text-seal">Recommended next: highest declared missing priority per micro-USDC. This compares promises, not delivered quality.</p>}
            <div className="mt-3 flex flex-wrap gap-3"><button type="button" className={button} disabled={busy || (!packet.selectedOfferIds.includes(offer.id) && (!checked || checked.reason !== "eligible" || result?.state === "request-expired"))} onClick={() => { void selectOffer(offer.id); }}>
              {packet.selectedOfferIds.includes(offer.id) ? `Remove selection ${offer.id}` : `Select proposal ${offer.id}`}</button>
            <button type="button" className={button} onClick={() => { commit({ ...packet, offers: packet.offers.filter(row => row.id !== offer.id), selectedOfferIds: packet.selectedOfferIds.filter(id => id !== offer.id), deliveries: packet.deliveries.filter(row => row.offerId !== offer.id), reviews: packet.reviews.filter(row => row.offerId !== offer.id) }, "Quotation and its dependent delivery/review removed."); }}>Remove quotation {offer.id}</button></div>
          </article>;
        })}
        {result && <div className="mt-5 border-t border-line pt-4 font-mono text-xs text-ink-2">
          <p className="mb-2">Current proposal state: {readableReason(result.state)}</p>
          <p>Planned quote total: {amount(result.quoteBudget.plannedMicroUsdc)} · remaining: {amount(result.quoteBudget.remainingMicroUsdc)}</p>
          <p className="mt-2">Still missing according to caller review: {result.missingRequirementIds.join(", ") || "none"}</p>
          <p className="mt-2">Payment: not observed. No funds reserved or spent.</p>
        </div>}
      </section>

      <form className={panel} onSubmit={event => { event.preventDefault(); try {
        addDelivery(draftDelivery());
      } catch { setMessage(errorMessage); } }}>
        <h2 className="font-display text-2xl text-ink">3. Inspect delivered evidence</h2>
        <p className="mt-2 font-serif text-sm text-ink-2">Paste supplied text, highlight an exact passage, then attach its provider-declared stance to a requirement. Changing the text clears its excerpts and signature.</p>
        <label className={`${label} mt-5`}>Delivery for quotation<select aria-label="Delivery for quotation" className={field} value={deliveryOfferId} onChange={event => { setDeliveryOfferId(event.target.value); setBody(""); setExcerpts([]); setExcerptRequirement(""); deliveryEdited(); }}>
          <option value="">Choose a quotation</option>{packet.offers.map(row => <option key={row.id} value={row.id}>{row.id}: {row.deliverable.slice(0, 80)}</option>)}</select></label>
        <label className={`${label} mt-4`}>Supplied delivery text<textarea aria-label="Supplied delivery text" ref={bodyRef} className={field} rows={7} maxLength={40000} value={body} onChange={event => { setBody(event.target.value); setExcerpts([]); deliveryEdited(); }} /></label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className={label}>Requirement for highlighted passage<select aria-label="Requirement for highlighted passage" className={field} value={excerptRequirement} onChange={event => { setExcerptRequirement(event.target.value); edited(); }}>
          <option value="">Choose a requirement</option>{packet.request.requirements.filter(row => chosenOffer?.requirementIds.includes(row.id)).map(row => <option key={row.id} value={row.id}>{row.id}: {row.question.slice(0, 100)}</option>)}</select></label>
          <label className={label}>Provider-declared stance<select aria-label="Provider-declared stance" className={field} value={stance} onChange={event => { setStance(event.target.value as typeof stance); edited(); }}>
            <option value="supports">Supports</option><option value="refutes">Refutes</option><option value="inconclusive">Inconclusive</option></select></label></div>
        <button type="button" className={`${button} mt-3`} disabled={!chosenOffer || !excerptRequirement} onClick={() => {
          const element = bodyRef.current;
          if (!element || element.selectionStart === element.selectionEnd) { setMessage("Highlight an exact passage in the supplied delivery text first."); return; }
          setExcerpts([...excerpts.filter(row => row.requirementId !== excerptRequirement), { requirementId: excerptRequirement, start: element.selectionStart, end: element.selectionEnd, stance }]); deliveryEdited();
        }}>Attach highlighted passage</button>
        {excerpts.map(row => <blockquote className="mt-4 min-w-0 border-l-2 border-seal pl-3" key={row.requirementId}>
          <p className="whitespace-pre-wrap break-words font-serif text-sm">{body.slice(row.start, row.end)}</p><p className="mt-2 font-mono text-xs text-ink-3">{row.requirementId} · provider declares {row.stance} · characters {row.start}–{row.end}</p>
        </blockquote>)}
        <label className={`${label} mt-4`}>Delivery signature (optional for a draft)<input className={field} maxLength={132} value={deliverySignature} spellCheck={false} onChange={event => { edited(); setDeliverySignature(event.target.value); }} /></label>
        <div className="mt-4 flex flex-wrap gap-3"><button type="submit" className={button} disabled={!chosenOffer || !excerpts.length}>Add supplied delivery</button>
          <button type="button" className={button} disabled={!chosenOffer || !excerpts.length} onClick={() => downloadSigningMessage("delivery")}>Download delivery signing message</button>
          <button type="button" className={button} disabled={!chosenOffer || !excerpts.length} onClick={() => downloadProviderData("delivery")}>Download provider delivery JSON</button>
          {signer && <button type="button" className={button} disabled={busy || !chosenOffer || !excerpts.length} onClick={() => { void sign("delivery"); }}>Sign delivery message</button>}</div>
        <details className="mt-5"><summary className="cursor-pointer font-mono text-xs underline">Import a provider&apos;s delivery JSON instead</summary>
          <label className={`${label} mt-3`}>Provider delivery JSON<textarea aria-label="Provider delivery JSON" className={field} rows={4} maxLength={MAX_PROCUREMENT_BYTES} value={deliveryJson} spellCheck={false} onChange={event => { setDeliveryJson(event.target.value); edited(); }} /></label>
          <button type="button" className={`${button} mt-3`} onClick={() => { try {
            addDelivery(readJson(deliveryJson)); setDeliveryJson("");
          } catch { setMessage(errorMessage); } }}>Import provider delivery</button>
        </details>
      </form>

      <section className={panel} aria-label="Caller evidence review">
        <h2 className="font-display text-2xl text-ink">4. Record your evidence review</h2>
        <p className="mt-2 font-serif text-sm text-ink-2">Read each exact excerpt. You may declare a supporting or refuting passage useful to your decision. This is your review, not independent truth validation, customer acceptance or payment authority.</p>
        <label className={`${label} mt-4`}>Reviewer name or identifier<input className={field} maxLength={120} value={reviewer} onChange={event => { setReviewer(event.target.value); edited(); }} /></label>
        {!result && <p className="mt-4 font-serif text-sm text-ink-2">Compare the current packet to inspect and review deliveries.</p>}
        {result?.deliveries.map((delivery, index) => <article className="mt-5 border-t border-line pt-4" key={`${delivery.offerId}:${index}`} aria-label={`Delivery review ${delivery.offerId}`}>
          <h3 className="font-display text-lg">Delivery for {delivery.offerId}</h3>
          <p className="mt-2 font-serif text-sm text-seal">{readableReason(delivery.reason)}</p>
          {delivery.excerpts.map(excerpt => <div className="mt-4" key={excerpt.requirementId}>
            <blockquote className="whitespace-pre-wrap break-words border-l-2 border-seal pl-3 font-serif text-sm">{excerpt.text}</blockquote>
            <p className="mt-2 font-mono text-xs text-ink-3">{excerpt.requirementId} · provider declares {excerpt.stance} · exact supplied slice</p>
            <label className="mt-2 flex min-h-11 items-center gap-3 font-serif text-sm"><input type="checkbox" disabled={excerpt.stance === "inconclusive"} checked={(reviewIds[delivery.offerId] ?? []).includes(excerpt.requirementId)} onChange={() => { setReviewIds({ ...reviewIds, [delivery.offerId]: toggle(reviewIds[delivery.offerId] ?? [], excerpt.requirementId) }); }} />I reviewed {excerpt.requirementId} as useful {excerpt.stance === "refutes" ? "refuting" : excerpt.stance === "supports" ? "supporting" : "inconclusive"} evidence</label>
          </div>)}
          <label className={`${label} mt-4`}>Review note for {delivery.offerId}<textarea aria-label={`Review note for ${delivery.offerId}`} className={field} maxLength={2000} rows={3} value={reviewNotes[delivery.offerId] ?? ""} onChange={event => setReviewNotes({ ...reviewNotes, [delivery.offerId]: event.target.value })} /></label>
          <button type="button" className={`${button} mt-3`} disabled={delivery.reason !== "attributed-bytes" || !reviewer.trim() || !(reviewNotes[delivery.offerId] ?? "").trim()} onClick={() => { try {
            const original = packet.deliveries.find(row => row.offerId === delivery.offerId)!;
            commit({ ...packet, reviews: [...packet.reviews.filter(row => row.offerId !== delivery.offerId), { offerId: delivery.offerId, deliveryHash: procurementDeliveryHash(original), acceptedRequirementIds: reviewIds[delivery.offerId] ?? [], reviewer, reviewerNote: reviewNotes[delivery.offerId] }] }, "Caller review recorded. Compare again to build an updated decision receipt.");
          } catch { setMessage(errorMessage); } }}>Record caller review {delivery.offerId}</button>
          <button type="button" className={`${button} ml-3 mt-3`} onClick={() => {
            commit({ ...packet, deliveries: packet.deliveries.filter(row => row.offerId !== delivery.offerId), reviews: packet.reviews.filter(row => row.offerId !== delivery.offerId) }, "Delivery and its dependent review removed.");
          }}>Remove delivery {delivery.offerId}</button>
        </article>)}
        {!!result?.reviews.length && <ul className="mt-5 space-y-3 font-serif text-sm">{result.reviews.map((row, index) => <li key={`${row.offerId}:${index}`} className="border-t border-line pt-3"><p>{row.offerId}: {readableReason(row.reason)} · {row.reviewer}</p><p className="mt-1 whitespace-pre-wrap">{row.reviewerNote}</p><p className="mt-1 font-mono text-xs">Caller-reviewed requirements: {row.acceptedRequirementIds.join(", ") || "none"}</p></li>)}</ul>}
      </section>
    </>}

    <section className={panel} aria-label="Private packet export and restore">
      <h2 className="font-display text-xl">Keep or restore this work</h2>
      <p className="mt-2 font-serif text-sm text-ink-2">Download the packet to continue later or share selected private fields deliberately. Only the packet can be restored; a decision receipt is a dated inspection result.</p>
      <div className="mt-4 flex flex-wrap gap-3"><button type="button" className={button} disabled={!packet} onClick={() => {
        if (!packet) return; downloadBrowserText(JSON.stringify(parseEvidenceProcurement(packet)), "private-evidence-procurement-packet.json", "application/json"); setMessage("Private plaintext packet downloaded. Store it securely; this tab has no persistent save.");
      }}>Download private plaintext packet</button>
      <button type="button" className={button} disabled={!result || busy} onClick={() => {
        if (!result) return; downloadBrowserText(JSON.stringify(result, null, 2) + "\n", "private-evidence-procurement-receipt.json", "application/json"); setMessage("Private plaintext decision receipt downloaded. Its caller reviews and unobserved payment status remain explicit.");
      }}>Download decision receipt</button>
      <button type="button" className={button} onClick={() => {
        edited(); setPacket(undefined); setRequestId("request1"); setDecision(""); setNetwork("eip155:5042"); setBudget("0.05"); setRequestExpiry(""); setRequirements([{ id: "requirement1", question: "", priority: 10, status: "missing" }]);
        setOfferId("offer1"); setProviderWallet(""); setSourceUrl(""); setDeliverable(""); setPrice("0.01"); setNonce(""); setOfferExpiry(""); setOfferRequirements([]); setOfferSignature("");
        setDeliveryOfferId(""); setBody(""); setExcerpts([]); setExcerptRequirement(""); setStance("supports"); setDeliverySignature(""); setReviewer(""); setReviewIds({}); setReviewNotes({});
        setImportJson(""); setOfferJson(""); setDeliveryJson(""); setMessage("Packet and private form text cleared from this tab. Downloaded files are unchanged.");
      }}>Clear tab packet</button></div>
      <label className={`${label} mt-5`}>Restore private packet file (JSON, up to 64 KiB)<input className={`${field} py-3`} type="file" accept=".json,application/json" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (!file) return;
        if (file.size > MAX_PROCUREMENT_BYTES) { setMessage("Packet file exceeds the supported limit. Existing work has been kept."); return; }
        edited(); const uploadRevision = revision.current;
        void file.text().then(text => { if (revision.current === uploadRevision) return prepareRestore(text); }).catch(() => {
          if (revision.current === uploadRevision) setMessage("Could not read this packet file. Existing work has been kept.");
        });
      }} /></label>
      <details className="mt-4"><summary className="cursor-pointer font-mono text-xs underline">Paste private packet JSON</summary>
        <label className={`${label} mt-3`}>Private packet JSON<textarea aria-label="Private packet JSON" className={field} rows={5} value={importJson} maxLength={MAX_PROCUREMENT_BYTES} spellCheck={false} onChange={event => { setImportJson(event.target.value); edited(); }} /></label>
        <button type="button" className={`${button} mt-3`} onClick={() => { void prepareRestore(importJson); }}>Validate packet for restore</button>
      </details>
      {restore && <section className="mt-5 border border-seal p-4" aria-label="Validated restore preview">
        <p className="font-serif text-sm">Replace this tab with request {restore.request.id}: {restore.request.decision}</p>
        <p className="mt-2 font-mono text-xs">{restore.offers.length} quotations · {restore.deliveries.length} deliveries · {restore.reviews.length} caller reviews · quote cap {amount(restore.request.budgetMicroUsdc)}</p>
        <div className="mt-3 flex flex-wrap gap-3"><button type="button" className={button} onClick={replacePacket}>Replace tab with validated packet</button><button type="button" className={button} onClick={() => { setRestore(undefined); setMessage("Restore cancelled. Existing work has been kept."); }}>Cancel packet restore</button></div>
      </section>}
    </section>
  </section>;
}
