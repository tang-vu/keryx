"use client";

import { createMessages } from "@/lib/i18n/messages";
import { useState } from "react";
import type { AskMeta } from "@/lib/hooks/use-ask-stream";
import type { PaymentRecord, QueryRun } from "@/lib/types";
import { researchReportFilename, researchReportMarkdown } from "@/lib/research-report-export";

const copy = createMessages("en");

export function ReportActions({ run, meta, payments }: { run: QueryRun; meta: AskMeta | null; payments: PaymentRecord[] }) {
  const [message, setMessage] = useState("");
  const text = () => researchReportMarkdown(run, meta, payments);
  const buttonClass = "min-h-11 border border-line bg-paper px-3 py-2 font-mono text-xs hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal";
  return <div className="mt-2 flex flex-wrap items-center gap-2">
    <button type="button" className={buttonClass} onClick={() => {
      if (!navigator.clipboard?.writeText) { setMessage(copy("reportActions.copyUnavailable")); return; }
      try {
      void navigator.clipboard.writeText(text()).then(() => setMessage(copy("reportActions.copied")), () => setMessage(copy("reportActions.copyUnavailable")));
      } catch { setMessage(copy("reportActions.copyUnavailable")); }
    }}>{copy("reportActions.copy")}</button>
    <button type="button" className={buttonClass} onClick={() => {
      try {
      const url = URL.createObjectURL(new Blob([text()], { type: "text/markdown;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url; link.download = researchReportFilename(run.id); link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(copy("reportActions.downloaded"));
      } catch { setMessage(copy("reportActions.downloadUnavailable")); }
    }}>{copy("reportActions.download")}</button>
    <a href={`/dispatch/${encodeURIComponent(run.id)}`} className={buttonClass}>{copy("reportActions.openSaved")}</a>
    <span role="status" className="text-xs text-ink-3">{message}</span>
  </div>;
}
