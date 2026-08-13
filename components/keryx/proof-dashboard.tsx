"use client";

import { useEffect, useState } from "react";
import type { WithdrawalRecord } from "@/lib/types";
import { CreatorCashoutsPanel } from "./creator-cashouts-panel";
import { RegistryStatusSection, type RegistryHealth } from "./registry-status-section";
import { SettlementProofSection, type SettlementHealth } from "./settlement-proof-section";

const REPO = "https://github.com/tang-vu/keryx";

interface ProofHealth {
  ok: boolean;
  commit: string | null;
  settles: string;
  network: string;
  rpcProvider: string;
  time: string;
  registry?: RegistryHealth | null;
  settlement?: SettlementHealth | null;
  traction?: {
    totalPayments: number;
    creatorPayoutsUsdc: number;
    creatorsEarning: number;
    totalQueries: number;
    externalPayments: number;
    externalCreatorPayoutsUsdc: number;
    externalQueries: number;
    externalPayingQueries: number;
    identifiedExternalActors: number;
    returningExternalActors: number;
    externalFeedbackTotal: number;
    externalSatisfactionRate: number;
    enginePayments: number;
    engineQueries: number;
    groundedClaimRate: number;
    externalSettlementSuccessRate: number;
    externalSettlementAttempts: number;
    pendingPaymentConfirmations: number;
    failedPaymentAttempts: number;
  };
}

function money(value: number): string {
  return `$${value.toFixed(value >= 10 ? 2 : 4)}`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border-l-2 border-line pl-3">
      <dt className="font-mono text-[9.5px] uppercase tracking-[0.13em] text-ink-3">{label}</dt>
      <dd className="mt-1 font-display text-[25px] font-semibold leading-none tabular-nums text-ink">
        {value}
      </dd>
      {note ? <p className="mt-1.5 font-mono text-[9.5px] leading-relaxed text-faint">{note}</p> : null}
    </div>
  );
}

function EvidenceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline decoration-line underline-offset-4 transition-colors hover:text-seal hover:decoration-seal"
    >
      {children} ↗
    </a>
  );
}

function ProvenanceBar({ external, engine, label }: { external: number; engine: number; label: string }) {
  const total = external + engine;
  const externalPct = total > 0 ? (external / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 font-mono text-[10px] text-ink-3">
        <span>{label}</span>
        <span className="tabular-nums">
          {external.toLocaleString()} independent · {engine.toLocaleString()} first-party
        </span>
      </div>
      <div className="mt-2 flex h-2 overflow-hidden bg-paper-2" aria-label={`${label} provenance`}>
        <div className="bg-paid" style={{ width: `${externalPct}%` }} />
        <div className="bg-ink-3/35" style={{ width: `${100 - externalPct}%` }} />
      </div>
    </div>
  );
}

