"use client";

import { useState } from "react";
import { setupCopy } from "@/locales/en/get-started";

/** Copy-only examples: displaying or copying never executes a command. */
export function SetupCode({ title, value }: { title: string; value: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try { await navigator.clipboard.writeText(value); setStatus("copied"); }
    catch { setStatus("failed"); }
  }
  return <div className="mt-4 min-w-0 border border-line bg-paper-2">
    <div className="flex items-center justify-between gap-3 border-b border-line px-4">
      <p className="font-mono text-xs text-ink-2">{title}</p>
      <button type="button" onClick={copy} aria-label={`${setupCopy.common.copy} ${title}`} className="min-h-11 shrink-0 font-mono text-xs text-paid underline underline-offset-4">
        {status === "copied" ? setupCopy.common.copied : setupCopy.common.copy}
      </button>
    </div>
    <pre tabIndex={0} aria-label={title} className="max-w-full overflow-x-auto p-4 font-mono text-xs leading-relaxed text-ink"><code>{value}</code></pre>
    <p role="status" className="px-4 font-mono text-xs text-seal">{status === "failed" ? setupCopy.common.copyFailed : status === "copied" ? setupCopy.common.copied : ""}</p>
  </div>;
}
