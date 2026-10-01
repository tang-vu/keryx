"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Citation, EvidenceRecord, PaymentRecord } from "@/lib/types";
import { paymentSettlementStatus } from "@/lib/payments/payment-state";
import { fmtUsdc } from "./phase-style";

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

const SETTLEMENT_WALLET = process.env.NEXT_PUBLIC_KERYX_SETTLEMENT_WALLET || "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const SETTLEMENT_PROOF = `https://testnet.arcscan.app/address/${SETTLEMENT_WALLET}`;

export function CitationEvidencePanel({ queryId, citation, evidence, payments, onClose }: Props) {
  const panelRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const articleUrl = safeArticleUrl(citation.itemUrl);
  const isPublicReference = citation.sourceKind === "public-reference";
  const publicDelivery = citation.publicDeliveryKind
    ? ({ full_text: "full text supplied by the feed", excerpt: "excerpt", abstract: "abstract", metadata_only: "metadata only" }[citation.publicDeliveryKind])
    : "body supplied by the feed";
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
  const settledAmount = settled.reduce((sum, payment) => sum + payment.amountUsdc, 0);

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
          <p className="font-mono text-xs uppercase tracking-widest text-seal">Citation {citation.marker}</p>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close citation evidence" className="flex h-11 w-11 items-center justify-center rounded font-mono text-xl text-ink focus-visible:outline-2 focus-visible:outline-seal">×</button>
        </div>
        <h2 id="citation-evidence-title" className="mt-4 font-serif text-2xl leading-tight text-ink [overflow-wrap:anywhere]">
          {citation.itemTitle ?? citation.sourceName}
        </h2>
        <p className="mt-2 font-mono text-xs text-ink-3">Publication: {citation.sourceName}</p>
        <p className="mt-1 font-mono text-xs text-ink-3">Author name: not stored in this dispatch</p>
        {isPublicReference && (
          <div className="mt-4 border-l-2 border-line pl-4">
            <p className="font-mono text-xs text-ink-3">Free public reference · no creator payment</p>
            <p className="mt-2 font-mono text-xs text-ink-3">{citation.webProvenance ? `Original page: extracted ${citation.webProvenance.extraction} text${citation.webProvenance.truncated ? " (bounded excerpt)" : ""}; retrieved ${citation.webProvenance.retrievedAt}` : `RSS delivery: ${publicDelivery}`}</p>
            <p className="mt-2 text-sm text-ink-2">{citation.webProvenance ? `Quotes match text extracted from the original public document. This establishes source grounding, not factual verification or guaranteed complete content. Publisher group ${citation.webProvenance.publisherGroup} uses a registrable-domain proxy; it does not prove ownership or independent corroboration.` : "Evidence comes from the public RSS feed body. Keryx has not fetched the full article or verified publisher ownership."}</p>
          </div>
        )}
        {quotes.length ? (
          <div className="mt-7">
            <h3 className="font-mono text-xs uppercase tracking-widest text-ink-3">Supporting evidence</h3>
            <ul className="mt-3 space-y-4">
              {quotes.map((item, index) => (
                <li key={`${item.claimIndex}-${index}`} className="border-l-2 border-paid pl-4">
                  <blockquote className="font-serif text-[17px] leading-relaxed text-ink">“{item.quote}”</blockquote>
                  <p className="mt-2 text-xs text-ink-3">Supports: {item.claim}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-7 border-l-2 border-line pl-4 text-sm text-ink-3">No supporting excerpt is stored for this citation.</p>
        )}
        {!isPublicReference && <div className="mt-7 border-t border-line pt-5">
          <h3 className="font-mono text-xs uppercase tracking-widest text-ink-3">Creator reward</h3>
          <p className="mt-2 font-serif text-lg text-ink">{Math.round(citation.weight * 100)}% contribution weight</p>
          <p className="mt-2 text-sm text-ink-2">
            {settled.length ? `$${fmtUsdc(settledAmount)} settled across ${settled.length} author ${settled.length === 1 ? "payment" : "payments"}.` : "No settled citation payment is recorded."}
          </p>
          {pending.length > 0 && <p className="mt-1 text-sm text-amber-700">{pending.length} payment {pending.length === 1 ? "is" : "are"} pending confirmation.</p>}
          {failed.length > 0 && <p className="mt-1 text-sm text-red-700">{failed.length} payment {failed.length === 1 ? "failed" : "legs failed"}.</p>}
          {simulated.length > 0 && <p className="mt-1 text-sm text-ink-3">{simulated.length} offline simulated {simulated.length === 1 ? "payment" : "payments"}.</p>}
          {inconsistent.length > 0 && <p className="mt-1 text-sm text-amber-700">{inconsistent.length} payment record has conflicting settlement fields; confirmation is unavailable.</p>}
          {legs.length === 0 && <p className="mt-1 text-sm text-ink-3">Payment detail is unavailable for this citation.</p>}
          {legs.length > 0 && (
            <ul className="mt-3 space-y-1 font-mono text-xs text-ink-3">
              {legs.map((payment, index) => (
                <li key={payment.id ?? `${payment.payee}-${index}`} className="break-all">
                  {payment.settled !== (paymentSettlementStatus(payment) === "settled") ? "unverified" : paymentSettlementStatus(payment)} · ${fmtUsdc(payment.amountUsdc)} USDC on Arc testnet · recipient {payment.payee}
                  {payment.txHash && settled.includes(payment) && (
                    /^0x[0-9a-fA-F]{64}$/.test(payment.txHash) ? (
                      <a href={`https://testnet.arcscan.app/tx/${payment.txHash}`} target="_blank" rel="noopener noreferrer" className="ml-1 underline">View transaction ↗</a>
                    ) : <span className="ml-1">· Circle settlement ID {payment.txHash}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 font-mono text-xs text-ink-3">Planned citation reward: ${fmtUsdc(citation.reward)}</p>
          {settled.length > 0 && <a href={SETTLEMENT_PROOF} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs text-paid underline">View Circle Gateway settlement wallet on ArcScan ↗</a>}
        </div>}
        {articleUrl && (
          <a href={articleUrl} target="_blank" rel="noopener noreferrer" className="mt-7 inline-block max-w-full break-all font-mono text-sm text-paid underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-seal">
            Open source article ↗
          </a>
        )}
      </dialog>,
    document.body,
  );
}
