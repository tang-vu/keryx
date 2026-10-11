"use client";

import { createMessages } from "@/lib/i18n/messages";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Citation, EvidenceRecord, PaymentRecord } from "@/lib/types";
import { paymentSettlementStatus } from "@/lib/payments/payment-state";
import { formatRecordedUsdc, formatUsdcMicros, sumRecordedUsdc } from "@/lib/display/recorded-usdc";
import { ScholarlyMetadataDetails } from "./scholarly-metadata";
import { recordedArcLabel,recordedArcTransactionUrl } from "@/lib/arc-network-display";
import { GatewayContractReferences } from "./gateway-contract-references";

const copy = createMessages("en");

interface Props {
  queryId: string;
  citation: Citation;
  evidence: EvidenceRecord[];
  payments: PaymentRecord[];
  onClose: () => void;
}

function safeArticleUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function CitationEvidencePanel({ queryId, citation, evidence, payments, onClose }: Props) {
  const panelRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const articleUrl = safeArticleUrl(citation.itemUrl);
  const isPublicReference = citation.sourceKind === "public-reference";
  const publicDelivery = citation.publicDeliveryKind
    ? ({ full_text: copy("citationEvidence.rssFullText"), excerpt: copy("citationEvidence.rssExcerpt"), abstract: copy("citationEvidence.rssAbstract"), metadata_only: copy("citationEvidence.rssMetadata") }[citation.publicDeliveryKind])
    : copy("citationEvidence.rssBody");
  const quotes = evidence.filter((item) =>
    item.marker === citation.marker && item.sourceId === citation.sourceId && (item.qualifiesForAnswer ?? item.qualifiesForReward) && item.quote.trim().length > 0,
  );
  const legs = payments.filter((payment) =>
    payment.kind === "citation" && payment.queryId === queryId && payment.sourceId === citation.sourceId &&
    (!citation.itemId || payment.itemId === citation.itemId),
  );
  const consistent = legs.filter((payment) => payment.settled === (paymentSettlementStatus(payment) === "settled"));
  const inconsistent = legs.filter((payment) => payment.settled !== (paymentSettlementStatus(payment) === "settled"));
  const settled = consistent.filter((payment) => paymentSettlementStatus(payment) === "settled");
  const pending = consistent.filter((payment) => paymentSettlementStatus(payment) === "pending");
  const failed = consistent.filter((payment) => paymentSettlementStatus(payment) === "failed");
  const simulated = consistent.filter((payment) => paymentSettlementStatus(payment) === "simulated");
  const settledAmount = sumRecordedUsdc(settled.map(payment => payment.amountUsdc));

  useEffect(() => {
    const dialog = panelRef.current;
    if (!dialog) return;
    const scrollY = window.scrollY;
    const original = { position: document.body.style.position, top: document.body.style.top, width: document.body.style.width };
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      dialog.close();
      document.body.style.position = original.position;
      document.body.style.top = original.top;
      document.body.style.width = original.width;
      window.scrollTo(0, scrollY);
    };
  }, [onClose]);

  return createPortal(
      <dialog
        ref={panelRef}
        aria-modal="true"
        aria-labelledby="citation-evidence-title"
        onCancel={(event) => { event.preventDefault(); onClose(); }}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
        }}
        className="fixed inset-x-0 bottom-0 top-auto m-0 h-auto max-h-[88dvh] w-full max-w-none overflow-y-auto border-t border-ink bg-paper p-6 text-ink shadow-2xl backdrop:bg-ink/60 sm:inset-y-0 sm:left-auto sm:right-0 sm:h-screen sm:max-h-none sm:w-[min(460px,100vw)] sm:border-l sm:border-t-0 sm:p-8"
      >
        <div className="sticky -top-6 z-10 -mx-6 -mt-6 flex items-center justify-between gap-4 border-b border-line bg-paper px-6 py-3 sm:-top-8 sm:-mx-8 sm:-mt-8 sm:px-8">
          <p className="font-mono text-xs uppercase tracking-widest text-seal">{copy("citationEvidence.citation", { marker: citation.marker })}</p>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={copy("citationEvidence.close")} className="flex h-11 w-11 items-center justify-center rounded font-mono text-xl text-ink focus-visible:outline-2 focus-visible:outline-seal">×</button>
        </div>
        <h2 id="citation-evidence-title" className="mt-4 font-serif text-2xl leading-tight text-ink [overflow-wrap:anywhere]">
          {citation.itemTitle ?? citation.sourceName}
        </h2>
        <p className="mt-2 font-mono text-xs text-ink-3">{copy("citationEvidence.publication", { publication: citation.sourceName })}</p>
        {citation.scholarly ? <ScholarlyMetadataDetails metadata={citation.scholarly} /> : <p className="mt-1 font-mono text-xs text-ink-3">{copy("citationEvidence.authorNotStored")}</p>}
        {citation.evidenceProvenance === "synthetic-demo" && <p className="mt-4 border-l-2 border-seal pl-4 text-sm text-seal">{copy("citationEvidence.synthetic")}</p>}
        {isPublicReference && (
          <div className="mt-4 border-l-2 border-line pl-4">
            <p className="font-mono text-xs text-ink-3">{copy("citationEvidence.publicReference")}</p>
            <p className="mt-2 font-mono text-xs text-ink-3">{citation.webProvenance ? copy(citation.webProvenance.truncated ? "citationEvidence.webBounded" : "citationEvidence.webText", { extraction: citation.webProvenance.extraction, retrievedAt: citation.webProvenance.retrievedAt }) : publicDelivery}</p>
            <p className="mt-2 text-sm text-ink-2">{citation.webProvenance ? copy("citationEvidence.groundingNotice", { publisherGroup: citation.webProvenance.publisherGroup }) : copy("citationEvidence.rssNotice")}</p>
          </div>
        )}
        {quotes.length ? (
          <div className="mt-7">
            <h3 className="font-mono text-xs uppercase tracking-widest text-ink-3">{copy("citationEvidence.supporting")}</h3>
            <ul className="mt-3 space-y-4">
              {quotes.map((item, index) => (
                <li key={`${item.claimIndex}-${index}`} className="border-l-2 border-paid pl-4">
                  <blockquote className="whitespace-pre-wrap font-serif text-[17px] leading-relaxed text-ink [overflow-wrap:anywhere]">“{item.quote}”</blockquote>
                  <p className="mt-2 text-xs text-ink-3">{copy("citationEvidence.target", { claim: item.claim })}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-7 border-l-2 border-line pl-4 text-sm text-ink-3">{copy("citationEvidence.noExcerpt")}</p>
        )}
        {!isPublicReference && <div className="mt-7 border-t border-line pt-5">
          <h3 className="font-mono text-xs uppercase tracking-widest text-ink-3">{copy("citationEvidence.reward")}</h3>
          <p className="mt-2 font-serif text-lg text-ink">{copy("citationEvidence.contribution", { weight: Math.round(citation.weight * 100) })}</p>
          <p className="mt-2 text-sm text-ink-2">
            {settled.length ? settledAmount === null ? copy(settled.length === 1 ? "citationEvidence.settledUnknown.one" : "citationEvidence.settledUnknown.other", { count: settled.length }) : copy(settled.length === 1 ? "citationEvidence.settled.one" : "citationEvidence.settled.other", { amount: formatUsdcMicros(settledAmount), count: settled.length }) : copy("citationEvidence.noSettledPayment")}
          </p>
          {pending.length > 0 && <p className="mt-1 text-sm text-amber-700">{copy(pending.length === 1 ? "citationEvidence.pending.one" : "citationEvidence.pending.other", { count: pending.length })}</p>}
          {failed.length > 0 && <p className="mt-1 text-sm text-red-700">{copy(failed.length === 1 ? "citationEvidence.failed.one" : "citationEvidence.failed.other", { count: failed.length })}</p>}
          {simulated.length > 0 && <p className="mt-1 text-sm text-ink-3">{copy(simulated.length === 1 ? "citationEvidence.simulated.one" : "citationEvidence.simulated.other", { count: simulated.length })}</p>}
          {inconsistent.length > 0 && <p className="mt-1 text-sm text-amber-700">{copy(inconsistent.length === 1 ? "citationEvidence.conflicting.one" : "citationEvidence.conflicting.other", { count: inconsistent.length })}</p>}
          {legs.length === 0 && <p className="mt-1 text-sm text-ink-3">{copy("citationEvidence.paymentUnavailable")}</p>}
          {legs.length > 0 && (
            <ul className="mt-3 space-y-1 font-mono text-xs text-ink-3">
              {legs.map((payment, index) => (
                <li key={payment.id ?? `${payment.payee}-${index}`} className="break-all">
                  {copy("citationEvidence.payment", { status: payment.settled !== (paymentSettlementStatus(payment) === "settled") ? copy("citationEvidence.unverified") : paymentSettlementStatus(payment), amount: formatRecordedUsdc(payment.amountUsdc), network: recordedArcLabel(payment.network), payee: payment.payee })}
                  {payment.txHash && settled.includes(payment) && (
                    /^0x[0-9a-fA-F]{64}$/.test(payment.txHash) ? (
                      <a href={recordedArcTransactionUrl(payment.network,payment.txHash)} target="_blank" rel="noopener noreferrer" className="ml-1 underline">{copy("citationEvidence.viewTransaction")}</a>
                    ) : <span className="ml-1">{copy("citationEvidence.settlementId", { reference: payment.txHash })}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 font-mono text-xs text-ink-3">{copy("citationEvidence.planned", { amount: formatRecordedUsdc(citation.reward) })}</p>
          <GatewayContractReferences records={settled} className="mt-2 mr-3 inline-block text-xs text-paid underline"/>
        </div>}
        {articleUrl && (
          <a href={articleUrl} target="_blank" rel="noopener noreferrer" className="mt-7 inline-block max-w-full break-all font-mono text-sm text-paid underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-seal">
            {copy("citationEvidence.openArticle")}
          </a>
        )}
      </dialog>,
    document.body,
  );
}
