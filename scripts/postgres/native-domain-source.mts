/** Independently buildable SOURCE for a native domain qualification fixture.
 * Never discover a target or generate its expected contract from its own data. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { POSTGRES17_SCHEMA_CONTRACT_BODY } from "../helpers/enrolled-postgres-schema-contract.mts";
import { STORAGE_MAINNET_PROFILE_DIGEST } from "../../lib/db/storage-identity";
import { ARC_MAINNET_PROFILE } from "../../lib/arc-network-profile";

export function nativeDomainAuthoritySource(): Readonly<{ sql: string; sha256: string }> {
  let sql = readFileSync(new URL("../../ops/keryx-postgres/authority.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  if (Buffer.byteLength(sql) > 131072 || sql.split("{{MAINNET_PROFILE_DIGEST}}").length !== 2 || sql.split("{{CATALOG_BODY}}").length !== 2)
    throw new Error("Native PostgreSQL source template refused");
  sql = sql.replace("{{MAINNET_PROFILE_DIGEST}}", STORAGE_MAINNET_PROFILE_DIGEST).replace("{{CATALOG_BODY}}", POSTGRES17_SCHEMA_CONTRACT_BODY);
  return Object.freeze({ sql, sha256: createHash("sha256").update(sql).digest("hex") });
}
export function nativeConsentDomainSource(): Readonly<{ sql: string; sha256: string }> {
  const ledger = readFileSync(new URL("../../ops/keryx-postgres/session-consents.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  if (Buffer.byteLength(ledger) > 131072) throw new Error("Native PostgreSQL domain source bound exceeded");
  const sql = nativeDomainAuthoritySource().sql + "\n" + ledger;
  return Object.freeze({ sql, sha256: createHash("sha256").update(sql).digest("hex") });
}
export function nativeFundingDomainSource(): Readonly<{ sql: string; sha256: string }> {
  let funding = readFileSync(new URL("../../ops/keryx-postgres/session-funding.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  if (Buffer.byteLength(funding) > 131072 || funding.split("{{USDC_ADDRESS}}").length !== 2 || funding.split("{{GATEWAY_ADDRESS}}").length !== 2)
    throw new Error("Native funding source refused");
  funding = funding.replace("{{USDC_ADDRESS}}", ARC_MAINNET_PROFILE.usdcAddress.toLowerCase()).replace("{{GATEWAY_ADDRESS}}", ARC_MAINNET_PROFILE.gatewayWallet.toLowerCase());
  const sql = nativeConsentDomainSource().sql + "\n" + funding;
  return Object.freeze({ sql, sha256: createHash("sha256").update(sql).digest("hex") });
}
