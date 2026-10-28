"use client";
import { formatNumber, formatRecordedUsdc } from "@/lib/i18n/format";
import { DisplayTime } from "./display-time";

import { useEffect, useState } from "react";
import type { WithdrawalRecord } from "@/lib/types";
import { CreatorCashoutsPanel } from "./creator-cashouts-panel";
import { RegistryStatusSection, type RegistryHealth } from "./registry-status-section";
import { SettlementProofSection, type SettlementHealth } from "./settlement-proof-section";


import { UiMessage, useUiMessages, useUiRichMessages } from "@/lib/i18n/ui-copy";






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
    settledOperatingFeeUsdc?: number | null;
    settledOperatingFeePayments?: number | null;
    creatorsEarning: number;
    totalQueries: number;
  };
}

function money(value: number): string {
  return formatRecordedUsdc(value, { minimumFractionDigits: value >= 10 ? 2 : 4 });
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l-2 border-line pl-3">
      <dt className="font-mono text-[9.5px] uppercase tracking-[0.13em] text-ink-3">{label}</dt>
      <dd className="mt-1 font-display text-[25px] font-semibold leading-none tabular-nums text-ink">
        {value}
      </dd>
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

export function ProofDashboard() {
  const message = useUiMessages();
  const richMessage = useUiRichMessages();
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
        {reachable ? message("proofDashboard.readingThePublicEvidenceLedger") : message("proofDashboard.evidenceAPIIsTemporarilyUnreachable")}
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
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">{message("proofDashboard.keryxInNumbers")}</div>
              <h2 className="mt-1 font-display text-[26px] font-semibold tracking-tight text-ink">{message("proofDashboard.combinedUsageAndSettledPayments")}</h2>
            </div>
            <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-paid">
              <span className="h-2 w-2 rounded-full bg-paid" />
              {health.settles === "real" ? message("proofDashboard.realSettlement") : message("proofDashboard.offlineMode")}
            </span>
          </div>

          {t ? (
            <dl className="mt-7 grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Metric label={message("proofDashboard.totalQueries")} value={formatNumber(t.totalQueries)} />
              <Metric label={message("proofDashboard.settledPayments")} value={formatNumber(t.totalPayments)} />
              <Metric label={message("proofDashboard.creatorRewards")} value={money(t.creatorPayoutsUsdc)} />
              <Metric label={message("proofDashboard.creatorsEarning")} value={formatNumber(t.creatorsEarning)} />
              <Metric label={message("proofDashboard.keryxOperatingFees")} value={t.settledOperatingFeeUsdc != null ? money(t.settledOperatingFeeUsdc) : message("proofDashboard.unavailable")} />
              <Metric label={message("proofDashboard.operatingFeeTransfers")} value={(t.settledOperatingFeePayments == null ? undefined : formatNumber(t.settledOperatingFeePayments)) ?? message("proofDashboard.unavailable")} />
            </dl>
          ) : (
            <p className="mt-6 font-mono text-[11px] text-ink-3">{message("proofDashboard.tractionLedgerUnavailable")}</p>
          )}
          <p className="mt-6 font-mono text-[10px] leading-relaxed text-faint">{message("proofDashboard.queryCountIncludesAllRecordedUseOnlySettled")}</p>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="border border-line bg-paper p-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-seal"><UiMessage messageKey="proofDashboard.openSourceBuild" /></div>
          <h2 className="mt-1 font-display text-[23px] font-semibold tracking-tight text-ink">{message("proofDashboard.theDeployedCodeHasAName")}</h2>
          <dl className="mt-6 grid grid-cols-1 gap-4 font-mono text-[11px] sm:grid-cols-2">
            <ProofRow label={message("proofDashboard.deployedCommit")}>
              <EvidenceLink href={commitUrl}>{health.commit ?? message("proofDashboard.repository")}</EvidenceLink>
            </ProofRow>
            <ProofRow label={message("proofDashboard.ci")}>
              <EvidenceLink href={`${REPO}/actions/workflows/ci.yml`}>{message("proofDashboard.testsContractsBuild")}</EvidenceLink>
            </ProofRow>
            <ProofRow label={message("proofDashboard.applicationSource")}>
              <EvidenceLink href={REPO}>tang-vu/keryx</EvidenceLink>
            </ProofRow>
            <ProofRow label={message("proofDashboard.reusableArcPrimitives")}>
              <EvidenceLink href="https://github.com/tang-vu/keryx-arc-primitives">{message("proofDashboard.forkablePackage")}</EvidenceLink>
            </ProofRow>
          </dl>
          <p className="mt-5 font-mono text-[10px] leading-relaxed text-faint">{message("proofDashboard.gitHubProvesWhatWasReviewedTheRuntimeCommit")}</p>
        </div>

        <div className="border border-line bg-paper p-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-seal">{message("proofDashboard.arcReadPath")}</div>
          <h2 className="mt-1 font-display text-[23px] font-semibold tracking-tight text-ink">{message("proofDashboard.rPCProvenanceWithoutTheCredential")}</h2>
          <dl className="mt-6 space-y-4 font-mono text-[11px]">
            <ProofRow label={message("proofDashboard.network")}>{health.network}</ProofRow>
            <ProofRow label={message("proofDashboard.rpcProvider")}>{health.rpcProvider}</ProofRow>
            <ProofRow label={message("proofDashboard.rpcHead")}>{health.registry?.parity?.headBlock ?? "—"}</ProofRow>
            <ProofRow label={message("proofDashboard.registryIndexed")}>{health.registry?.lastSyncedBlock ?? "—"}</ProofRow>
          </dl>
          <p className="mt-5 font-mono text-[10px] leading-relaxed text-faint">{message("proofDashboard.tokenizedRPCPathsStayServerOnlyThisPage")}</p>
        </div>
      </section>

      {(health.registry || health.settlement) && (
        <section className="border border-line bg-paper p-6 sm:p-8">
          {health.registry ? <RegistryStatusSection registry={health.registry} /> : null}
          {health.settlement ? <SettlementProofSection settlement={health.settlement} /> : null}
        </section>
      )}

      <CreatorCashoutsPanel withdrawals={withdrawals} />

      <p className="text-center font-mono text-[9.5px] tracking-wide text-faint">{richMessage("proofDashboard.autoRefreshesEvery30sCheckedValue", { checkedAt: <DisplayTime value={health.time} /> })}</p>
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
