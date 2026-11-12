import { ARC_MAINNET_PROFILE } from "../../arc-network-profile";
import { canonicalJson } from "../../canonical-json";
import { parseSessionGrantConsent, type SessionGrantConsent } from "../../payments/session-grant-consent";
import type { StorageIdentity } from "../storage-identity";
import type { SessionGrantConsentRecord } from "../session-grant-consents";
import { PostgresStorageUnavailable, type PostgresConnectionOptions } from "./connection";
import { createPostgresDomainChannel, PostgresDomainWriteOutcomeUnknown, type PostgresDomainChannel } from "./domain-channel";
export { PostgresDomainWriteOutcomeUnknown as PostgresConsentWriteOutcomeUnknown } from "./domain-channel";
export interface PostgresConsentTransport {
  issue(consent: SessionGrantConsent): Promise<void>;
  consume(consent: SessionGrantConsent, ownerSignature: string, sessionSignature: string): Promise<void>;
  get(owner: string, epoch: string): Promise<SessionGrantConsentRecord | null>;
  close(): Promise<void>;
}
const signature = (value: unknown): value is string => typeof value === "string" && /^0x[0-9a-f]{130}$/i.test(value);
function unavailable(): never { throw new PostgresStorageUnavailable(); }

/** Fixed domain transport only. No installed KeryxDB provenance, alternate-store
 * discovery, raw query/pool, callback, enrollment, policy renewal or signer. */
export function createPostgresConsentTransport(options: PostgresConnectionOptions, expected: StorageIdentity, sourceDigest: string): PostgresConsentTransport {
  return composePostgresConsentTransport(createPostgresDomainChannel(options, expected, sourceDigest));
}

/** Internal port composition: a caller-provided channel is never installed
 * application provenance. The enclosing composition owns terminal disposal. */
export function composePostgresConsentTransport(channel: PostgresDomainChannel): PostgresConsentTransport {
  const consentWire = (input: SessionGrantConsent) => {
    const wire = canonicalJson(parseSessionGrantConsent(input, ARC_MAINNET_PROFILE));
    if (Buffer.byteLength(wire) > 8192) unavailable();
    return wire;
  };
  return Object.freeze({
    async issue(input: SessionGrantConsent): Promise<void> {
      await channel.call("issue", [consentWire(input)]);
      if (channel.closed) throw new PostgresDomainWriteOutcomeUnknown();
    },
    async consume(input: SessionGrantConsent, ownerSignature: string, sessionSignature: string): Promise<void> {
      if (!signature(ownerSignature) || !signature(sessionSignature)) unavailable();
      await channel.call("consume", [consentWire(input), ownerSignature, sessionSignature]);
      if (channel.closed) throw new PostgresDomainWriteOutcomeUnknown();
    },
    async get(owner: string, epoch: string): Promise<SessionGrantConsentRecord | null> {
      if (typeof owner !== "string" || !/^0x[0-9a-f]{40}$/.test(owner) || typeof epoch !== "string" || !/^[0-9a-f-]{36}$/.test(epoch)) unavailable();
      const result = await channel.call("get", [owner, epoch]);
      if (channel.closed) unavailable();
      if (result === null) return null;
      if (!result || typeof result !== "object" || Array.isArray(result)
        || Object.keys(result).sort().join(",") !== "consent,ownerSignature,sessionSignature") unavailable();
      const value = result as Record<string, unknown>;
      let consent: SessionGrantConsent;
      try { consent = parseSessionGrantConsent(value.consent, ARC_MAINNET_PROFILE); } catch { return unavailable(); }
      if (channel.closed || consent.ownerAddr !== owner || consent.grantEpoch !== epoch || !signature(value.ownerSignature) || !signature(value.sessionSignature)) unavailable();
      return Object.freeze({ consent, ownerSignature: value.ownerSignature, sessionSignature: value.sessionSignature });
    },
    close(): Promise<void> {
      return channel.close();
    },
  });
}
