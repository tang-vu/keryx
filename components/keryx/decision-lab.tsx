"use client";
import { useEffect, useRef, useState } from "react";
import { canonicalReadPacket, MAX_READ_PACKET_BYTES, verifyActualReadPacket, type ActualReadPacket } from "@/lib/research-audit/actual-read-record";
import { syntheticDecisionShowcasePacket } from "@/lib/research-audit/decision-inspection";
import { decisionLabCopy as copy } from "@/lib/research-audit/decision-lab-copy";
import { DecisionCheckpointInspection } from "./decision-checkpoint-inspection";
import { SignedDecisionVerify } from "./signed-decision-verify";
import { useHydrated } from "@/lib/hooks/use-hydrated";

const buttonClass = "min-h-11 border border-ink px-4 py-2 font-mono text-xs disabled:opacity-50";

export function DecisionLab() {
  const hydrated = useHydrated();
  const [packet, setPacket] = useState<ActualReadPacket>(syntheticDecisionShowcasePacket);
  const [recorded, setRecorded] = useState(false);
  const [recordedDigest, setRecordedDigest] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [expectedDigest, setExpectedDigest] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "verified" | "refused">("idle");
  const [generation, setGeneration] = useState(0);
  const attempt = useRef(0);
  useEffect(() => () => { attempt.current++; }, []);
  const invalidate = () => { attempt.current++; setState("idle"); };
  const inspect = async () => {
    const current = ++attempt.current;
    setState("busy");
    try {
      if (!file || file.size > MAX_READ_PACKET_BYTES || !/^[a-f0-9]{64}$/.test(expectedDigest)) throw Error("Unavailable recording");
      const bytes = await file.arrayBuffer();
      if (bytes.byteLength > MAX_READ_PACKET_BYTES) throw Error("Oversized recording");
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!await verifyActualReadPacket(value, expectedDigest)) throw Error("Recording refused");
      if (attempt.current !== current) return;
      setPacket(JSON.parse(canonicalReadPacket(value)) as ActualReadPacket);
      setRecorded(true); setRecordedDigest(expectedDigest); setGeneration(value => value + 1); setState("verified");
    } catch { if (attempt.current === current) setState("refused"); }
  };
  const reset = () => {
    invalidate(); setPacket(syntheticDecisionShowcasePacket()); setRecorded(false); setRecordedDigest(null); setGeneration(value => value + 1);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([canonicalReadPacket(packet)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = recorded ? "read-checkpoints.json" : "synthetic-read-checkpoints.json";
    link.click(); URL.revokeObjectURL(url);
  };
  return <div className="mt-8 min-w-0">
    <section className="border-l-4 border-seal bg-paper px-5 py-4" aria-label={copy.shadowTitle}>
      <h2 className="font-display text-2xl">{copy.shadowTitle}</h2>
      <p className="mt-2 font-mono text-xs uppercase tracking-wide text-seal">{recorded ? copy.recorded : copy.sample}</p>
      <p className="mt-2 max-w-3xl text-sm text-ink-3">{recorded ? copy.recordedBoundary : copy.shadowBoundary}</p>
      {recordedDigest && <p className="mt-2 break-all font-mono text-xs text-ink-3">{copy.digest}: {recordedDigest}</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" disabled={!hydrated} onClick={reset} className={buttonClass}>{copy.reset}</button>
        <button type="button" disabled={!hydrated} onClick={download} className={buttonClass}>{copy.download}</button>
      </div>
    </section>
    <DecisionCheckpointInspection key={generation} packet={packet} />
    <section className="mt-5 border border-line bg-paper p-4 sm:p-5" aria-label={copy.importTitle}>
      <h2 className="font-display text-2xl">{copy.importTitle}</h2>
      <p className="mt-2 max-w-3xl text-sm text-ink-3">{copy.importHelp}</p>
      <label className="mt-4 block text-sm">{copy.file}<input disabled={!hydrated} type="file" accept="application/json,.json" className="mt-2 block max-w-full" onChange={event => { invalidate(); setFile(event.target.files?.[0] ?? null); }} /></label>
      <label className="mt-4 block text-sm">{copy.digest}<input disabled={!hydrated} value={expectedDigest} maxLength={64} spellCheck={false} autoComplete="off" className="mt-1 block min-h-11 w-full border border-line bg-paper px-3 py-2 font-mono text-xs" onChange={event => { invalidate(); setExpectedDigest(event.target.value); }} /></label>
      <button type="button" onClick={() => void inspect()} disabled={!file || state === "busy"} className={`${buttonClass} mt-4`}>{copy.inspect}</button>
      {state !== "idle" && <p role="status" className="mt-3 text-sm">{copy[state]}</p>}
    </section>
    <SignedDecisionVerify />
    <p className="mt-4 text-xs text-ink-3">{copy.disclosure}</p>
  </div>;
}
