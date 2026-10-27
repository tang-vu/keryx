"use client";





import { selectionFailureExport } from "@/lib/research/selection-failure-export";
import type { SelectionDiagnostic } from "@/lib/research/selection-diagnostic";
import { useUiMessages } from "@/lib/i18n/ui-copy";
import { useState } from "react";
import { downloadBrowserText } from "@/lib/browser-text-download";



export function SelectionFailureDownload({ diagnostic }: { diagnostic?: SelectionDiagnostic }) {
  const artifact = selectionFailureExport(diagnostic);
  return artifact ? <FailureArtifactDownload key={artifact.text} artifact={artifact} /> : null;
}

function FailureArtifactDownload({ artifact }: { artifact: { filename: string; text: string } }) {
  const message = useUiMessages();
  const [failed, setFailed] = useState(false);
  function download() {
    setFailed(false);
    try { downloadBrowserText(artifact.text, artifact.filename, "application/json;charset=utf-8"); }
    catch { setFailed(true); }
  }
  return <div className="mt-3 space-y-2">
    <p>{message("sourceDecision.diagnosticNotice")}</p>
    <button type="button" onClick={download} className="min-h-11 border border-current px-3 font-mono text-xs focus-visible:outline-2 focus-visible:outline-seal">
      {message("sourceDecision.downloadDiagnostic")}
    </button>
    {failed && <p role="alert" className="text-seal">{message("evidenceMatrix.downloadUnavailable")}</p>}
  </div>;
}
