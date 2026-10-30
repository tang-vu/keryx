"use client";

import { useEffect, useId, useRef, useState } from "react";
import { setupCopy } from "@/locales/en/get-started";
import { UiText, useUiCopy } from "@/lib/i18n/ui-copy";
const uiEnglish_setupCopy = setupCopy;


/** Copy-only examples: displaying or copying never executes a command. */
export function SetupCode(props: { title: string; value: string }) {
  return <SetupCodeExample key={JSON.stringify([props.title, props.value])} {...props} />;
}

function SetupCodeExample({ title, value }: { title: string; value: string }) {
  const setupCopy = useUiCopy("get-started", uiEnglish_setupCopy);
  const translatedTitle = useUiCopy("get-started", title);
  const titleId = useId();
  const [status, setStatus] = useState<"idle" | "pending" | "copied" | "failed">("idle");
  const pending = useRef(false), mounted = useRef(true);
  const example = useRef<HTMLPreElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  async function copy() {
    if (pending.current) return;
    pending.current = true; setStatus("pending");
    try {
      await navigator.clipboard.writeText(value);
      if (mounted.current) setStatus("copied");
    } catch {
      if (!mounted.current) return;
      setStatus("failed"); example.current?.focus();
      try {
        const selection = window.getSelection();
        if (example.current && selection) {
          const range = document.createRange(); range.selectNodeContents(example.current);
          selection.removeAllRanges(); selection.addRange(range);
        }
      } catch { /* The focused example remains available for manual selection. */ }
    } finally { pending.current = false; }
  }
  return <div className="mt-4 min-w-0 border border-line bg-paper-2">
    <div className="flex items-center justify-between gap-3 border-b border-line px-4">
      <p id={titleId} className="font-mono text-xs text-ink-2"><UiText source={title} namespaces={["get-started"]} /></p>
      <button type="button" onClick={copy} aria-busy={status === "pending"} aria-disabled={status === "pending"} aria-label={`${setupCopy.common.copy} ${translatedTitle}`} className="min-h-11 shrink-0 font-mono text-xs text-paid underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal aria-disabled:cursor-wait">
        <UiText source={status === "copied" ? uiEnglish_setupCopy.common.copied : uiEnglish_setupCopy.common.copy} namespaces={["get-started"]} />
      </button>
    </div>
    <pre ref={example} tabIndex={0} aria-labelledby={titleId} dir="ltr" translate="no" className="max-w-full overflow-x-auto p-4 font-mono text-xs leading-relaxed text-ink focus-visible:outline-2 focus-visible:outline-seal"><code lang="en">{value}</code></pre>
    <p role="status" aria-atomic="true" className="px-4 font-mono text-xs text-seal"><UiText source={status === "failed" ? uiEnglish_setupCopy.common.copyFailed : status === "copied" ? uiEnglish_setupCopy.common.copied : ""} namespaces={["get-started"]} /></p>
  </div>;
}
