"use client";

import { useState } from "react";
import type { AskMeta } from "@/lib/hooks/use-ask-stream";
import type { PaymentRecord, QueryRun } from "@/lib/types";
import { researchReportFilename, researchReportMarkdown } from "@/lib/research-report-export";

export function ReportActions({ run, meta, payments }: { run: QueryRun; meta: AskMeta | null; payments: PaymentRecord[] }) {
  const [message, setMessage] = useState("");
  const text = () => researchReportMarkdown(run, meta, payments);
  const buttonClass = "min-h-11 border border-line bg-paper px-3 py-2 font-mono text-xs hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal";
  return <div className="mt-2 flex flex-wrap items-center gap-2">
    <button type="button" className={buttonClass} onClick={() => {
      if (!navigator.clipboard?.writeText) { setMessage("Copy unavailable. Download the report instead."); return; }
      try {
      void navigator.clipboard.writeText(text()).then(() => setMessage("Report copied with citations and payment states."), () => setMessage("Copy unavailable. Download the report instead."));
      } catch { setMessage("Copy unavailable. Download the report instead."); }
    }}>Copy report</button>
    <button type="button" className={buttonClass} onClick={() => {
      try {
      const url = URL.createObjectURL(new Blob([text()], { type: "text/markdown;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url; link.download = researchReportFilename(run.id); link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Report downloaded with citations and payment states.");
      } catch { setMessage("Download unavailable. Open the saved report instead."); }
    }}>Download report</button>
    <a href={`/dispatch/${encodeURIComponent(run.id)}`} className={buttonClass}>Open saved report</a>
    <span role="status" className="text-xs text-ink-3">{message}</span>
  </div>;
}
