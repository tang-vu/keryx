"use client";

/**
 * "Circle confirms it" — the creator's earnings, checked against Circle's own books.
 *
 * Every other number on this page comes from Keryx's database, which is a weak proof for the one
 * claim that matters: that the money is really there. Gateway payouts settle off-chain, so no
 * payout row carries an explorer hash to open. What does exist is Circle's public balance API —
 * so the hourly parity watchdog asks it what it holds for this creator's wallets and this panel
 * publishes the answer next to the claim, with the request spelled out.
 *
 * Public by design (not owner-gated): a proof only the owner can see is not a proof.
 *
 * Rendered only when the sweep has run and knows these wallets — an absent panel is honest, an
 * empty or invented one is not. A balance ABOVE the claim is the creator's own money (their
 * deposits, or payouts from any other x402 service) and is shown as such, never as a discrepancy.
 */

import { ShieldCheck, TriangleAlert } from "lucide-react";
import { fmtUsdc, shortAddr } from "@/components/keryx/phase-style";

export interface GatewayProof {
  checkedAt: string;
  wallets: {
    address: string;
    label?: string;
    owedUsdc: number;
    heldUsdc: number | null;
    verdict: string;
  }[];
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

export function GatewayProofPanel({ proof }: { proof: GatewayProof | null }) {
  if (!proof || proof.wallets.length === 0) return null;

  const short = proof.wallets.filter((w) => w.verdict === "short");
  const answered = proof.wallets.filter((w) => w.heldUsdc !== null);
  const allBacked = short.length === 0 && answered.length > 0;

  return (
    <section className="mb-8 border border-line bg-paper p-5">
      <div className="flex items-center gap-2">
        {allBacked ? (
          <ShieldCheck className="h-4 w-4 text-seal" />
        ) : (
          <TriangleAlert className="h-4 w-4 text-destructive" />
        )}
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">
          Balance confirmed by Circle
        </h2>
        <span className="ml-auto font-mono text-[10px] text-faint">
          checked {ago(proof.checkedAt)}
        </span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[26rem] border-collapse font-mono text-[11.5px]">
          <thead>
            <tr className="border-b border-line text-left text-ink-3">
              <th className="py-1.5 pr-3 font-normal">Payee wallet</th>
              <th className="py-1.5 pr-3 text-right font-normal">Keryx says held</th>
              <th className="py-1.5 pr-3 text-right font-normal">Circle holds</th>
              <th className="py-1.5 text-right font-normal">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {proof.wallets.map((w) => (
              <tr key={w.address} className="border-b border-line/50">
                <td className="py-2 pr-3 text-ink" title={w.address}>
                  {w.label ?? shortAddr(w.address)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-ink-2">
                  ${fmtUsdc(w.owedUsdc)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-ink-2">
                  {w.heldUsdc === null ? "—" : `$${fmtUsdc(w.heldUsdc)}`}
                </td>
                <td
                  className={`py-2 text-right ${w.verdict === "short" ? "text-destructive" : "text-ink-3"}`}
                >
                  {w.verdict === "surplus" ? "backed +extra" : w.verdict}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 font-serif text-[13px] leading-relaxed text-ink-2">
        Citation payouts settle inside Circle&rsquo;s Gateway, so they carry a Circle transfer id
        instead of a block-explorer hash. Rather than ask you to take our ledger&rsquo;s word,
        Keryx checks it hourly against Circle&rsquo;s public balance API — and you can run the same
        request yourself:
      </p>
      <pre className="mt-2 overflow-x-auto border border-line bg-paper-2 p-3 font-mono text-[10px] leading-relaxed text-ink-2">
{`curl -s https://gateway-api-testnet.circle.com/v1/balances \\
  -H 'content-type: application/json' \\
  -d '{"token":"USDC","sources":[{"depositor":"${proof.wallets[0].address}","domain":26}]}'`}
      </pre>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-faint">
        A balance above the claim is your own money — deposits, or payouts from any other x402
        service that pays this wallet. Keryx only ever flags a balance that falls short of it.
      </p>
    </section>
  );
}
