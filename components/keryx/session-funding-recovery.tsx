"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import type { PublicClient } from "viem";
import { listFundingRecords } from "@/lib/buyer/funding-journal";
import { recoverFundingStep } from "@/lib/buyer/funding-client";
import type { FundingRecord, FundingStep } from "@/lib/buyer/funding-policy";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";
import { useUiMessages } from "@/lib/i18n/ui-copy";
import { formatAmount } from "@/lib/i18n/format";
import { SigningAmount } from "./signing-amount";

/** Inspect the existing original only: no wallet client, signing, deposit, or lock release. */
export function SessionFundingRecovery({ payer, revision = "" }: { payer: string; revision?: string }) {
  const copy = useUiMessages(), profile = browserPaymentProfile();
  const chain = usePublicClient({ chainId: profile.chainId }) as PublicClient | undefined;
  const [record, setRecord] = useState<FundingRecord | null>(null);
  const [hash, setHash] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const live = useRef(false), checking = useRef(false), readEpoch = useRef(0);
  const refresh = useCallback(async () => {
    const epoch = ++readEpoch.current;
    const rows = await listFundingRecords(payer);
    if (live.current && epoch === readEpoch.current) setRecord(rows.find(row => row.activePayer === payer.toLowerCase()) ?? null);
  }, [payer]);
  useEffect(() => {
    live.current = true;
    void refresh().catch(() => { if (live.current) setMessage(copy("gatewayFunding.recordsUnavailable")); });
    return () => { live.current = false; };
  }, [refresh, copy, revision]);

  async function inspect(step: FundingStep) {
    if (!record || !chain || checking.current) return;
    checking.current = true; setBusy(true); setMessage("");
    try {
      const original = await recoverFundingStep(record.id, step, chain, record[step].hash ?? hash.trim());
      if (live.current) {
        setHash("");
        setMessage(copy(original[step].status === "confirmed"
          ? step === "approval" ? "gatewayFunding.confirmedApproval" : "gatewayFunding.confirmedDeposit"
          : original[step].status === "reverted" ? "gatewayFunding.reverted" : "gatewayFunding.unconfirmed"));
        await refresh();
      }
    } catch { if (live.current) setMessage(copy("gatewayFunding.unconfirmed")); }
    finally { checking.current = false; if (live.current) setBusy(false); }
  }

  if (!record && !message) return null;
  return <section className="space-y-3 border border-seal/40 bg-paper p-3" aria-label={copy("gatewayFunding.inspectTransaction")}>
    <h3 className="font-serif text-sm">{copy("gatewayFunding.inspectTransaction")}</h3>
    {record && <>
      <p className="text-sm">{copy("gatewayFunding.existingTransaction")}</p>
      <SigningAmount micros={record.amount} />
      <p className="text-xs">{copy("gatewayFunding.plannedDeposit", { amount: formatAmount(BigInt(record.amount), { minimumFractionDigits: 6, useGrouping: false }) })}</p>
      {(["approval", "deposit"] as const).map(step => <div key={step} className="space-y-2 border-t border-line pt-2">
        <p className="font-mono text-xs">{copy(step === "approval" ? "gatewayFunding.approvalStatus" : "gatewayFunding.depositStatus", { status: record[step].status })}</p>
        {["possible", "submitted"].includes(record[step].status) && <>
          {!record[step].hash && <label className="grid gap-2 text-xs">{copy("gatewayFunding.transactionHash")}
            <input value={hash} onChange={event => setHash(event.target.value)} autoComplete="off" spellCheck={false} disabled={busy}
              className="min-w-0 border border-line bg-paper p-2 font-mono text-xs" />
          </label>}
          <button type="button" disabled={busy || !chain || (!record[step].hash && !/^0x[a-fA-F0-9]{64}$/.test(hash.trim()))}
            className="min-h-11 border border-ink px-3 text-xs disabled:opacity-40" onClick={() => { void inspect(step); }}>
            {copy("gatewayFunding.checkOriginal")}
          </button>
        </>}
        {record[step].hash && <a className="block break-all font-mono text-xs underline" href={`${profile.explorerUrl}/tx/${record[step].hash}`} target="_blank" rel="noreferrer">{copy("gatewayFunding.viewNetworkTransaction")}</a>}
      </div>)}
    </>}
    {message && <p role="status" className="text-xs">{message}</p>}
    <button type="button" disabled={busy} className="min-h-11 text-xs underline disabled:opacity-40" onClick={() => {
      setMessage(""); void refresh().catch(() => { if (live.current) setMessage(copy("gatewayFunding.recordsUnavailable")); });
    }}>{copy("gatewayFunding.refreshStatus")}</button>
  </section>;
}
