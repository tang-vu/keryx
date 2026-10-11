"use client";
import { formatRecordedAmount, formatNumber, selectPlural } from "@/lib/i18n/format";
import { DisplayTime } from "./display-time";
import type { ReactNode } from "react";


import { arcProfileLabel, recordedArcProfile } from "@/lib/arc-network-display";
import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";

const message = createMessages("en");
const richMessage = createRichMessages("en");

/**
 * /status section for settlement parity: what Keryx's payout ledger claims is still sitting in
 * Circle's Gateway for creators, against what Circle itself says it holds for those same wallets.
 *
 * Citation payouts settle inside the Gateway, so their receipt is a Circle transfer id and not an
 * EVM hash — there is no explorer page a reader can open to check a payout. This section is the
 * answer to that: a public, unauthenticated third-party API confirming the figures wallet by
 * wallet, with the request shown so anyone can run it themselves.
 *
 * The watchdog (scripts/check-settlement.mts, hourly) does the round-trip; /api/health serves the
 * summary here. Surplus is not an anomaly and is never styled as one — a creator's Gateway balance
 * is their own account, and may hold money from elsewhere. Only a shortfall is a finding.
 */

/** Mirrors the `settlement` object /api/health returns. */
export interface SettlementHealth {
  basis?: "empty-ledger";
  network?: string;
  checkedAt: string;
  owedUsdc: number;
  confirmedUsdc: number;
  cashedOutUsdc: number;
  counts: { confirmed: number; surplus: number; cashedOut: number; short: number; unknown: number };
  accounts: {
    address: string;
    label?: string;
    owedUsdc: number;
    heldUsdc: number | null;
    onchainUsdc?: number | null;
    verdict: "confirmed" | "surplus" | "cashedOut" | "short" | "unknown";
  }[];
}

function ago(iso: string) {
  return <DisplayTime value={iso} relative />;
}

const usd = (n: number) => `$${formatRecordedAmount(n, { minimumFractionDigits: 6 })}`;

