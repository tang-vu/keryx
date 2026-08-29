export interface PendingReconciliationHealth {
  checkedAt: string;
  scanned: number;
  promoted: number;
  awaiting: number;
  acknowledgedAwaiting?: number;
  unacknowledgedAwaiting?: number;
  browserAwaiting?: number;
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

function Row({ k, v }: { k: string; v: string }) {
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
    clean: "clean",
    acknowledged: "acknowledged legacy",
    awaiting: "awaiting Circle",
    stale: "stale pending",
    critical: "critical pending",
    mismatch: "review required",
  }[reconciliation.status];
  return (
    <section className="mt-8 border-t border-line pt-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">
          Ambiguous payment reconciliation
        </h2>
        <span className={`font-mono text-[10px] uppercase tracking-[0.12em] ${clean ? "text-paid" : reconciliation.degraded ? "text-red-700" : "text-amber-700"}`}>
          {label}
        </span>
      </div>
      <dl className="mt-3">
        <Row k="Accepted by Circle" v={reconciliation.promoted.toLocaleString()} />
        <Row k="Still awaiting proof" v={reconciliation.awaiting.toLocaleString()} />
        <Row
          k="Acknowledged legacy treasury"
          v={(reconciliation.acknowledgedAwaiting ?? 0).toLocaleString()}
        />
        <Row
          k="Unacknowledged alerts"
          v={(reconciliation.unacknowledgedAwaiting ?? reconciliation.awaiting).toLocaleString()}
        />
        <Row
          k="Browser reservations held"
          v={(reconciliation.browserAwaiting ?? 0).toLocaleString()}
        />
        <Row
          k="Treasury attempts pending"
          v={(reconciliation.treasuryAwaiting ?? 0).toLocaleString()}
        />
        <Row
          k="Expired, still unresolved"
          v={(reconciliation.expiredAwaiting ?? 0).toLocaleString()}
        />
        <Row
          k="Exact expiry unavailable"
          v={(reconciliation.unknownExpiryAwaiting ?? 0).toLocaleString()}
        />
        <Row
          k="Earliest signed expiry"
          v={formatDate(reconciliation.earliestAuthorizationExpiresAt)}
        />
        <Row
          k="Terminal failures"
          v={`${reconciliation.failed.toLocaleString()} (${(reconciliation.releasedReservations ?? 0).toLocaleString()} reservations released)`}
        />
        <Row k="Tuple mismatches" v={reconciliation.mismatched.toLocaleString()} />
        <Row
          k="Oldest pending age"
          v={formatAge(reconciliation.oldestPendingAgeSeconds)}
        />
        <Row k="Last checked" v={new Date(reconciliation.checkedAt).toLocaleString()} />
      </dl>
      <p className="mt-3 font-mono text-[10px] leading-relaxed tracking-wide text-faint">
        Accepted transfers settle only on an exact tuple. Circle-terminal failures close without
        earnings and release capacity only for the same grant generation. Missing or conflicting
        evidence stays pending. A reviewed legacy treasury ambiguity may be acknowledged to stop a
        permanent readiness alert, but remains pending, outside earnings, and under reconciliation.
        Browser reservations can never use this acknowledgement path. Expiry is operational
        context, never proof that Circle failed or that a browser reservation can be released.
      </p>
    </section>
  );
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "none";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : "unknown";
}

function formatAge(seconds: number | null): string {
  if (seconds === null) return "none";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
