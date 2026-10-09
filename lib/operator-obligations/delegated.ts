import { configuredObligationReader, isObligationReader } from "./reader";
import { inspectOperatorObligations } from "./inspection";
import { parseNativeObligationInspection } from "./contracts";

/** Hosted MCP already verified its bearer in the global wrapper. The private
 * reader configuration is checked here before/after NEW readonly-store hydration. */
export async function readDelegatedOperatorObligations(wallet: string | undefined, scopes: readonly string[] | undefined) {
  const reader = configuredObligationReader();
  if (!isObligationReader(reader, wallet, scopes) || !reader) throw new Error("Operator inspection refused or unavailable");
  const value = parseNativeObligationInspection(await inspectOperatorObligations(reader)), after = configuredObligationReader();
  if (!after || after.wallet !== reader.wallet || after.role !== reader.role || value.readerWallet !== reader.wallet ||
    value.projection.scope.custodyRole !== `${reader.role}-hosted` || value.projection.scope.custodyWallet !== value.projection.scope.signer) throw new Error("Operator inspection refused or unavailable");
  return value;
}
