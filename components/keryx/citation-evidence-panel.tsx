"use client";
import { formatRecordedUsdc, formatUsdcMicros, selectPlural, sumRecordedUsdc } from "@/lib/i18n/format";



import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Citation, EvidenceRecord, PaymentRecord } from "@/lib/types";
import { paymentSettlementStatus } from "@/lib/payments/payment-state";
import { ScholarlyMetadataDetails } from "./scholarly-metadata";
import { recordedArcLabel,recordedArcTransactionUrl } from "@/lib/arc-network-display";
import { GatewayContractReferences } from "./gateway-contract-references";
import { useUiMessages } from "@/lib/i18n/ui-copy";
import { PdfReadingScope } from "./pdf-reading-scope";





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
  const copy = useUiMessages();
  const panelRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const articleUrl = safeArticleUrl(citation.itemUrl);
  const isPublicReference = citation.sourceKind === "public-reference";
  const publicDelivery = citation.publicDeliveryKind
    ? ({ full_text: copy("citationEvidence.rssFullText"), excerpt: copy("citationEvidence.rssExcerpt"), abstract: copy("citationEvidence.rssAbstract"), metadata_only: copy("citationEvidence.rssMetadata") }[citation.publicDeliveryKind])
    : copy("citationEvidence.rssBody");
  const quotes = evidence.filter((item) =>
    item.marker === citation.marker && item.sourceId === citation.sourceId &&
    item.itemId === citation.itemId && item.itemUrl === citation.itemUrl && item.contentVersion === citation.contentVersion &&
    (item.qualifiesForAnswer ?? item.qualifiesForReward) && item.quote.trim().length > 0,
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
        className="kx-evidence-panel fixed inset-x-0 bottom-0 top-auto m-0 h-auto max-h-[88dvh] w-full max-w-none overflow-hidden rounded-t-2xl border-t border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-ink/60 sm:inset-y-0 sm:left-auto sm:right-0 sm:h-dvh sm:max-h-none sm:w-[min(520px,100vw)] sm:rounded-none sm:border-l sm:border-t-0"
      >
        <header className="relative flex shrink-0 items-center justify-between gap-4 border-b border-line bg-paper-2 px-5 py-3 before:absolute before:inset-y-4 before:left-0 before:w-0.5 before:bg-seal sm:px-8">
          <p className="min-w-0 font-mono text-xs uppercase tracking-widest text-seal [overflow-wrap:anywhere]">{copy("citationEvidence.citation", { marker: citation.marker })}</p>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={copy("citationEvidence.close")} className="kx-evidence-close flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-paper text-ink hover:border-ink hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <div data-evidence-scroll role="region" aria-labelledby="citation-evidence-title" tabIndex={0} className="min-h-0 flex-auto overflow-y-auto overscroll-contain px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-seal sm:px-8 sm:pt-8">
          <h2 id="citation-evidence-title" className="font-display text-[28px] leading-[1.15] text-ink [overflow-wrap:anywhere] sm:text-[32px]">
            {citation.itemTitle ?? citation.sourceName}
          </h2>
          <p className="mt-2 font-mono text-xs text-ink-3">{copy("citationEvidence.publication", { publication: citation.sourceName })}</p>
          {citation.scholarly ? <ScholarlyMetadataDetails metadata={citation.scholarly} /> : <p className="mt-1 font-mono text-xs text-ink-3">{copy("citationEvidence.authorNotStored")}</p>}
          {citation.evidenceProvenance === "synthetic-demo" && <p className="mt-4 border-l-2 border-seal pl-4 text-sm text-seal">{copy("citationEvidence.synthetic")}</p>}
          {isPublicReference && (
            <div className="mt-4 border-l-2 border-line pl-4">
              <p className="font-mono text-xs text-ink-3">{copy("citationEvidence.publicReference")}</p>
              <p className="mt-2 font-mono text-xs text-ink-3">{citation.webProvenance ? copy(citation.webProvenance.truncated ? "citationEvidence.webBounded" : "citationEvidence.webText", { extraction: citation.webProvenance.extraction, retrievedAt: citation.webProvenance.retrievedAt }) : publicDelivery}</p>
              <PdfReadingScope provenance={citation.webProvenance} />
              <p className="mt-2 text-sm text-ink-2">{citation.webProvenance ? copy("citationEvidence.groundingNotice", { publisherGroup: citation.webProvenance.publisherGroup }) : copy("citationEvidence.rssNotice")}</p>
            </div>
          )}
          {quotes.length ? (
            <div className="mt-7">
              <h3 className="font-mono text-xs uppercase tracking-widest text-ink-3">{copy("citationEvidence.supporting")}</h3>
              <ul className="mt-3 space-y-4">
                {quotes.map((item, index) => (
                  <li key={`${item.claimIndex}-${index}`} className="border-l-2 border-paid bg-paper-2 py-4 pl-4 pr-3">
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
              {settled.length ? settledAmount === null ? copy(selectPlural(settled.length) === "one" ? "citationEvidence.settledUnknown.one" : "citationEvidence.settledUnknown.other", { count: settled.length }) : copy(selectPlural(settled.length) === "one" ? "citationEvidence.settled.one" : "citationEvidence.settled.other", { amount: formatUsdcMicros(settledAmount), count: settled.length }) : copy("citationEvidence.noSettledPayment")}
            </p>
            {pending.length > 0 && <p className="mt-1 text-sm text-amber-700">{copy(selectPlural(pending.length) === "one" ? "citationEvidence.pending.one" : "citationEvidence.pending.other", { count: pending.length })}</p>}
            {failed.length > 0 && <p className="mt-1 text-sm text-red-700">{copy(selectPlural(failed.length) === "one" ? "citationEvidence.failed.one" : "citationEvidence.failed.other", { count: failed.length })}</p>}
            {simulated.length > 0 && <p className="mt-1 text-sm text-ink-3">{copy(selectPlural(simulated.length) === "one" ? "citationEvidence.simulated.one" : "citationEvidence.simulated.other", { count: simulated.length })}</p>}
            {inconsistent.length > 0 && <p className="mt-1 text-sm text-amber-700">{copy(selectPlural(inconsistent.length) === "one" ? "citationEvidence.conflicting.one" : "citationEvidence.conflicting.other", { count: inconsistent.length })}</p>}
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
        </div>
        {articleUrl && (
          <footer className="shrink-0 border-t border-line bg-paper px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-8">
            <a href={articleUrl} target="_blank" rel="noopener noreferrer" className="kx-evidence-article flex min-h-11 items-center border border-paid px-4 py-3 font-mono text-xs text-paid hover:bg-paid hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal">
              {copy("citationEvidence.openArticle")}
            </a>
          </footer>
        )}
      </dialog>,
    document.body,
  );
}
