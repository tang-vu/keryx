"use client";

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
  checkedAt: string;
  owedUsdc: number;
  confirmedUsdc: number;
  counts: { confirmed: number; surplus: number; short: number; unknown: number };
  accounts: {
    address: string;
    label?: string;
    owedUsdc: number;
    heldUsdc: number | null;
    verdict: "confirmed" | "surplus" | "short" | "unknown";
  }[];
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

const usd = (n: number) => `$${n.toFixed(6)}`;

export function SettlementProofSection({ settlement }: { settlement: SettlementHealth }) {
  const { counts, accounts } = settlement;
  const backed = counts.confirmed + counts.surplus;
  const answered = backed + counts.short;
  const top = accounts.slice(0, 8);

  return (
    <>
      <div className="mt-8 border-t border-line pt-5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">
        Settlement — confirmed by Circle
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-5 font-mono text-[12px]">
        <Row
          k="Wallets backed"
          v={
            answered === 0
              ? "—"
              : `${backed}/${answered} · ${ago(settlement.checkedAt)}`
          }
          alert={counts.short > 0}
        />
        <Row k="Ledger claims held" v={usd(settlement.owedUsdc)} />
        <Row k="Circle confirms" v={usd(settlement.confirmedUsdc)} />
        <Row
          k={counts.unknown > 0 ? "Short · unanswered" : "Short"}
          v={
            // An unanswered wallet is not a clean row: it means Circle said nothing about that
            // money, and that "Circle confirms" above is understating what is really backed.
            (counts.short === 0 ? "none" : `${counts.short} wallet${counts.short === 1 ? "" : "s"}`) +
            (counts.unknown > 0 ? ` · ${counts.unknown} unanswered` : "")
          }
          alert={counts.short > 0}
        />
      </dl>

      {top.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[30rem] border-collapse font-mono text-[11px]">
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th className="py-1.5 pr-3 font-normal">Payee wallet</th>
                <th className="py-1.5 pr-3 text-right font-normal">Keryx claims</th>
                <th className="py-1.5 pr-3 text-right font-normal">Circle holds</th>
                <th className="py-1.5 text-right font-normal">Verdict</th>
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
                  </td>
                  <td
                    className={`py-1.5 text-right ${a.verdict === "short" ? "text-destructive" : "text-ink-3"}`}
                  >
                    {a.verdict}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 font-mono text-[10px] leading-relaxed tracking-wide text-faint">
        Gateway settlement leaves no per-payment explorer hash, so every hour Keryx asks Circle what
        it holds for each payee and publishes both numbers. A wallet holding <em>more</em> than
        Keryx accounts for is the creator&rsquo;s own money and never flags. Check any row yourself:
      </p>
      <pre className="mt-2 overflow-x-auto border border-line bg-paper-2 p-3 font-mono text-[10px] leading-relaxed text-ink-2">
{`curl -s https://gateway-api-testnet.circle.com/v1/balances \\
  -H 'content-type: application/json' \\
  -d '{"token":"USDC","sources":[{"depositor":"${top[0]?.address ?? "0x…"}","domain":26}]}'`}
      </pre>
    </>
  );
}

function Row({ k, v, alert = false }: { k: string; v: string; alert?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-ink-3">{k}</dt>
      <dd className={`tabular-nums ${alert ? "text-destructive" : "text-ink"}`}>{v}</dd>
    </div>
  );
}
