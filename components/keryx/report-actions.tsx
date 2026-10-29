"use client";

import { useRef, useState } from "react";
import type { AskMeta } from "@/lib/hooks/use-ask-stream";
import type { PaymentRecord, QueryRun } from "@/lib/types";
import { researchReportFilename, researchReportMarkdown } from "@/lib/research-report-export";
import { downloadBrowserText } from "@/lib/browser-text-download";
import { evidenceProcurementCopy } from "@/lib/evidence-procurement/copy";
import { UiMessage } from "@/lib/i18n/ui-copy";
type Props = { run: QueryRun; meta: AskMeta | null; payments: PaymentRecord[] };
type Notice = "reportActions.copied" | "reportActions.copyUnavailable"
  | "reportActions.downloaded" | "reportActions.downloadUnavailable";

export function ReportActions(props: Props) {
  // A previous report's in-flight clipboard result must not label a new report.
  return <ReportActionsForRun key={props.run.id} {...props} />;
}

function ReportActionsForRun({ run, meta, payments }: Props) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [copying, setCopying] = useState(false);
  const copyPending = useRef(false);
  const text = () => researchReportMarkdown(run, meta, payments);
  const buttonClass = "inline-flex min-h-11 max-w-full items-center justify-center gap-2 border px-4 py-3 font-mono text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal";
  const failed = notice === "reportActions.copyUnavailable" || notice === "reportActions.downloadUnavailable";

  async function copyReport() {
    if (copyPending.current) return;
    copyPending.current = true;
    setCopying(true);
    setNotice(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text());
      setNotice("reportActions.copied");
    } catch {
      setNotice("reportActions.copyUnavailable");
    } finally {
      copyPending.current = false;
      setCopying(false);
    }
  }

  function downloadReport() {
    try {
      downloadBrowserText(text(), researchReportFilename(run.id), "text/markdown;charset=utf-8");
      setNotice("reportActions.downloaded");
    } catch {
      setNotice("reportActions.downloadUnavailable");
    }
  }

  return <div className="mt-3 border border-line bg-paper-2 p-3 sm:p-4">
    <div className="flex flex-wrap items-start gap-2">
      <button type="button" aria-busy={copying} aria-disabled={copying}
        className={buttonClass + " border-ink bg-ink text-paper hover:bg-ink/85 aria-disabled:cursor-wait"}
        onClick={() => { void copyReport(); }}>
        {copying
          ? <svg aria-hidden="true" className="h-4 w-4 shrink-0 motion-safe:animate-spin" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="10" cy="10" r="7" opacity=".25" /><path d="M10 3a7 7 0 0 1 7 7" strokeLinecap="round" /></svg>
          : <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="8" width="12" height="13" rx="1" /><path d="M16 8V3H4v14h4" /></svg>}
        <span><UiMessage messageKey="reportActions.copy" /></span>
      </button>
      <button type="button" className={buttonClass + " border-line bg-paper text-ink hover:border-ink hover:bg-paper-2"} onClick={downloadReport}>
        <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4" /></svg>
        <span><UiMessage messageKey="reportActions.download" /></span>
      </button>
      <a href={`/dispatch/${encodeURIComponent(run.id)}`} className={buttonClass + " border-transparent text-ink-2 underline decoration-line underline-offset-4 hover:text-ink hover:decoration-ink"}><UiMessage messageKey="reportActions.openSaved" /><span aria-hidden="true">→</span></a>
      <a href="/operator/evidence" className={buttonClass + " border-transparent text-ink-2 underline decoration-line underline-offset-4 hover:text-ink hover:decoration-ink"}><span lang="en">{evidenceProcurementCopy.links.commission}</span><span aria-hidden="true">→</span></a>
    </div>
    <p role="status" aria-atomic="true" className={`mt-2 min-h-5 text-[13px] leading-relaxed ${failed ? "text-seal" : "text-paid"}`}>{notice ? <UiMessage messageKey={notice} /> : ""}</p>
  </div>;
}
