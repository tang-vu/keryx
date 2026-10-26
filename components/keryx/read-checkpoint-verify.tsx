"use client";
import { economicReplaySummary } from "@/lib/research-audit/economic-checkpoint";
import { useEffect, useRef, useState } from "react";
import { MAX_READ_PACKET_BYTES, verifyActualReadPacket } from "@/lib/research-audit/actual-read-record";
import { actualReadCopy as copy } from "@/lib/research-audit/actual-read-copy";
import type { projectActualReadCheckpoints } from "@/lib/research-audit/actual-read-projection";
import { DecisionCheckpointInspection } from "./decision-checkpoint-inspection";
import { downloadBrowserText } from "@/lib/browser-text-download";
import { reportMessages } from "@/locales/en/reports";

export function ReadCheckpointVerify({ capture }: { capture: ReturnType<typeof projectActualReadCheckpoints> }) {
  const expectedDigest = capture?.retainedDigest ?? null;
  const economicSummary = capture?.packet.schema === 4 ? economicReplaySummary(capture.packet.economics) : null;
  const [session, setSession] = useState({ capture, expectedDigest, generation: 0, file: null as File | null, downloadFailed: false,
    state: "idle" as "idle" | "busy" | "passed" | "refused" });
  const attempt = useRef(0);
  useEffect(() => () => { attempt.current++; }, [capture, expectedDigest]);
  // Reset before rendering a new report, including null. An effect alone can briefly show old PASS.
  if (session.capture !== capture || session.expectedDigest !== expectedDigest) {
    setSession({ capture, expectedDigest, generation: session.generation + 1, file: null, state: "idle", downloadFailed: false });
  }
  const { file, state, generation, downloadFailed } = session;
  const verify = async () => {
    const current = ++attempt.current;
    const publish = (state: typeof session.state) => {
      if (attempt.current === current) setSession(active => active.generation === generation ? { ...active, state } : active);
    };
    publish("busy");
    try {
      if (!capture || !expectedDigest || !file || file.size > MAX_READ_PACKET_BYTES) throw Error("Unavailable checkpoint");
      // Only the packet is submitted. The expected digest comes from the retained report.
      const packet: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()));
      const passed = await verifyActualReadPacket(packet, expectedDigest);
      publish(passed ? "passed" : "refused");
    } catch { publish("refused"); }
  };
  const download = () => {
    if (!capture) return;
    const publish = (downloadFailed: boolean) => setSession(active => active.generation === generation ? { ...active, downloadFailed } : active);
    publish(false);
    try { downloadBrowserText(JSON.stringify(capture.packet), "read-checkpoints.json", "application/json"); }
    catch { publish(true); }
  };
  return <section className="mt-4 min-w-0 border border-line bg-paper p-4" aria-label={copy.title}>
    <h2 className="font-mono text-sm text-ink">{copy.title}</h2>
    <p className="mt-2 text-xs text-ink-3">{capture ? capture.packet.schema === 4 ? copy.economicBoundary : capture.packet.schema === 3 ? copy.optimizerBoundary : capture.packet.schema === 2 ? copy.runtimeBoundary : copy.boundary : copy.unavailable}</p>
    {capture && (capture.packet.schema === 3 || capture.packet.schema === 4) && capture.packet.optimizer.status === "unavailable" && <p className="mt-2 text-xs text-ink-3">{copy.optimizerUnavailable}</p>}
    {capture?.packet.schema === 4 && <p className="mt-2 text-xs text-ink-3">{copy.economicUnavailable}</p>}
    {economicSummary && <dl className="mt-2 text-xs text-ink-3">{(["queryBudget", "citationAllocation", "authorSplit"] as const).map(family =>
      <div key={family}><dt>{copy.economicFamilies[family]}</dt><dd>{copy.economicStatus[economicSummary[family]]}</dd></div>)}</dl>}
    {capture && <>
      <p className="mt-2 text-xs text-ink-3">{copy.modelBoundary}</p>
      <p className="mt-2 text-xs text-ink-3">{copy.amounts}</p>
      <dl className="mt-3 min-w-0 text-xs text-ink-2">
        <dt>{copy.policy}</dt>
        <dd className="mt-1 break-all font-mono">{capture.packet.policy}</dd>
        <dt className="mt-2">{copy.digest}</dt>
        <dd className="mt-1 break-all font-mono">{expectedDigest}</dd>
      </dl>
      <p className="mt-2 text-xs text-ink-3">{copy.digestHelp}</p>
      <button type="button" onClick={download} className="mt-3 min-h-11 border border-line px-3 py-2 font-mono text-xs">{copy.download}</button>
      {downloadFailed && <p role="alert" className="mt-2 text-sm text-seal">{reportMessages["evidenceMatrix.downloadUnavailable"]}</p>}
      <label className="mt-3 block text-xs text-ink-2">{copy.choose}
        <input key={generation} type="file" accept="application/json,.json" className="mt-2 block max-w-full" onChange={event => {
          attempt.current++; const file = event.target.files?.[0] ?? null;
          setSession(active => active.generation === generation ? { ...active, file, state: "idle" } : active);
        }} />
      </label>
      <button type="button" disabled={!file || state === "busy"} onClick={() => void verify()} className="mt-3 min-h-11 border border-line px-3 py-2 font-mono text-xs disabled:opacity-50">{copy.verify}</button>
      {state !== "idle" && <p role="status" className="mt-2 text-sm text-ink-2">{copy[state]}</p>}
      <DecisionCheckpointInspection key={generation} packet={capture.packet} />
    </>}
  </section>;
}
