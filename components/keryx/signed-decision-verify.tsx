"use client";
import { useEffect, useRef, useState } from "react";
import { decisionAuditTrustAnchor, MAX_SIGNED_DECISION_BUNDLE_BYTES, verifySignedDecisionBundle } from "@/lib/research-audit/signed-decision-bundle";
import { decisionLabCopy as copy } from "@/lib/research-audit/decision-lab-copy";

export function SignedDecisionVerify() {
  const [file, setFile] = useState<File | null>(null);
  const [publicKey, setPublicKey] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "passed" | "refused">("idle");
  const attempt = useRef(0);
  useEffect(() => () => { attempt.current++; }, []);
  const invalidate = () => { attempt.current++; setState("idle"); };
  const verify = async () => {
    const current = ++attempt.current; setState("busy");
    try {
      if (!file || file.size > MAX_SIGNED_DECISION_BUNDLE_BYTES) throw Error("Bundle refused");
      const bytes = await file.arrayBuffer();
      if (bytes.byteLength > MAX_SIGNED_DECISION_BUNDLE_BYTES) throw Error("Bundle refused");
      const bundle: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      const anchor = await decisionAuditTrustAnchor(publicKey);
      const result = await verifySignedDecisionBundle(bundle, anchor);
      if (attempt.current === current) setState(result.verified ? "passed" : "refused");
    } catch { if (attempt.current === current) setState("refused"); }
  };
  return <section className="mt-5 border border-line bg-paper p-4 sm:p-5" aria-label={copy.signedTitle}>
    <h2 className="font-display text-2xl">{copy.signedTitle}</h2>
    <p className="mt-2 max-w-3xl text-sm text-ink-3">{copy.signedHelp}</p>
    <label className="mt-4 block text-sm">{copy.signedFile}<input type="file" accept="application/json,.json" className="mt-2 block max-w-full" onChange={event => { invalidate(); setFile(event.target.files?.[0] ?? null); }} /></label>
    <label className="mt-4 block text-sm">{copy.publicKey}<input value={publicKey} maxLength={59} spellCheck={false} autoComplete="off" className="mt-1 block min-h-11 w-full border border-line bg-paper px-3 py-2 font-mono text-xs" onChange={event => { invalidate(); setPublicKey(event.target.value); }} /></label>
    <button type="button" onClick={() => void verify()} disabled={!file || !publicKey || state === "busy"} className="mt-4 min-h-11 border border-ink px-4 py-2 font-mono text-xs disabled:opacity-50">{copy.verifySignature}</button>
    {state !== "idle" && <p role="status" className="mt-3 text-sm">{state === "busy" ? copy.busy : state === "passed" ? copy.signedPassed : copy.signedRefused}</p>}
  </section>;
}
