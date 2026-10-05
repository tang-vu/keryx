"use client";

import { selectionFailureExport } from "@/lib/research/selection-failure-export";
import type { SelectionDiagnostic } from "@/lib/research/selection-diagnostic";

export function SelectionFailureDownload({ diagnostic }: { diagnostic?: SelectionDiagnostic }) {
  const artifact = selectionFailureExport(diagnostic);
  if (!artifact) return null;
  function download() {
    if (!artifact) return;
    const url = URL.createObjectURL(new Blob([artifact.text], { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = artifact.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="mt-3 space-y-2">
    <p>This diagnostic records why source selection was blocked. It is not a completed report or payment receipt.</p>
    <button type="button" onClick={download} className="min-h-11 border border-current px-3 font-mono text-xs focus-visible:outline-2 focus-visible:outline-seal">
      Download failure diagnostic
    </button>
  </div>;
}