export function ProofDashboard() {
  const [health, setHealth] = useState<ProofHealth | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRecord[]>([]);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const [healthResponse, withdrawalResponse] = await Promise.all([
          fetch("/api/health", { cache: "no-store" }),
          fetch("/api/withdrawals?limit=5", { cache: "no-store" }),
        ]);
        if (!healthResponse.ok) throw new Error(`health ${healthResponse.status}`);
        const nextHealth = (await healthResponse.json()) as ProofHealth;
        const nextWithdrawals = withdrawalResponse.ok
          ? ((await withdrawalResponse.json()) as { withdrawals?: WithdrawalRecord[] }).withdrawals ?? []
          : [];
        if (alive) {
          setHealth(nextHealth);
          setWithdrawals(nextWithdrawals);
          setReachable(true);
        }
      } catch {
        if (alive) setReachable(false);
      }
    };
    void poll();
    const timer = setInterval(poll, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!health) {
    return (
      <div className="mt-10 border border-line bg-paper p-6 font-mono text-[11px] text-ink-3">
        {reachable ? "Reading the public evidence ledger…" : "Evidence API is temporarily unreachable."}
      </div>
    );
  }

  const t = health.traction;
  const commitUrl = health.commit ? `${REPO}/commit/${encodeURIComponent(health.commit)}` : REPO;

  return (
    <div className="mt-10 space-y-6">
      <section className="border-2 border-ink bg-paper p-1.5">
        <div className="border border-ink p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
                Settled citation economy
              </div>
              <h2 className="mt-1 font-display text-[26px] font-semibold tracking-tight text-ink">
                What has actually cleared
              </h2>
            </div>
            <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-paid">
              <span className="h-2 w-2 rounded-full bg-paid" />
              {health.settles === "real" ? "real settlement" : "offline mode"}
            </span>
          </div>

          {t ? (
            <dl className="mt-7 grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Metric label="Queries" value={t.totalQueries.toLocaleString()} />
              <Metric label="Settled payments" value={t.totalPayments.toLocaleString()} />
              <Metric label="To creators" value={money(t.creatorPayoutsUsdc)} />
              <Metric label="Creators earning" value={t.creatorsEarning.toLocaleString()} />
            </dl>
          ) : (
            <p className="mt-6 font-mono text-[11px] text-ink-3">Traction ledger unavailable.</p>
          )}
        </div>
      </section>

      {t ? (
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="border border-line bg-paper p-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-seal">
              Independent adoption
            </div>
            <h2 className="mt-1 font-display text-[23px] font-semibold tracking-tight text-ink">
              Outside demand, kept separate
            </h2>
            <dl className="mt-6 grid grid-cols-2 gap-6">
              <Metric label="External queries" value={t.externalQueries.toLocaleString()} />
              <Metric label="Paid queries" value={t.externalPayingQueries.toLocaleString()} />
              <Metric label="Identified actors" value={t.identifiedExternalActors.toLocaleString()} />
              <Metric label="Returning actors" value={t.returningExternalActors.toLocaleString()} />
              <Metric label="External payments" value={t.externalPayments.toLocaleString()} />
              <Metric label="External creator payout" value={money(t.externalCreatorPayoutsUsdc)} />
              <Metric
                label="Feedback"
                value={t.externalFeedbackTotal.toLocaleString()}
                note={t.externalFeedbackTotal > 0 ? `${percent(t.externalSatisfactionRate)} positive` : "No sample yet"}
              />
              <Metric
                label="Settlement success"
                value={t.externalSettlementAttempts > 0 ? percent(t.externalSettlementSuccessRate) : "—"}
                note={`${t.pendingPaymentConfirmations} pending · ${t.failedPaymentAttempts} failed/not charged`}
              />
            </dl>
            <p className="mt-6 border-t border-line pt-4 font-mono text-[10px] leading-relaxed text-faint">
              “Identified” means a server-verified SIWE wallet or settled inbound A2A payer.
              Anonymous visitors count as queries, never as invented unique people.
            </p>
          </div>

          <div className="border border-line bg-paper p-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-seal">
              Provenance
            </div>
            <h2 className="mt-1 font-display text-[23px] font-semibold tracking-tight text-ink">
              Real money is not automatically real adoption
            </h2>
            <div className="mt-6 space-y-5">
              <ProvenanceBar external={t.externalQueries} engine={t.engineQueries} label="Queries" />
              <ProvenanceBar external={t.externalPayments} engine={t.enginePayments} label="Payments" />
            </div>
            <p className="mt-6 font-serif text-[15px] leading-relaxed text-ink-2">
              Both buckets settle real testnet USDC. Only the green independent slice is evidence
              that someone outside Keryx initiated demand; the grey slice is first-party agent
              activity proving the rail under sustained use.
            </p>
            <div className="mt-6 border-t border-line pt-4 font-mono text-[10px] leading-relaxed text-faint">
              Evidence-qualified claims: {percent(t.groundedClaimRate)} across measured runs.
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="border border-line bg-paper p-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-seal">
            Open-source build
          </div>
          <h2 className="mt-1 font-display text-[23px] font-semibold tracking-tight text-ink">
            The deployed code has a name
          </h2>
          <dl className="mt-6 grid grid-cols-1 gap-4 font-mono text-[11px] sm:grid-cols-2">
            <ProofRow label="Deployed commit">
              <EvidenceLink href={commitUrl}>{health.commit ?? "repository"}</EvidenceLink>
            </ProofRow>
            <ProofRow label="CI">
              <EvidenceLink href={`${REPO}/actions/workflows/ci.yml`}>
                tests · contracts · build
              </EvidenceLink>
            </ProofRow>
            <ProofRow label="Application source">
              <EvidenceLink href={REPO}>tang-vu/keryx</EvidenceLink>
            </ProofRow>
            <ProofRow label="Reusable Arc primitives">
              <EvidenceLink href="https://github.com/tang-vu/keryx-arc-primitives">
                forkable package
              </EvidenceLink>
            </ProofRow>
          </dl>
          <p className="mt-5 font-mono text-[10px] leading-relaxed text-faint">
            GitHub proves what was reviewed. The runtime commit above binds that source to the build
            currently answering requests.
          </p>
        </div>

        <div className="border border-line bg-paper p-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-seal">
            Arc read path
          </div>
          <h2 className="mt-1 font-display text-[23px] font-semibold tracking-tight text-ink">
            RPC provenance, without the credential
          </h2>
          <dl className="mt-6 space-y-4 font-mono text-[11px]">
            <ProofRow label="Network">{health.network}</ProofRow>
            <ProofRow label="RPC provider">{health.rpcProvider}</ProofRow>
            <ProofRow label="RPC head">{health.registry?.parity?.headBlock ?? "—"}</ProofRow>
            <ProofRow label="Registry indexed">{health.registry?.lastSyncedBlock ?? "—"}</ProofRow>
          </dl>
          <p className="mt-5 font-mono text-[10px] leading-relaxed text-faint">
            Tokenized RPC paths stay server-only. This page publishes the provider label and block
            evidence, never the URL or access token.
          </p>
        </div>
      </section>

      {(health.registry || health.settlement) && (
        <section className="border border-line bg-paper p-6 sm:p-8">
          {health.registry ? <RegistryStatusSection registry={health.registry} /> : null}
          {health.settlement ? <SettlementProofSection settlement={health.settlement} /> : null}
        </section>
      )}

      <CreatorCashoutsPanel withdrawals={withdrawals} />

      <p className="text-center font-mono text-[9.5px] tracking-wide text-faint">
        Auto-refreshes every 30s · checked {new Date(health.time).toUTCString()}
      </p>
    </div>
  );
}

function ProofRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line pb-2">
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-right tabular-nums text-ink">{children}</dd>
    </div>
  );
}
