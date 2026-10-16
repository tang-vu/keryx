"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatSigningUsdc } from "@/lib/i18n/format";
import { readRecordedReceipt, readResearchAdmission, recordedWalkthrough } from "@/lib/recorded-walkthrough";
import { readCircleTransfer, readRegistryPayout, recordedPayment } from "@/lib/recorded-walkthrough-verification";
import { walkthroughMessages as messages } from "@/locales/en/walkthrough";
import { useUiCopy } from "@/lib/i18n/ui-copy";
const uiEnglish_messages = messages;


const buttonStyle = "border border-line px-4 py-3 font-mono text-xs text-ink hover:bg-paper-2 disabled:opacity-50";
const linkStyle = "inline-block py-2 text-paid underline underline-offset-4";
const termStyle = "text-xs text-ink-3";
const amountStyle = "mt-1 font-mono text-lg";
const referenceStyle = "mt-1 break-all font-mono text-xs";

/** One explicit, abortable read per click. A thrown read is reported as unavailable, never as a pass. */
function VerifyControl<Result extends string>({ label, note, read, outcomes }: {
  label: string; note?: string; read: (signal: AbortSignal) => Promise<Result>;
  outcomes: Record<Result | "checking" | "unavailable", string>;
}) {
  const [state, setState] = useState<Result | "idle" | "checking" | "unavailable">("idle");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const verify = async () => {
    if (controller.current) return;
    const own = new AbortController(); controller.current = own; setState("checking");
    try { const result = await read(own.signal); if (!own.signal.aborted) setState(result); }
    catch { if (!own.signal.aborted) setState("unavailable"); }
    finally { if (controller.current === own) controller.current = null; }
  };
  return <div className="mt-4">
    <button type="button" disabled={state === "checking"} onClick={() => void verify()} className={buttonStyle}>{label}</button>
    {note && <p className="mt-2 text-xs leading-relaxed text-ink-3">{note}</p>}
    <p role="status" className="mt-2 text-sm leading-relaxed text-ink-3">{state === "idle" ? null : outcomes[state]}</p>
  </div>;
}

const integrityOutcomes = { checking: messages.checking, matched: messages.matched, changed: messages.changed, unavailable: messages.unavailable };
const circleOutcomes = { checking: messages.circleChecking, completed: messages.circleCompleted, progressing: messages.circleProgressing,
  failed: messages.circleFailed, mismatch: messages.circleMismatch, unavailable: messages.circleUnavailable };
const registryOutcomes = { checking: messages.registryChecking, registered: messages.registryRegistered,
  changed: messages.registryChanged, unavailable: messages.registryUnavailable };
const liveOutcomes = { checking: messages.liveChecking, "not-paused": messages.liveOpen, paused: messages.livePaused, unavailable: messages.liveUnknown };

