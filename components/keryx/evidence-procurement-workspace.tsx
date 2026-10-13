"use client";

import { useEffect, useRef, useState } from "react";
import { evidenceProcurementCopy as copy, evidenceProcurementCopyText as copyText } from "@/lib/evidence-procurement/copy";
import { downloadBrowserText } from "@/lib/browser-text-download";
import { MAX_PROCUREMENT_BYTES, parseEvidenceProcurement, type EvidenceProcurementPacket, type ProcurementOffer, type ProcurementDelivery } from "@/lib/evidence-procurement/contracts";
import { buildEvidenceProcurement, PROCUREMENT_NOTICE, procurementRequestHash, procurementBodyHash, procurementOfferHash, procurementDeliveryHash,
  procurementOfferMessage, procurementDeliveryMessage, type EvidenceProcurementResult } from "@/lib/evidence-procurement/engine";

const field = "mt-2 block w-full min-w-0 border border-line bg-paper px-3 py-2 font-serif text-sm text-ink";
const button = "inline-flex min-h-11 items-center justify-center border border-ink px-3 py-2 font-mono text-xs text-ink disabled:cursor-not-allowed disabled:opacity-50";
const label = "block font-mono text-xs text-ink-2";
const panel = "min-w-0 border border-line bg-paper p-4 sm:p-6";
const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(row => row !== value) : [...values, value];
const amount = (micros: string) => copyText(copy.templates.amount, { whole: Math.floor(Number(micros) / 1e6), fraction: String(Number(micros) % 1e6).padStart(6, "0") });
const toMicros = (value: string) => {
  if (!/^(0|[1-9][0-9]{0,3})(\.[0-9]{1,6})?$/.test(value)) throw new Error(copy.messages.amountFormat);
  const [whole, fraction = ""] = value.split(".");
  return String(BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0")));
};
const expiry = (value: string) => new Date(`${value}:00Z`).toISOString();
const errorMessage = copy.messages.validationFailed;
type RequirementDraft = EvidenceProcurementPacket["request"]["requirements"][number];
type Signer = { address: string; signMessage: (message: string) => Promise<string> };
const reasonText: Record<string, string> = copy.reasons;
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
      commit({ ...packet, selectedOfferIds: packet.selectedOfferIds.filter(value => value !== id) }, copy.messages.selectionRemoved);
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
        setResult(undefined); setMessage(copy.messages.selectionRefused); return;
      }
      commit({ ...packet, selectedOfferIds: [...packet.selectedOfferIds, id] }, copy.messages.selectionChanged);
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
      if (revision.current === observedRevision) { setRestore(candidate); setMessage(copy.messages.restoreValidated); }
    } catch { if (revision.current === observedRevision) setMessage(copy.messages.restoreRefused); }
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
      existing ? copy.messages.offerSignatureAdded : copy.messages.offerAdded);
  };
  const addDelivery = (input: unknown) => {
    if (!packet) throw new Error();
    const candidate = parseEvidenceProcurement({ ...packet, deliveries: [input], reviews: [] }).deliveries[0];
    const existing = packet.deliveries.find(row => row.offerId === candidate.offerId);
    if (existing && (existing.signature || !candidate.signature || procurementDeliveryHash(existing) !== procurementDeliveryHash(candidate))) throw new Error();
    commit({ ...packet, deliveries: existing ? packet.deliveries.map(row => row.offerId === candidate.offerId ? candidate : row) : [...packet.deliveries, candidate] },
      existing ? copy.messages.deliverySignatureAdded : copy.messages.deliveryAdded);
  };
  const downloadProviderData = (kind: "offer" | "delivery") => {
    try { const value = kind === "offer" ? draftOffer() : draftDelivery();
      downloadBrowserText(JSON.stringify(value), `private-provider-${kind}.json`, "application/json");
      setMessage(copy.messages.providerDataDownloaded);
    } catch { setMessage(errorMessage); }
  };
  const downloadSigningMessage = (kind: "offer" | "delivery") => {
    try {
      if (!packet) throw new Error();
      const content = kind === "offer" ? procurementOfferMessage(packet.request, draftOffer())
        : procurementDeliveryMessage(packet.request, chosenOffer!, draftDelivery());
      downloadBrowserText(content, `keryx-${kind}-signing-message.txt`, "text/plain;charset=utf-8");
      setMessage(copy.messages.signingMessageDownloaded);
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
        setMessage(copy.messages.messageSigned);
      }
    } catch { if (revision.current === observedRevision) setMessage(copy.messages.messageRefused); }
    finally { operation.current = false; setBusy(false); }
  };
  const replacePacket = () => {
    if (!restore) return; const next = restore; commit(next, copy.messages.restored);
    setRequestId(next.request.id); setDecision(next.request.decision); setNetwork(next.request.network);
    setBudget(String(Number(next.request.budgetMicroUsdc) / 1e6)); setRequestExpiry(next.request.expiresAt.slice(0, 16)); setRequirements(next.request.requirements);
    setDeliveryOfferId(""); setBody(""); setExcerpts([]); setExcerptRequirement(""); setDeliverySignature(""); setReviewer(""); setReviewIds({}); setReviewNotes({});
    let nextOffer = 1; while (next.offers.some(row => row.id === `offer${nextOffer}`)) nextOffer++;
    setOfferId(`offer${nextOffer}`); setProviderWallet(""); setSourceUrl(""); setDeliverable(""); setPrice("0.01"); setOfferExpiry(""); setNonce("");
    setOfferRequirements([]); setOfferSignature(""); setImportJson(""); setOfferJson(""); setDeliveryJson("");
  };

  return <section className="mt-8 space-y-6" aria-label={copy.workspace.privateEvidenceProcurementWorkspace}>
    <div className="border-l-2 border-seal pl-4">
      <p className="font-serif text-sm leading-relaxed text-ink-2">{copy.workspace.prepareAnEvidenceRequestCompareProviderQuotationsAndInspect}</p>
      <p className="mt-2 font-serif text-sm text-ink-2">{copy.workspace.workStaysInThisTabSMemoryAndIs}</p>
      <p className="mt-2 font-serif text-xs leading-relaxed text-ink-3">{PROCUREMENT_NOTICE}</p>
    </div>
    <ol className="grid gap-2 font-mono text-xs text-ink-2 sm:grid-cols-4" aria-label={copy.workspace.procurementSteps}>
      {copy.workspace.steps.map(text => <li key={text} className="border border-line px-3 py-3">{text}</li>)}
    </ol>
    <p role="status" aria-live="polite" className="whitespace-pre-wrap font-serif text-sm text-seal">{message}</p>

    <form className={panel} onSubmit={event => {
      event.preventDefault();
      try { commit({ version: 1, scope: "private-evidence-procurement", request: { id: requestId, network, decision, budgetMicroUsdc: toMicros(budget),
        expiresAt: expiry(requestExpiry), requirements }, offers: [], selectedOfferIds: [], deliveries: [], reviews: [] }, copy.messages.requestPrepared);
        setOfferRequirements([]); setDeliveryOfferId(""); setExcerpts([]); setBody(""); setOfferSignature(""); setDeliverySignature("");
        setReviewer(""); setReviewIds({}); setReviewNotes({}); setOfferJson(""); setDeliveryJson("");
      } catch { setMessage(errorMessage); }
    }}>
      <h2 className="font-display text-2xl text-ink">{copy.workspace.step1DefineTheEvidenceYouNeed}</h2>
      <p className="mt-2 font-serif text-sm text-ink-2">{copy.workspace.nameADecisionAndTheMissingFactsThatCould}</p>
      <div className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2">
        <label className={label}>{copy.workspace.requestIdentifier}<input className={field} value={requestId} maxLength={80} required onChange={event => { setRequestId(event.target.value); edited(); }} /></label>
        <label className={label}>{copy.workspace.networkForQuotationContext}<select aria-label={copy.workspace.networkForQuotationContext} className={field} value={network} onChange={event => { setNetwork(event.target.value as typeof network); edited(); }}>
          <option value="eip155:5042">{copy.workspace.arcMainnetQuotationOnly}</option><option value="eip155:5042002">{copy.workspace.arcTestnetQuotationOnly}</option></select></label>
      </div>
      <label className={`${label} mt-4`}>{copy.workspace.whatDecisionAreYouTryingToMake}<textarea aria-label={copy.workspace.whatDecisionAreYouTryingToMake} className={field} rows={3} value={decision} maxLength={4000} required onChange={event => { setDecision(event.target.value); edited(); }} /></label>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className={label}>{copy.workspace.maximumQuoteBudgetUSDC}<input className={field} inputMode="decimal" value={budget} required onChange={event => { setBudget(event.target.value); edited(); }} /></label>
        <label className={label}>{copy.workspace.requestExpiryUTC}<input className={field} type="datetime-local" value={requestExpiry} required onChange={event => { setRequestExpiry(event.target.value); edited(); }} /></label>
      </div>
      <div className="mt-5 space-y-4">{requirements.map((row, index) => <fieldset key={row.id} className="min-w-0 border-t border-line pt-4">
        <legend className="font-mono text-xs text-ink-3">{copyText(copy.templates.requirement, { number: index + 1, id: row.id })}</legend>
        <label className={label}>{copyText(copy.templates.question, { number: index + 1 })}<textarea aria-label={copyText(copy.templates.question, { number: index + 1 })} className={field} rows={2} value={row.question} maxLength={2000} required onChange={event => {
          setRequirements(requirements.map((entry, at) => at === index ? { ...entry, question: event.target.value } : entry)); edited();
        }} /></label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className={label}>{copyText(copy.templates.priority, { number: index + 1 })}<select aria-label={copyText(copy.templates.priority, { number: index + 1 })} className={field} value={row.priority} onChange={event => {
          setRequirements(requirements.map((entry, at) => at === index ? { ...entry, priority: Number(event.target.value) } : entry)); edited();
        }}>{Array.from({ length: 10 }, (_, at) => at + 1).map(value => <option key={value}>{value}</option>)}</select></label>
        <label className={label}>{copyText(copy.templates.status, { number: index + 1 })}<select aria-label={copyText(copy.templates.status, { number: index + 1 })} className={field} value={row.status} onChange={event => {
          setRequirements(requirements.map((entry, at) => at === index ? { ...entry, status: event.target.value as RequirementDraft["status"] } : entry)); edited();
        }}><option value="missing">{copy.workspace.missingRequestNewEvidence}</option><option value="covered">{copy.workspace.alreadyCoveredYourDeclaration}</option></select></label></div>
        {requirements.length > 1 && <button type="button" className={`${button} mt-3`} onClick={() => { setRequirements(requirements.filter((_, at) => at !== index)); edited(); }}>{copyText(copy.templates.removeRequirement, { number: index + 1 })}</button>}
      </fieldset>)}</div>
      <div className="mt-5 flex flex-wrap gap-3"><button type="button" className={button} disabled={requirements.length >= 16} onClick={() => {
        let next = 1; while (requirements.some(row => row.id === `requirement${next}`)) next++;
        setRequirements([...requirements, { id: `requirement${next}`, question: "", priority: 5, status: "missing" }]); edited();
      }}>{copy.workspace.addEvidenceRequirement}</button>
      <button type="submit" className={`${button} bg-ink text-paper`}>{packet ? copy.workspace.replaceRequestAndClearQuotations : copy.workspace.prepareEvidenceRequest}</button></div>
      {packet && <p className="mt-3 font-serif text-xs text-ink-3">{copy.workspace.replacingTheRequestClearsAllQuotationsDeliveriesSelectionsAnd}</p>}
    </form>

    {packet && <>
      <section className={panel} aria-label={copy.workspace.preparedRequest}>
        <h2 className="font-display text-xl text-ink">{copyText(copy.templates.preparedHeading, { id: packet.request.id })}</h2>
        <p className="mt-2 whitespace-pre-wrap font-serif text-sm">{packet.request.decision}</p>
        <p className="mt-3 font-mono text-xs text-ink-2">{copyText(copy.templates.requestSummary, { amount: amount(packet.request.budgetMicroUsdc), network: packet.request.network, expiresAt: packet.request.expiresAt })}</p>
        <p className="mt-2 break-all font-mono text-xs text-ink-3">{copyText(copy.templates.requestHashLine, { hash: procurementRequestHash(packet.request) })}</p>
        <ul className="mt-3 space-y-2 font-serif text-sm">{packet.request.requirements.map(row => <li key={row.id}>{row.id}: {row.question} <span className="font-mono text-xs text-ink-3">{copyText(copy.templates.requirementStatus, { status: row.status, priority: row.priority })}</span></li>)}</ul>
      </section>

      <form className={panel} onSubmit={event => { event.preventDefault(); try {
        addOffer(draftOffer());
        setOfferSignature("");
      } catch { setMessage(errorMessage); } }}>
        <h2 className="font-display text-2xl text-ink">{copy.workspace.step2CollectProviderQuotations}</h2>
        <p className="mt-2 font-serif text-sm text-ink-2">{copy.workspace.aProviderPromisesADeliverableAndCoverageAValid}</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className={label}>{copy.workspace.offerIdentifier}<input className={field} value={offerId} maxLength={80} required onChange={event => { setOfferId(event.target.value); offerEdited(); }} /></label>
          <label className={label}>{copy.workspace.providerWallet}<input className={field} value={providerWallet} maxLength={42} required onChange={event => { setProviderWallet(event.target.value); offerEdited(); }} /></label></div>
        <label className={`${label} mt-4`}>{copy.workspace.sourceOrDeliveryURLHTTPS}<input className={field} type="url" value={sourceUrl} maxLength={2048} required onChange={event => { setSourceUrl(event.target.value); offerEdited(); }} /></label>
        <label className={`${label} mt-4`}>{copy.workspace.whatWillTheProviderDeliver}<textarea aria-label={copy.workspace.whatWillTheProviderDeliver} className={field} rows={3} value={deliverable} maxLength={2000} required onChange={event => { setDeliverable(event.target.value); offerEdited(); }} /></label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className={label}>{copy.workspace.quotedPriceUSDC}<input className={field} inputMode="decimal" value={price} required onChange={event => { setPrice(event.target.value); offerEdited(); }} /></label>
          <label className={label}>{copy.workspace.offerExpiryUTC}<input className={field} type="datetime-local" value={offerExpiry} required onChange={event => { setOfferExpiry(event.target.value); offerEdited(); }} /></label></div>
        <label className={`${label} mt-4`}>{copy.workspace.providerNonceUniqueForThisWallet}<input className={field} value={nonce} maxLength={80} required onChange={event => { setNonce(event.target.value); offerEdited(); }} /></label>
        <fieldset className="mt-4 min-w-0"><legend className={label}>{copy.workspace.requirementsTheProviderPromisesToAddress}</legend>
          {packet.request.requirements.map(row => <label key={row.id} className="mt-2 flex min-h-11 items-center gap-3 font-serif text-sm"><input type="checkbox" checked={offerRequirements.includes(row.id)} onChange={() => { setOfferRequirements(toggle(offerRequirements, row.id)); offerEdited(); }} /><span>{row.id}: {row.question}</span></label>)}
        </fieldset>
        <label className={`${label} mt-4`}>{copy.workspace.offerSignatureOptionalForADraft}<input className={field} value={offerSignature} maxLength={132} spellCheck={false} onChange={event => { edited(); setOfferSignature(event.target.value); }} /></label>
        <div className="mt-4 flex flex-wrap gap-3"><button type="submit" className={button} disabled={packet.offers.length >= 16}>{copy.workspace.addProviderQuotation}</button>
          <button type="button" className={button} onClick={() => downloadSigningMessage("offer")}>{copy.workspace.downloadOfferSigningMessage}</button>
          <button type="button" className={button} onClick={() => downloadProviderData("offer")}>{copy.workspace.downloadProviderOfferJSON}</button>
          {signer && <button type="button" className={button} disabled={busy} onClick={() => { void sign("offer"); }}>{copy.workspace.signOfferMessage}</button>}</div>
        <details className="mt-5"><summary className="cursor-pointer font-mono text-xs underline">{copy.workspace.importAProviderSOfferJSONInstead}</summary>
          <label className={`${label} mt-3`}>{copy.workspace.providerOfferJSON}<textarea aria-label={copy.workspace.providerOfferJSON} className={field} rows={4} maxLength={MAX_PROCUREMENT_BYTES} value={offerJson} spellCheck={false} onChange={event => { setOfferJson(event.target.value); edited(); }} /></label>
          <button type="button" className={`${button} mt-3`} onClick={() => { try {
            addOffer(readJson(offerJson)); setOfferJson("");
          } catch { setMessage(errorMessage); } }}>{copy.workspace.importProviderOffer}</button>
        </details>
      </form>

      <section className={panel} aria-label={copy.workspace.quotationComparison}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-display text-2xl text-ink">{copy.workspace.compareBeforeSelecting}</h2>
          <button type="button" className={`${button} bg-ink text-paper`} disabled={busy} onClick={() => { void run(packet, copy.messages.compared); }}>{copy.workspace.compareCurrentQuotations}</button></div>
        {!packet.offers.length && <p className="mt-4 font-serif text-sm text-ink-2">{copy.workspace.noQuotationsYetAddOneAboveOrImportA}</p>}
        {!result && !!packet.offers.length && <p className="mt-4 font-serif text-sm text-ink-2">{copy.workspace.compareToInspectSignaturesRemainingBudgetAndTheNext}</p>}
        {packet.offers.map((offer, index) => {
          const checked = result?.offers.find(row => row.id === offer.id);
          return <article key={`${offer.id}:${index}`} className="mt-5 min-w-0 border-t border-line pt-4" aria-label={copyText(copy.workspace.quotationOfferId, { offerId: offer.id })}>
            <h3 className="font-display text-lg">{offer.id} · {amount(offer.priceMicroUsdc)}</h3>
            <p className="mt-2 whitespace-pre-wrap font-serif text-sm">{offer.deliverable}</p>
            <p className="mt-2 break-all font-mono text-xs text-ink-3">{copyText(copy.templates.providerLine, { wallet: offer.providerWallet })}</p>
            <p className="mt-2 break-all font-serif text-xs text-ink-2">{copyText(copy.templates.sourceLink, { url: offer.sourceUrl })}</p>
            <p className="mt-2 font-mono text-xs">{copyText(copy.templates.coverage, { requirements: offer.requirementIds.join(", "), expiresAt: offer.expiresAt })}</p>
            {checked && <p className="mt-2 font-serif text-sm text-seal">{readableReason(checked.reason)}</p>}
            {result?.recommendation?.offerId === offer.id && <p className="mt-2 font-serif text-sm text-seal">{copy.workspace.recommendedNextHighestDeclaredMissingPriorityPerMicroUSDC}</p>}
            <div className="mt-3 flex flex-wrap gap-3"><button type="button" className={button} disabled={busy || (!packet.selectedOfferIds.includes(offer.id) && (!checked || checked.reason !== "eligible" || result?.state === "request-expired"))} onClick={() => { void selectOffer(offer.id); }}>
              {packet.selectedOfferIds.includes(offer.id) ? copyText(copy.workspace.removeSelectionOfferId, { offerId: offer.id }) : copyText(copy.workspace.selectProposalOfferId, { offerId: offer.id })}</button>
            <button type="button" className={button} onClick={() => { commit({ ...packet, offers: packet.offers.filter(row => row.id !== offer.id), selectedOfferIds: packet.selectedOfferIds.filter(id => id !== offer.id), deliveries: packet.deliveries.filter(row => row.offerId !== offer.id), reviews: packet.reviews.filter(row => row.offerId !== offer.id) }, copy.messages.offerRemoved); }}>{copyText(copy.templates.removeQuotation, { id: offer.id })}</button></div>
          </article>;
        })}
        {result && <div className="mt-5 border-t border-line pt-4 font-mono text-xs text-ink-2">
          <p className="mb-2">{copyText(copy.templates.state, { state: readableReason(result.state) })}</p>
          <p>{copyText(copy.templates.budgetSummary, { planned: amount(result.quoteBudget.plannedMicroUsdc), remaining: amount(result.quoteBudget.remainingMicroUsdc) })}</p>
          <p className="mt-2">{copyText(copy.templates.missingRequirements, { requirements: result.missingRequirementIds.join(", ") || copy.workspace.none })}</p>
          <p className="mt-2">{copy.workspace.paymentNotObservedNoFundsReservedOrSpent}</p>
        </div>}
      </section>

      <form className={panel} onSubmit={event => { event.preventDefault(); try {
        addDelivery(draftDelivery());
      } catch { setMessage(errorMessage); } }}>
        <h2 className="font-display text-2xl text-ink">{copy.workspace.step3InspectDeliveredEvidence}</h2>
        <p className="mt-2 font-serif text-sm text-ink-2">{copy.workspace.pasteSuppliedTextHighlightAnExactPassageThenAttach}</p>
        <label className={`${label} mt-5`}>{copy.workspace.deliveryForQuotation}<select aria-label={copy.workspace.deliveryForQuotation} className={field} value={deliveryOfferId} onChange={event => { setDeliveryOfferId(event.target.value); setBody(""); setExcerpts([]); setExcerptRequirement(""); deliveryEdited(); }}>
          <option value="">{copy.workspace.chooseAQuotation}</option>{packet.offers.map(row => <option key={row.id} value={row.id}>{row.id}: {row.deliverable.slice(0, 80)}</option>)}</select></label>
        <label className={`${label} mt-4`}>{copy.workspace.suppliedDeliveryText}<textarea aria-label={copy.workspace.suppliedDeliveryText} ref={bodyRef} className={field} rows={7} maxLength={40000} value={body} onChange={event => { setBody(event.target.value); setExcerpts([]); deliveryEdited(); }} /></label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className={label}>{copy.workspace.requirementForHighlightedPassage}<select aria-label={copy.workspace.requirementForHighlightedPassage} className={field} value={excerptRequirement} onChange={event => { setExcerptRequirement(event.target.value); edited(); }}>
          <option value="">{copy.workspace.chooseARequirement}</option>{packet.request.requirements.filter(row => chosenOffer?.requirementIds.includes(row.id)).map(row => <option key={row.id} value={row.id}>{row.id}: {row.question.slice(0, 100)}</option>)}</select></label>
          <label className={label}>{copy.workspace.providerDeclaredStance}<select aria-label={copy.workspace.providerDeclaredStance} className={field} value={stance} onChange={event => { setStance(event.target.value as typeof stance); edited(); }}>
            <option value="supports">{copy.workspace.supports}</option><option value="refutes">{copy.workspace.refutes}</option><option value="inconclusive">{copy.workspace.inconclusive}</option></select></label></div>
        <button type="button" className={`${button} mt-3`} disabled={!chosenOffer || !excerptRequirement} onClick={() => {
          const element = bodyRef.current;
          if (!element || element.selectionStart === element.selectionEnd) { setMessage(copy.messages.selectExcerpt); return; }
          setExcerpts([...excerpts.filter(row => row.requirementId !== excerptRequirement), { requirementId: excerptRequirement, start: element.selectionStart, end: element.selectionEnd, stance }]); deliveryEdited();
        }}>{copy.workspace.attachHighlightedPassage}</button>
        {excerpts.map(row => <blockquote className="mt-4 min-w-0 border-l-2 border-seal pl-3" key={row.requirementId}>
          <p className="whitespace-pre-wrap break-words font-serif text-sm">{body.slice(row.start, row.end)}</p><p className="mt-2 font-mono text-xs text-ink-3">{copyText(copy.templates.deliveryExcerpt, { requirement: row.requirementId, stance: row.stance, start: row.start, end: row.end })}</p>
        </blockquote>)}
        <label className={`${label} mt-4`}>{copy.workspace.deliverySignatureOptionalForADraft}<input className={field} maxLength={132} value={deliverySignature} spellCheck={false} onChange={event => { edited(); setDeliverySignature(event.target.value); }} /></label>
        <div className="mt-4 flex flex-wrap gap-3"><button type="submit" className={button} disabled={!chosenOffer || !excerpts.length}>{copy.workspace.addSuppliedDelivery}</button>
          <button type="button" className={button} disabled={!chosenOffer || !excerpts.length} onClick={() => downloadSigningMessage("delivery")}>{copy.workspace.downloadDeliverySigningMessage}</button>
          <button type="button" className={button} disabled={!chosenOffer || !excerpts.length} onClick={() => downloadProviderData("delivery")}>{copy.workspace.downloadProviderDeliveryJSON}</button>
          {signer && <button type="button" className={button} disabled={busy || !chosenOffer || !excerpts.length} onClick={() => { void sign("delivery"); }}>{copy.workspace.signDeliveryMessage}</button>}</div>
        <details className="mt-5"><summary className="cursor-pointer font-mono text-xs underline">{copy.workspace.importAProviderSDeliveryJSONInstead}</summary>
          <label className={`${label} mt-3`}>{copy.workspace.providerDeliveryJSON}<textarea aria-label={copy.workspace.providerDeliveryJSON} className={field} rows={4} maxLength={MAX_PROCUREMENT_BYTES} value={deliveryJson} spellCheck={false} onChange={event => { setDeliveryJson(event.target.value); edited(); }} /></label>
          <button type="button" className={`${button} mt-3`} onClick={() => { try {
            addDelivery(readJson(deliveryJson)); setDeliveryJson("");
          } catch { setMessage(errorMessage); } }}>{copy.workspace.importProviderDelivery}</button>
        </details>
      </form>

      <section className={panel} aria-label={copy.workspace.callerEvidenceReview}>
        <h2 className="font-display text-2xl text-ink">{copy.workspace.step4RecordYourEvidenceReview}</h2>
        <p className="mt-2 font-serif text-sm text-ink-2">{copy.workspace.readEachExactExcerptYouMayDeclareASupporting}</p>
        <label className={`${label} mt-4`}>{copy.workspace.reviewerNameOrIdentifier}<input className={field} maxLength={120} value={reviewer} onChange={event => { setReviewer(event.target.value); edited(); }} /></label>
        {!result && <p className="mt-4 font-serif text-sm text-ink-2">{copy.workspace.compareTheCurrentPacketToInspectAndReviewDeliveries}</p>}
        {result?.deliveries.map((delivery, index) => <article className="mt-5 border-t border-line pt-4" key={`${delivery.offerId}:${index}`} aria-label={copyText(copy.workspace.deliveryReviewDeliveryOfferId, { deliveryOfferId: delivery.offerId })}>
          <h3 className="font-display text-lg">{copyText(copy.templates.reviewHeading, { id: delivery.offerId })}</h3>
          <p className="mt-2 font-serif text-sm text-seal">{readableReason(delivery.reason)}</p>
          {delivery.excerpts.map(excerpt => <div className="mt-4" key={excerpt.requirementId}>
            <blockquote className="whitespace-pre-wrap break-words border-l-2 border-seal pl-3 font-serif text-sm">{excerpt.text}</blockquote>
            <p className="mt-2 font-mono text-xs text-ink-3">{copyText(copy.templates.reviewExcerpt, { requirement: excerpt.requirementId, stance: excerpt.stance })}</p>
            <label className="mt-2 flex min-h-11 items-center gap-3 font-serif text-sm"><input type="checkbox" disabled={excerpt.stance === "inconclusive"} checked={(reviewIds[delivery.offerId] ?? []).includes(excerpt.requirementId)} onChange={() => { setReviewIds({ ...reviewIds, [delivery.offerId]: toggle(reviewIds[delivery.offerId] ?? [], excerpt.requirementId) }); }} />{copyText(copy.templates.reviewDeclaration, { requirement: excerpt.requirementId, stance: copy.reviewStances[excerpt.stance] })}</label>
          </div>)}
          <label className={`${label} mt-4`}>{copyText(copy.templates.reviewNote, { id: delivery.offerId })}<textarea aria-label={copyText(copy.templates.reviewNote, { id: delivery.offerId })} className={field} maxLength={2000} rows={3} value={reviewNotes[delivery.offerId] ?? ""} onChange={event => setReviewNotes({ ...reviewNotes, [delivery.offerId]: event.target.value })} /></label>
          <button type="button" className={`${button} mt-3`} disabled={delivery.reason !== "attributed-bytes" || !reviewer.trim() || !(reviewNotes[delivery.offerId] ?? "").trim()} onClick={() => { try {
            const original = packet.deliveries.find(row => row.offerId === delivery.offerId)!;
            commit({ ...packet, reviews: [...packet.reviews.filter(row => row.offerId !== delivery.offerId), { offerId: delivery.offerId, deliveryHash: procurementDeliveryHash(original), acceptedRequirementIds: reviewIds[delivery.offerId] ?? [], reviewer, reviewerNote: reviewNotes[delivery.offerId] }] }, copy.messages.reviewRecorded);
          } catch { setMessage(errorMessage); } }}>{copyText(copy.templates.recordReview, { id: delivery.offerId })}</button>
          <button type="button" className={`${button} ml-3 mt-3`} onClick={() => {
            commit({ ...packet, deliveries: packet.deliveries.filter(row => row.offerId !== delivery.offerId), reviews: packet.reviews.filter(row => row.offerId !== delivery.offerId) }, copy.messages.deliveryRemoved);
          }}>{copyText(copy.templates.removeDelivery, { id: delivery.offerId })}</button>
        </article>)}
        {!!result?.reviews.length && <ul className="mt-5 space-y-3 font-serif text-sm">{result.reviews.map((row, index) => <li key={`${row.offerId}:${index}`} className="border-t border-line pt-3"><p>{row.offerId}: {readableReason(row.reason)} · {row.reviewer}</p><p className="mt-1 whitespace-pre-wrap">{row.reviewerNote}</p><p className="mt-1 font-mono text-xs">{copyText(copy.templates.reviewedRequirements, { requirements: row.acceptedRequirementIds.join(", ") || copy.workspace.none })}</p></li>)}</ul>}
      </section>
    </>}

    <section className={panel} aria-label={copy.workspace.privatePacketExportAndRestore}>
      <h2 className="font-display text-xl">{copy.workspace.keepOrRestoreThisWork}</h2>
      <p className="mt-2 font-serif text-sm text-ink-2">{copy.workspace.downloadThePacketToContinueLaterOrShareSelected}</p>
      <div className="mt-4 flex flex-wrap gap-3"><button type="button" className={button} disabled={!packet} onClick={() => {
        if (!packet) return; downloadBrowserText(JSON.stringify(parseEvidenceProcurement(packet)), "private-evidence-procurement-packet.json", "application/json"); setMessage(copy.messages.packetDownloaded);
      }}>{copy.workspace.downloadPrivatePlaintextPacket}</button>
      <button type="button" className={button} disabled={!result || busy} onClick={() => {
        if (!result) return; downloadBrowserText(JSON.stringify(result, null, 2) + "\n", "private-evidence-procurement-receipt.json", "application/json"); setMessage(copy.messages.receiptDownloaded);
      }}>{copy.workspace.downloadDecisionReceipt}</button>
      <button type="button" className={button} onClick={() => {
        edited(); setPacket(undefined); setRequestId("request1"); setDecision(""); setNetwork("eip155:5042"); setBudget("0.05"); setRequestExpiry(""); setRequirements([{ id: "requirement1", question: "", priority: 10, status: "missing" }]);
        setOfferId("offer1"); setProviderWallet(""); setSourceUrl(""); setDeliverable(""); setPrice("0.01"); setNonce(""); setOfferExpiry(""); setOfferRequirements([]); setOfferSignature("");
        setDeliveryOfferId(""); setBody(""); setExcerpts([]); setExcerptRequirement(""); setStance("supports"); setDeliverySignature(""); setReviewer(""); setReviewIds({}); setReviewNotes({});
        setImportJson(""); setOfferJson(""); setDeliveryJson(""); setMessage(copy.messages.cleared);
      }}>{copy.workspace.clearTabPacket}</button></div>
      <label className={`${label} mt-5`}>{copy.workspace.restorePrivatePacketFileJSONUpTo64KiB}<input className={`${field} py-3`} type="file" accept=".json,application/json" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (!file) return;
        if (file.size > MAX_PROCUREMENT_BYTES) { setMessage(copy.messages.fileTooLarge); return; }
        edited(); const uploadRevision = revision.current;
        void file.text().then(text => { if (revision.current === uploadRevision) return prepareRestore(text); }).catch(() => {
          if (revision.current === uploadRevision) setMessage(copy.messages.fileReadFailed);
        });
      }} /></label>
      <details className="mt-4"><summary className="cursor-pointer font-mono text-xs underline">{copy.workspace.pastePrivatePacketJSON}</summary>
        <label className={`${label} mt-3`}>{copy.workspace.privatePacketJSON}<textarea aria-label={copy.workspace.privatePacketJSON} className={field} rows={5} value={importJson} maxLength={MAX_PROCUREMENT_BYTES} spellCheck={false} onChange={event => { setImportJson(event.target.value); edited(); }} /></label>
        <button type="button" className={`${button} mt-3`} onClick={() => { void prepareRestore(importJson); }}>{copy.workspace.validatePacketForRestore}</button>
      </details>
      {restore && <section className="mt-5 border border-seal p-4" aria-label={copy.workspace.validatedRestorePreview}>
        <p className="font-serif text-sm">{copyText(copy.templates.restoreHeading, { id: restore.request.id, decision: restore.request.decision })}</p>
        <p className="mt-2 font-mono text-xs">{copyText(copy.templates.restoreSummary, { offers: restore.offers.length, deliveries: restore.deliveries.length, reviews: restore.reviews.length, amount: amount(restore.request.budgetMicroUsdc) })}</p>
        <div className="mt-3 flex flex-wrap gap-3"><button type="button" className={button} onClick={replacePacket}>{copy.workspace.replaceTabWithValidatedPacket}</button><button type="button" className={button} onClick={() => { setRestore(undefined); setMessage(copy.messages.restoreCancelled); }}>{copy.workspace.cancelPacketRestore}</button></div>
      </section>}
    </section>
  </section>;
}
