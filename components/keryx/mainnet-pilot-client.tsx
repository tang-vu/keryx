"use client";
import { useEffect, useRef, useState } from "react";
import { createWalletClient, custom, type EIP1193Provider, type Hex } from "viem";
import { compiledMainnetEnrollment } from "@/lib/mainnet-pilot/compiled-mainnet-enrollment";
import { createPilotGrantMessage, type VerifiedPublicMainnetEnrollment } from "@/lib/mainnet-pilot/public-enrollment";
import { pilotGrantSchema } from "@/lib/mainnet-pilot/browser-wire";
import { pilotJson } from "@/lib/mainnet-pilot/browser-http";
import { mainnetPilotSignerClient } from "@/lib/mainnet-pilot/browser-signer-client";
import type { IsolatedWrappedKey } from "@/lib/session/isolated-session-vault";
type Client = ReturnType<typeof mainnetPilotSignerClient>;
type Custody = { owner: string; namespace: string; blob: IsolatedWrappedKey };
function loadBlob(namespace: string): IsolatedWrappedKey | null {
  const raw = sessionStorage.getItem(namespace); if (!raw || raw.length > 4096) return null;
  const value = JSON.parse(raw); return { ...value, wrapped: Uint8Array.from(value.wrapped), iv: Uint8Array.from(value.iv) };
}
export default function MainnetPilotClient() {
  const [enrollment, setEnrollment] = useState<VerifiedPublicMainnetEnrollment | null>(null);
  const [status, setStatus] = useState("Checking invitation…");
  const [custody, setCustody] = useState<Custody | null>(null);
  const [active, setActive] = useState(false), [busy, setBusy] = useState(false);
  const [researching, setResearching] = useState(false);
  const [question, setQuestion] = useState(""), [budget, setBudget] = useState("0.01");
  const [events, setEvents] = useState<Array<{ event: string; data: unknown }>>([]);
  const eventsRef = useRef<Array<{ event: string; data: unknown }>>([]);
  const signer = useRef<Client | null>(null), abort = useRef<AbortController | null>(null);
  const operation = useRef<"wallet" | "research" | "revoke" | null>(null);
  useEffect(() => {
    let cancelled = false;
    void compiledMainnetEnrollment(location.origin).then(e => { if (!cancelled) {
      setEnrollment(e); setStatus("Invited pilot: externally pre-funded sessions only.");
      try { const stored = sessionStorage.getItem(`pilot-research-${e.enrollmentDigest}`);
        if (stored && stored.length <= 262144) { const parsed = JSON.parse(stored); if (Array.isArray(parsed) && parsed.length <= 200) { eventsRef.current = parsed; setEvents(parsed); } }
      } catch { /* unavailable history never grants signing authority */ }
    } },
      () => { if (!cancelled) setStatus("Mainnet pilot enrollment is unavailable on this release."); });
    return () => { cancelled = true; abort.current?.abort(); signer.current?.close(); };
  }, []);
  function appendEvent(event: string, data: unknown) {
    const next = [...eventsRef.current.slice(-199), { event, data }]; eventsRef.current = next; setEvents(next);
    if (enrollment) try {
      const text = JSON.stringify(next); if (text.length <= 262144) sessionStorage.setItem(`pilot-research-${enrollment.enrollmentDigest}`, text);
    } catch { /* keep result and support references in memory */ }
  }
  async function connect() {
    if (!enrollment || operation.current) return; operation.current = "wallet"; setBusy(true); setActive(false);
    try {
      const provider = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
      if (!provider) throw new Error();
      const wallet = createWalletClient({ transport: custom(provider) });
      const [account] = await wallet.requestAddresses(); const owner = account.toLowerCase();
      if (!enrollment.enrollment.invitedBuyers.includes(owner)) throw new Error();
      signer.current?.close(); const worker = mainnetPilotSignerClient(); signer.current = worker;
      const context = await worker.call<{ derivationMessage: string; storageNamespace: string }>({ type: "initialize", owner });
      let blob = loadBlob(context.storageNamespace);
      if (blob) await worker.call({ type: "restore", blob });
      else {
        // Derivation signature stays in this browser and is never sent to an API.
        const signature = await wallet.signMessage({ account, message: context.derivationMessage });
        blob = await worker.call<IsolatedWrappedKey>({ type: "derive", signature });
        sessionStorage.setItem(context.storageNamespace, JSON.stringify({ ...blob, wrapped: [...blob.wrapped], iv: [...blob.iv] }));
      }
      setCustody({ owner, namespace: context.storageNamespace, blob });
      try { await worker.call({ type: "bindGrant" }); setActive(true); setStatus("Restored authenticated pilot session."); }
      catch { setStatus("Session prepared. An owner must fund this fresh signer externally before delegation."); }
    } catch { setStatus("Invitation, wallet or isolated custody could not be verified."); }
    finally { operation.current = null; setBusy(false); }
  }
  async function delegate() {
    if (!enrollment || !custody || !signer.current || operation.current) return; operation.current = "wallet"; setBusy(true);
    try {
      const provider = (window as unknown as { ethereum?: EIP1193Provider }).ethereum; if (!provider) throw new Error();
      const wallet = createWalletClient({ transport: custom(provider) });
      const challenge = pilotGrantSchema.parse(await pilotJson("/api/mainnet-pilot/grant/challenge", "POST", { owner: custody.owner, signer: custody.blob.address.toLowerCase() }));
      if (challenge.owner !== custody.owner || challenge.signer !== custody.blob.address.toLowerCase() || challenge.enrollmentDigest !== enrollment.enrollmentDigest) throw new Error();
      const { enrollmentDigest, ...fields } = challenge;
      const signature = await wallet.signMessage({ account: custody.owner as Hex, message: createPilotGrantMessage(enrollment, fields) });
      await pilotJson("/api/mainnet-pilot/grant", "POST", { ...fields, enrollmentDigest, signature });
      await signer.current.call({ type: "bindGrant" }); setActive(true); setStatus("Authenticated bounded pilot session.");
    } catch { setActive(false); setStatus("Delegation unavailable. Fresh funded balance and reviewed server enrollment are required."); }
    finally { operation.current = null; setBusy(false); }
  }
  async function revoke() {
    if (operation.current === "wallet" || operation.current === "revoke") return;
    abort.current?.abort(); setActive(false); setResearching(false); if (!signer.current || !custody) return; operation.current = "revoke"; setBusy(true);
    try {
      await signer.current.call({ type: "revoke" }); sessionStorage.removeItem(custody.namespace);
      signer.current.close(); signer.current = null; setCustody(null);
      setStatus("Server grant revoked and this tab’s custody cleared. Authorizations and unspent Gateway balance remain; no refund occurred.");
    } catch { setStatus("Revocation could not be confirmed. Session paused; encrypted custody retained for recovery."); }
    finally { operation.current = null; setBusy(false); }
  }
  async function ask() {
    if (!active || !signer.current || !enrollment || !question.trim() || operation.current) return;
    const value = Number(budget); if (!Number.isFinite(value) || value <= 0 || value*1e6 > enrollment.enrollment.limits.perAskMicros || !/^\d+(?:\.\d{1,6})?$/.test(budget)) return;
    operation.current = "research"; setResearching(true); setBusy(true); const controller = new AbortController(); abort.current = controller; eventsRef.current = []; setEvents([]);
    try {
      const response = await fetch("/api/mainnet-pilot/ask", { method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, budgetUsd: value }), signal: controller.signal });
      if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) throw new Error();
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const next = await reader.read(); if (next.done) break; buffer += decoder.decode(next.value, { stream: true });
        if (buffer.length > 262144) throw new Error();
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const event = /^event: (.+)$/m.exec(frame)?.[1], dataLine = /^data: (.+)$/m.exec(frame)?.[1];
          if (!event || !dataLine) continue; const data = JSON.parse(dataLine);
          if (event === "sign-request") {
            // SSE provides a notification only. Worker reads the exact admitted challenge itself.
            const reqId = typeof data.reqId === "string" ? data.reqId : "";
            try {
              const signed = await signer.current!.call<{ paymentHeader: string }>({ type: "sign", reqId });
              if (controller.signal.aborted) throw new Error();
              await pilotJson("/api/mainnet-pilot/sign", "POST", { reqId, paymentHeader: signed.paymentHeader });
              appendEvent("authorization", { reqId, status: "submitted; settlement awaits evidence" });
            } catch { appendEvent("authorization", { reqId, status: "refused or interrupted; capacity may be retained" }); }
          } else {
            appendEvent(event, data);
          }
        }
      }
      setStatus("Research finished. Pending or uncertain payments require settlement evidence.");
    } catch { setStatus("Research interrupted. Retained allocation and authorizations require review before retrying."); }
    finally { setResearching(false); if (operation.current === "research") { operation.current = null; setBusy(false); } if (abort.current === controller) abort.current = null; }
  }
  return <main className="mx-auto max-w-3xl space-y-5 p-6">
    <h1 className="text-2xl font-semibold">Invited mainnet research pilot</h1><p role="status">{status}</p>
    {enrollment && <>
      <p>Maximum pilot allocation: {enrollment.enrollment.limits.totalMicros/1e6} USDC. Your allocation: at most {enrollment.enrollment.limits.perBuyerMicros/1e6} USDC. Allocation is reserved capacity, not settled spending. Failed or interrupted asks may retain capacity pending review.</p>
      <p>Only this invited browser can co-sign. Funding and withdrawal are separate owner operations; this page cannot withdraw or refund Gateway funds.</p>
      <button disabled={busy} onClick={() => void connect()} className="rounded border px-3 py-2">Connect or restore invited wallet</button>
      {custody && <><p>Fresh isolated session signer: <code>{custody.blob.address}</code></p>
        <button disabled={busy || active} onClick={() => void delegate()} className="rounded border px-3 py-2">Delegate funded session</button>
        <button disabled={busy && !researching} onClick={() => void revoke()} className="ml-3 rounded border px-3 py-2">Revoke session and clear this tab</button></>}
      <label className="block">Question<textarea value={question} onChange={e => setQuestion(e.target.value)} className="block w-full rounded border p-2" /></label>
      <label className="block">Ask allocation (USDC)<input value={budget} onChange={e => setBudget(e.target.value)} className="ml-2 rounded border p-2" /></label>
      <button disabled={!active || busy} onClick={() => void ask()} className="rounded border px-3 py-2">Research with bounded co-signing</button>
      <button disabled={!busy} onClick={() => abort.current?.abort()} className="ml-3 rounded border px-3 py-2">Stop research</button>
      <p>Same-origin script compromise can decrypt stored custody when it obtains the ciphertext. Use only a reviewed origin and a tiny funded session.</p>
      {events.map((event, i) => {
        const answer = event.event === "done" && event.data && typeof event.data === "object" && "answer" in event.data ? String(event.data.answer) : null;
        return answer ? <section key={i}><h2 className="text-xl font-semibold">Answer</h2><p className="whitespace-pre-wrap">{answer}</p>
          <details><summary>Trace, receipts and support references</summary><pre className="whitespace-pre-wrap break-words">{JSON.stringify(event.data, null, 2)}</pre></details></section>
          : <details key={i}><summary>{event.event}</summary><pre className="whitespace-pre-wrap break-words">{JSON.stringify(event.data, null, 2)}</pre></details>;
      })}
    </>}
  </main>;
}
