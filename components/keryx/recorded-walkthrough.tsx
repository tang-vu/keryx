"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { readRecordedReceipt, recordedWalkthrough } from "@/lib/recorded-walkthrough";
import { walkthroughMessages as messages } from "@/locales/en/walkthrough";

const buttonStyle = "border border-line px-4 py-3 font-mono text-xs text-ink hover:bg-paper-2 disabled:opacity-50";
const linkStyle = "inline-block py-2 text-paid underline underline-offset-4";

export function RecordedWalkthrough() {
  const [step, setStep] = useState(-1);
  const [check, setCheck] = useState<"idle" | "checking" | "matched" | "changed" | "unavailable">("idle");
  const controller = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { if (step >= 0) heading.current?.focus(); }, [step]);
  const verify = async () => {
    if (controller.current) return;
    const own = new AbortController(); controller.current = own; setCheck("checking");
    try { const result = await readRecordedReceipt(own.signal); if (!own.signal.aborted) setCheck(result); }
    catch { if (!own.signal.aborted) setCheck("unavailable"); }
    finally { if (controller.current === own) controller.current = null; }
  };
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
            <ol className="grid gap-2 sm:grid-cols-3">
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
              <div><dt className="text-xs text-ink-3">{messages.accessLabel}</dt><dd className="mt-1 font-mono text-lg">{messages.accessAmount}</dd></div>
              <div><dt className="text-xs text-ink-3">{messages.citationLabel}</dt><dd className="mt-1 font-mono text-lg">{messages.citationAmount}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-ink-3">{messages.circleLabel}</dt><dd className="mt-1 break-all font-mono text-xs">{recordedWalkthrough.circleTransferId}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-ink-3">{messages.digestLabel}</dt><dd className="mt-1 break-all font-mono text-xs">{recordedWalkthrough.digest}</dd></div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-x-6">
              <a href={recordedWalkthrough.receiptPath} target="_blank" rel="noopener noreferrer" className={linkStyle}>{messages.openReceipt}</a>
              <a href={recordedWalkthrough.snapshotUrl} target="_blank" rel="noopener noreferrer" className={linkStyle}>{messages.openSnapshot}</a>
            </div>
            <button type="button" disabled={check === "checking"} onClick={() => void verify()} className={`${buttonStyle} mt-4`}>{messages.check}</button>
            <p role="status" className="mt-3 text-sm leading-relaxed text-ink-3">{check === "idle" ? null : messages[check]}</p>
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
        <Link href="/" prefetch={false} className={linkStyle}>{messages.composerLink}</Link>
      </section>
    </div>
  );
}