export function SettlementProofSection({ settlement }: { settlement: SettlementHealth }) {
  const { counts, accounts } = settlement;
  if (settlement.basis === "empty-ledger" && accounts.length === 0 &&
      settlement.owedUsdc === 0 && settlement.confirmedUsdc === 0 && settlement.cashedOutUsdc === 0 &&
      Object.values(counts).every(count => count === 0)) {
    return <section className="mt-8 border-t border-line pt-5">
      <h2 className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">{message("statusSettlement.settlementEmptyLedger")}</h2>
      <p className="mt-3 text-sm text-ink-3">{message("statusSettlement.noSettledOutboundPaymentsWereRecordedAtThis")}</p>
      <p className="mt-2 font-mono text-[10px] text-faint">{richMessage("statusSettlement.checkedCheckedAt", { checkedAt: ago(settlement.checkedAt) })}</p>
    </section>;
  }
  // "Backed" includes wallets whose money the creator has since moved out to their own address:
  // the payout is still accounted for, just not by Circle. Only `short` is unaccounted for.
  const backed = counts.confirmed + counts.surplus + counts.cashedOut;
  const answered = backed + counts.short;
  const top = accounts.slice(0, 8);
  // Never assign the current deployment's network to a retained balance observation.
  const recordedProfile = settlement.network === undefined ? undefined : recordedArcProfile(settlement.network);

  return (
    <>
      <div className="mt-8 border-t border-line pt-5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">{message("statusSettlement.settlementConfirmedByCircle")}</div>
      <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-5 font-mono text-[12px]">
        <Row
          k={message("statusSettlement.walletsBacked")}
          v={
            answered === 0
              ? "—"
              : <>{formatNumber(backed)}/{formatNumber(answered)} · {ago(settlement.checkedAt)}</>
          }
          alert={counts.short > 0}
        />
        <Row k={message("statusSettlement.ledgerClaimsHeld")} v={usd(settlement.owedUsdc)} />
        <Row
          k={message("statusSettlement.circleConfirms")}
          v={
            usd(settlement.confirmedUsdc) +
            (settlement.cashedOutUsdc > 0 ? message("statusSettlement.cashedOutAmount", { amount: usd(settlement.cashedOutUsdc) }) : "")
          }
        />
        <Row
          k={counts.unknown > 0 ? message("statusSettlement.shortUnverified") : message("statusSettlement.short")}
          v={
            // An unverified wallet is not a clean row: Circle or the Arc RPC did not complete the
            // evidence chain, so "Circle confirms" above understates what is really backed.
            (counts.short === 0 ? message("statusSettlement.none") : message(selectPlural(counts.short) === "one" ? "statusSettlement.shortWallets.one" : "statusSettlement.shortWallets.other", { count: counts.short })) +
            (counts.unknown > 0 ? message(selectPlural(counts.unknown) === "one" ? "statusSettlement.unverified.one" : "statusSettlement.unverified.other", { count: counts.unknown }) : "")
          }
          alert={counts.short > 0}
        />
      </dl>

      {top.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[30rem] border-collapse font-mono text-[11px]">
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th className="py-1.5 pr-3 font-normal">{message("statusSettlement.payeeWallet")}</th>
                <th className="py-1.5 pr-3 text-right font-normal">{message("statusSettlement.keryxClaims")}</th>
                <th className="py-1.5 pr-3 text-right font-normal">{message("statusSettlement.circleHolds")}</th>
                <th className="py-1.5 text-right font-normal">{message("statusSettlement.verdict")}</th>
              </tr>
            </thead>
            <tbody>
              {top.map((a) => (
                <tr key={a.address} className="border-b border-line/50">
                  <td className="py-1.5 pr-3 text-ink" title={a.address}>
                    {a.label ?? `${a.address.slice(0, 6)}…${a.address.slice(-4)}`}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-ink-2">
                    {usd(a.owedUsdc)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-ink-2">
                    {a.heldUsdc === null ? "—" : usd(a.heldUsdc)}
                    {a.verdict === "cashedOut" && typeof a.onchainUsdc === "number" && (
                      <span className="text-faint">{richMessage("statusSettlement.onchainUsdcInWallet", { onchainUsdc: usd(a.onchainUsdc) })}</span>
                    )}
                  </td>
                  <td
                    className={`py-1.5 text-right ${a.verdict === "short" ? "text-destructive" : "text-ink-3"}`}
                  >
                    {a.verdict === "cashedOut" ? message("statusSettlement.cashedOut") : a.verdict}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 font-mono text-[10px] leading-relaxed tracking-wide text-faint">{richMessage("statusSettlement.gatewaySettlementLeavesNoPerPaymentExplorerHash", { emphasis: <em>{message("statusSettlement.more")}</em> })}</p>
      {recordedProfile ? <>
      <p className="mt-2 text-xs text-ink-2">{richMessage("statusSettlement.checkACurrentBalanceOnThisObservationS", { networkLabel: arcProfileLabel(recordedProfile) })}</p>
      <pre className="mt-2 overflow-x-auto border border-line bg-paper-2 p-3 font-mono text-[10px] leading-relaxed text-ink-2">
{`curl -s ${recordedProfile.gatewayApiUrl}/v1/balances \\
  -H 'content-type: application/json' \\
  -d '{"token":"USDC","sources":[{"depositor":"${top[0]?.address ?? "0x…"}","domain":26}]}'`}
      </pre>
      </> : <p className="mt-2 text-xs text-ink-2">{message("statusSettlement.thisSavedObservationHasNoRecognizedOriginalNetwork")}</p>}
    </>
  );
}

function Row({ k, v, alert = false }: { k: string; v: ReactNode; alert?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-ink-3">{k}</dt>
      <dd className={`tabular-nums ${alert ? "text-destructive" : "text-ink"}`}>{v}</dd>
    </div>
  );
}
