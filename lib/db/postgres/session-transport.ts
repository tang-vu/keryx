import type { SessionFundingAccounting } from "../session-funding-accounting";
import type { StorageIdentity } from "../storage-identity";
import { PostgresStorageUnavailable, type PostgresConnectionOptions } from "./connection";
import { composePostgresConsentTransport, type PostgresConsentTransport } from "./consent-transport";
import { createPostgresDomainChannel, type PostgresDomainChannel } from "./domain-channel";

export interface PostgresSessionTransport extends PostgresConsentTransport {
  sessionFundingAccounting(signer: string, after?: string): Promise<SessionFundingAccounting>;
  browserSignerRetainedSpend(signer: string): Promise<number>;
}
function unavailable(): never { throw new PostgresStorageUnavailable(); }
const micro = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]{0,15})$/.test(value)
  && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER);

/** Qualified domain composition only; it cannot select the application backend
 * or supply enrollment/signing authority. All ports share two connections and
 * eight queued requests rather than allocating a pool for every domain. */
export function createPostgresSessionTransport(options: PostgresConnectionOptions, identity: StorageIdentity, sourceDigest: string): PostgresSessionTransport {
  const channel = createPostgresDomainChannel(options, identity, sourceDigest);
  return composePostgresSessionTransport(channel);
}
export function composePostgresSessionTransport(channel: PostgresDomainChannel): PostgresSessionTransport {
  return Object.freeze({
    ...composePostgresConsentTransport(channel),
    async sessionFundingAccounting(signer: string, after?: string): Promise<SessionFundingAccounting> {
      if (typeof signer !== "string" || !/^0x[0-9a-f]{40}$/.test(signer)
        || (after !== undefined && (typeof after !== "string" || after.length > 24 || !Number.isFinite(Date.parse(after)) || new Date(after).toISOString() !== after))) unavailable();
      const result = await channel.call("funding", [signer, after ?? null]);
      if (channel.closed || !result || typeof result !== "object" || Array.isArray(result)) unavailable();
      const r = result as Record<string, unknown>;
      if (Object.keys(r).sort().join(",") !== "confirmedSpentMicroUsdc,hasAuthorityHistory,postBaselineConfirmedDebitMicroUsdc,retainedSpentMicroUsdc"
        || typeof r.hasAuthorityHistory !== "boolean" || !micro(r.confirmedSpentMicroUsdc) || !micro(r.retainedSpentMicroUsdc) || !micro(r.postBaselineConfirmedDebitMicroUsdc)
        || BigInt(r.postBaselineConfirmedDebitMicroUsdc) > BigInt(r.confirmedSpentMicroUsdc) || BigInt(r.confirmedSpentMicroUsdc) > BigInt(r.retainedSpentMicroUsdc)
        || (!r.hasAuthorityHistory && r.retainedSpentMicroUsdc !== "0") || (after === undefined && r.postBaselineConfirmedDebitMicroUsdc !== "0")) unavailable();
      return Object.freeze({ hasAuthorityHistory: r.hasAuthorityHistory, confirmedSpentMicroUsdc: r.confirmedSpentMicroUsdc,
        retainedSpentMicroUsdc: r.retainedSpentMicroUsdc, postBaselineConfirmedDebitMicroUsdc: r.postBaselineConfirmedDebitMicroUsdc });
    },
    async browserSignerRetainedSpend(signer: string): Promise<number> {
      if (typeof signer !== "string" || !/^0x[0-9a-f]{40}$/i.test(signer)) unavailable();
      const result = await channel.call("retained", [signer.toLowerCase()]);
      if (channel.closed || typeof result !== "number" || !Number.isSafeInteger(result) || result < 0) unavailable();
      return result;
    },
  });
}
