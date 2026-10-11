import { formatNumber, selectPlural } from "@/lib/i18n/format";
import { DisplayTime } from "@/components/keryx/display-time";

import { createMessages } from "@/lib/i18n/messages";

const message = createMessages("en");
export interface PendingReconciliationHealth {
  checkedAt: string;
  scanned: number;
  promoted: number;
  awaiting: number;
  acknowledgedAwaiting?: number;
  unacknowledgedAwaiting?: number;
  browserAwaiting?: number;
  exposedAwaiting?: number;
  signedAwaiting?: number;
  submittedAwaiting?: number;
  treasuryAwaiting?: number;
  expiredAwaiting?: number;
  unknownExpiryAwaiting?: number;
  earliestAuthorizationExpiresAt?: string | null;
  failed: number;
  releasedReservations?: number;
  mismatched: number;
  raced: number;
  oldestPendingAt: string | null;
  oldestUnacknowledgedPendingAt?: string | null;
  oldestPendingAgeSeconds: number | null;
  status: "clean" | "acknowledged" | "awaiting" | "stale" | "critical" | "mismatch";
  degraded: boolean;
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-5 border-b border-line py-2 last:border-0">
      <dt className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">{k}</dt>
      <dd className="font-mono text-[11px] text-ink">{v}</dd>
    </div>
  );
}

export function PendingReconciliationSection({
  reconciliation,
}: {
  reconciliation: PendingReconciliationHealth;
}) {
  const clean = reconciliation.status === "clean";
  const label = {
    clean: message("statusReconciliation.clean"),
    acknowledged: message("statusReconciliation.acknowledgedLegacy"),
    awaiting: message("statusReconciliation.awaitingCircle"),
    stale: message("statusReconciliation.stalePending"),
    critical: message("statusReconciliation.criticalPending"),
    mismatch: message("statusReconciliation.reviewRequired"),
  }[reconciliation.status];
  return (
    <section className="mt-8 border-t border-line pt-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">{message("statusReconciliation.ambiguousPaymentReconciliation")}</h2>
        <span className={`font-mono text-[10px] uppercase tracking-[0.12em] ${clean ? "text-paid" : reconciliation.degraded ? "text-red-700" : "text-amber-700"}`}>
          {label}
        </span>
      </div>
      <dl className="mt-3">
        <Row k={message("statusReconciliation.acceptedByCircle")} v={formatNumber(reconciliation.promoted)} />
        <Row k={message("statusReconciliation.stillAwaitingProof")} v={formatNumber(reconciliation.awaiting)} />
        <Row
          k={message("statusReconciliation.acknowledgedLegacyTreasury")}
          v={formatNumber((reconciliation.acknowledgedAwaiting ?? 0))}
        />
        <Row
          k={message("statusReconciliation.unacknowledgedAlerts")}
          v={formatNumber((reconciliation.unacknowledgedAwaiting ?? reconciliation.awaiting))}
        />
        <Row
          k={message("statusReconciliation.browserReservationsHeld")}
          v={formatNumber((reconciliation.browserAwaiting ?? 0))}
        />
        <Row k={message("statusReconciliation.exposedPossiblyUnsigned")} v={formatNumber((reconciliation.exposedAwaiting ?? 0))} />
        <Row k={message("statusReconciliation.signedNoRecordedSubmission")} v={formatNumber((reconciliation.signedAwaiting ?? 0))} />
        <Row k={message("statusReconciliation.submissionAttempted")} v={formatNumber((reconciliation.submittedAwaiting ?? 0))} />
        <Row
          k={message("statusReconciliation.treasuryAttemptsPending")}
          v={formatNumber((reconciliation.treasuryAwaiting ?? 0))}
        />
        <Row
          k={message("statusReconciliation.expiredStillUnresolved")}
          v={formatNumber((reconciliation.expiredAwaiting ?? 0))}
        />
        <Row
          k={message("statusReconciliation.exactExpiryUnavailable")}
          v={formatNumber((reconciliation.unknownExpiryAwaiting ?? 0))}
        />
        <Row
          k={message("statusReconciliation.earliestSignedExpiry")}
          v={formatDate(reconciliation.earliestAuthorizationExpiresAt)}
        />
        <Row
          k={message("statusReconciliation.terminalFailures")}
          v={message(selectPlural((reconciliation.releasedReservations ?? 0)) === "one" ? "statusReconciliation.terminalFailures.one" : "statusReconciliation.terminalFailures.other", { failed: formatNumber(reconciliation.failed), released: formatNumber((reconciliation.releasedReservations ?? 0)) })}
        />
        <Row k={message("statusReconciliation.tupleMismatches")} v={formatNumber(reconciliation.mismatched)} />
        <Row
          k={message("statusReconciliation.oldestPendingAge")}
          v={formatAge(reconciliation.oldestPendingAgeSeconds)}
        />
        <Row k={message("statusReconciliation.lastChecked")} v={<DisplayTime value={reconciliation.checkedAt} />} />
      </dl>
      <p className="mt-3 font-mono text-[10px] leading-relaxed tracking-wide text-faint">{message("statusReconciliation.acceptedTransfersSettleOnlyOnAnExactTuple")}</p>
    </section>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return message("statusReconciliation.none");
  return <DisplayTime value={value} />;
}

function formatAge(seconds: number | null): string {
  if (seconds === null) return message("statusReconciliation.none");
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
