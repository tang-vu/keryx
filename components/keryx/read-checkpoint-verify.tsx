"use client";
import { useEffect, useRef, useState } from "react";
import { MAX_READ_PACKET_BYTES, verifyActualReadPacket } from "@/lib/research-audit/actual-read-record";
import { actualReadCopy as copy } from "@/lib/research-audit/actual-read-copy";
import type { projectActualReadCheckpoints } from "@/lib/research-audit/actual-read-projection";

export function ReadCheckpointVerify({ capture }: { capture: ReturnType<typeof projectActualReadCheckpoints> }) {
  const expectedDigest = capture?.retainedDigest ?? null;
  const [session, setSession] = useState({ capture, expectedDigest, generation: 0, file: null as File | null,
    state: "idle" as "idle" | "busy" | "passed" | "refused" });
  const attempt = useRef(0);
  useEffect(() => () => { attempt.current++; }, [capture, expectedDigest]);
  // Reset before rendering a new report, including null. An effect alone can briefly show old PASS.
  if (session.capture !== capture || session.expectedDigest !== expectedDigest) {
    setSession({ capture, expectedDigest, generation: session.generation + 1, file: null, state: "idle" });
  }
  const { file, state, generation } = session;
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
    const url = URL.createObjectURL(new Blob([JSON.stringify(capture.packet)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "read-checkpoints.json";
    link.click(); URL.revokeObjectURL(url);
  };
  return <section className="mt-4 min-w-0 border border-line bg-paper p-4" aria-label={copy.title}>
    <h2 className="font-mono text-sm text-ink">{copy.title}</h2>
    <p className="mt-2 text-xs text-ink-3">{capture ? copy.boundary : copy.unavailable}</p>
    {capture && <>
      <p className="mt-2 text-xs text-ink-3">{copy.amounts}</p>
      <button type="button" onClick={download} className="mt-3 min-h-11 border border-line px-3 py-2 font-mono text-xs">{copy.download}</button>
      <label className="mt-3 block text-xs text-ink-2">{copy.choose}
        <input key={generation} type="file" accept="application/json,.json" className="mt-2 block max-w-full" onChange={event => {
          attempt.current++; const file = event.target.files?.[0] ?? null;
          setSession(active => active.generation === generation ? { ...active, file, state: "idle" } : active);
        }} />
      </label>
      <button type="button" disabled={!file || state === "busy"} onClick={() => void verify()} className="mt-3 min-h-11 border border-line px-3 py-2 font-mono text-xs disabled:opacity-50">{copy.verify}</button>
      {state !== "idle" && <p role="status" className="mt-2 text-sm text-ink-2">{copy[state]}</p>}
    </>}
  </section>;
}