export function RecordedWalkthrough() {
  const messages = useUiCopy("walkthrough", uiEnglish_messages);
  const [step, setStep] = useState(-1);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (step >= 0) heading.current?.focus(); }, [step]);
  const current = messages.steps[step];
  return (
    <div className="mt-8 space-y-8">
      <div className="border border-line bg-paper p-5 sm:p-7">
        <p className="font-mono text-xs text-paid">{messages.badge}</p>
        <p className="mt-4 font-serif text-lg leading-relaxed text-ink-2">{messages.introduction}</p>
        <p className="mt-3 text-sm leading-relaxed text-ink-3">{messages.limitation}</p>
        {step === -1 && <button type="button" onClick={() => setStep(0)} className={`${buttonStyle} mt-5`}>{messages.start}</button>}
      </div>
      {step >= 0 && (
        <section className="border border-line bg-paper p-5 sm:p-7">
          <nav aria-label={messages.navigation}>
            <ol className="grid gap-2 sm:grid-cols-2">
              {messages.steps.map((item, index) => <li key={item.title}><button type="button" aria-current={step === index ? "step" : undefined} onClick={() => setStep(index)} className={`${buttonStyle} w-full text-left aria-[current=step]:border-paid`}>{index + 1}. {item.title}</button></li>)}
            </ol>
          </nav>
          <h2 ref={heading} tabIndex={-1} className="mt-7 font-display text-3xl text-ink">{current?.title ?? messages.finished}</h2>
          {current && <>
            <p className="mt-4 font-serif text-lg leading-relaxed text-ink-2">{current.body}</p>
            <p className="mt-3 text-sm leading-relaxed text-ink-3">{current.limit}</p>
            <p className="mt-3 text-sm leading-relaxed text-ink-2">{current.action}</p>
            <a href={recordedWalkthrough.reportPath} target="_blank" rel="noopener noreferrer" className={linkStyle}>{messages.openReport}</a>
          </>}
          {step === 2 && <div className="mt-5 border-t border-line pt-5">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div><dt className={termStyle}>{messages.accessLabel}</dt><dd className={amountStyle}>{formatSigningUsdc(recordedPayment.accessMicros)}</dd></div>
              <div><dt className={termStyle}>{messages.citationLabel}</dt><dd className={amountStyle}>{formatSigningUsdc(recordedPayment.citationMicros)}</dd></div>
              <div className="sm:col-span-2"><dt className={termStyle}>{messages.circleLabel}</dt><dd className={referenceStyle}>{recordedWalkthrough.circleTransferId}</dd></div>
              <div className="sm:col-span-2"><dt className={termStyle}>{messages.payeeLabel}</dt><dd className={referenceStyle}>{recordedPayment.payee}</dd></div>
              <div className="sm:col-span-2"><dt className={termStyle}>{messages.digestLabel}</dt><dd className={referenceStyle}>{recordedWalkthrough.digest}</dd></div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-x-6">
              <a href={recordedWalkthrough.receiptPath} target="_blank" rel="noopener noreferrer" className={linkStyle}>{messages.openReceipt}</a>
              <a href={recordedWalkthrough.snapshotUrl} target="_blank" rel="noopener noreferrer" className={linkStyle}>{messages.openSnapshot}</a>
            </div>
            <VerifyControl label={messages.check} read={readRecordedReceipt} outcomes={integrityOutcomes} />
            <VerifyControl label={messages.circleCheck} note={messages.circleNote} read={readCircleTransfer} outcomes={circleOutcomes} />
            <VerifyControl label={messages.registryCheck} note={messages.registryNote} read={readRegistryPayout} outcomes={registryOutcomes} />
          </div>}
          {step === 3 && <div className="mt-5 border-t border-line pt-5">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div><dt className={termStyle}>{messages.budgetLabel}</dt><dd className={amountStyle}>{formatSigningUsdc(recordedPayment.budgetMicros)}</dd></div>
              <div><dt className={termStyle}>{messages.accessLabel}</dt><dd className={amountStyle}>{formatSigningUsdc(recordedPayment.accessMicros)}</dd></div>
              <div><dt className={termStyle}>{messages.citationLabel}</dt><dd className={amountStyle}>{formatSigningUsdc(recordedPayment.citationMicros)}</dd></div>
              <div><dt className={termStyle}>{messages.outstandingLabel}</dt><dd className={amountStyle}>{formatSigningUsdc(recordedPayment.pendingMicros + recordedPayment.failedMicros)}</dd></div>
              <div><dt className={termStyle}>{messages.unspentLabel}</dt><dd className={amountStyle}>{formatSigningUsdc(recordedPayment.budgetMicros - recordedPayment.accessMicros - recordedPayment.citationMicros)}</dd></div>
              <div><dt className={termStyle}>{messages.costsLabel}</dt><dd className="mt-1 text-sm text-ink-2">{messages.costsValue}</dd></div>
            </dl>
            <Link href="/operator/ledger" prefetch={false} className={`${linkStyle} mt-4`}>{messages.ledgerLink}</Link>
          </div>}
          <div className="mt-7 flex flex-wrap gap-3">
            <button type="button" disabled={step === 0} onClick={() => setStep(value => value - 1)} className={buttonStyle}>{messages.back}</button>
            {step < messages.steps.length && <button type="button" onClick={() => setStep(value => value + 1)} className={buttonStyle}>{step === messages.steps.length - 1 ? messages.finish : messages.next}</button>}
          </div>
        </section>
      )}
      <section className="space-y-3">
        <h2 className="font-display text-2xl text-ink">{messages.boundaryTitle}</h2>
        <p className="text-sm leading-relaxed text-ink-3">{messages.boundaryBody}</p>
        <div className="flex flex-wrap gap-x-6"><Link href="/operator" prefetch={false} className={linkStyle}>{messages.operatorLink}</Link><a href={recordedWalkthrough.scopeUrl} className={linkStyle}>{messages.evidenceLink}</a></div>
      </section>
      <section className="space-y-3 border-t border-line pt-6">
        <h2 className="font-display text-2xl text-ink">{messages.videoTitle}</h2>
        <p className="text-sm leading-relaxed text-ink-3">{messages.videoBody}</p>
        <a href={recordedWalkthrough.videoUrl} className={linkStyle}>{messages.videoLink}</a>
      </section>
      <section className="space-y-3 border-t border-line pt-6">
        <h2 className="font-display text-2xl text-ink">{messages.newQuestionTitle}</h2>
        <p className="text-sm leading-relaxed text-ink-3">{messages.newQuestionBody}</p>
        <VerifyControl label={messages.liveCheck} read={readResearchAdmission} outcomes={liveOutcomes} />
        <Link href="/" prefetch={false} className={linkStyle}>{messages.composerLink}</Link>
      </section>
    </div>
  );
}
