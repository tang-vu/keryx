"use client";

import { createMessages } from "@/lib/i18n/messages";
import Link from "next/link";
import { useState } from "react";
import type { PaperRecord } from "@/lib/papers/types";
import { saveLiteraturePaper } from "@/lib/papers/literature-workspace";
import { changeLiteratureWorkspace, useLiteratureWorkspace } from "@/lib/papers/literature-browser-store";

const copy = createMessages("en");

export function PaperSaveButton({ paper }: { paper: PaperRecord }) {
  const { ready, workspace, error: storageError } = useLiteratureWorkspace();
  const [error, setError] = useState("");
  const saved = workspace.entries.some(entry => entry.paper.url === paper.url);
  return <div className="mt-3 border-t border-line pt-3">
    {saved ? <Link prefetch={false} href="/literature" className="inline-flex min-h-11 items-center font-mono text-xs text-seal underline">{copy("paperSave.saved")}</Link>
      : <button type="button" disabled={!ready || !!storageError} onClick={async () => {
        try { await changeLiteratureWorkspace(current => saveLiteraturePaper(current, paper, new Date().toISOString())); setError(""); }
        catch (failure) { setError(failure instanceof Error ? failure.message : copy("paperSave.failed")); }
      }} className="min-h-11 border border-line px-3 py-2 font-mono text-xs text-seal hover:border-ink disabled:opacity-60">{copy("paperSave.save")}</button>}
    <p className="mt-1 font-serif text-xs text-ink-3">{copy("paperSave.notice")}</p>
    {(error || storageError) && <p role="alert" className="mt-2 break-words font-serif text-sm text-seal">{error || storageError} <Link href="/literature" className="underline">{copy("paperSave.open")}</Link></p>}
  </div>;
}
