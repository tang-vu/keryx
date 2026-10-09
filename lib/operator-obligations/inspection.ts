import { canonicalJson } from "../canonical-json";
import { applicationSqliteIdentity, createReadonlyApplicationStorage } from "../db/application-storage";
import { storageIdentityDigest } from "../db/storage-identity";
import type { KeryxDB } from "../db/keryx-db";
import { configuredHostedTreasuryPolicy } from "../payments/hosted-treasury-policy";
import { operatorInventorySchema } from "../business-operator/contracts";
import { config } from "../config";
import { obligationAmount, type ObligationSnapshot, type ObligationScope } from "./contracts";
import { projectOperatorObligations } from "./projection";
import type { ObligationReader } from "./reader";

/** The only runtime port. Selected sealed SQLite facade and reviewed public/private
 * role policy are rechecked. No keys, vendor balance reads, writer or alternate store.
 * Aggregate books cannot prove original inclusion, complete liabilities or atomic cash. */
export async function inspectOperatorObligations(reader: ObligationReader) {
  let db: KeryxDB | undefined;
  try {
    db = await createReadonlyApplicationStorage();
    if (!db) throw new Error();
    const identity = applicationSqliteIdentity(db, "read"); // Supabase/ordinary/fabricated facades refuse.
    const origin = new URL(config.baseUrl).origin;
    const policy = configuredHostedTreasuryPolicy(identity, origin, reader.role);
    const observedAt = new Date().toISOString(), nowMs = Date.parse(observedAt);
    const scope: ObligationScope = { ownerWallet: reader.wallet, signer: policy.signer,
      custodyRole: reader.role === "public" ? "public-hosted" : "private-hosted",
      storageIdentityDigest: storageIdentityDigest(identity), network: identity.network,
      asset: "0x3600000000000000000000000000000000000000", compartment: "gateway" };
    const snapshotId = `inspection:${nowMs}`;
    const liabilities: ObligationSnapshot["liabilities"] = [];
    const common = { snapshotId, scope, observedAt, dueAt: null, confirmationId: null, verifiedOriginal: false, units: "micro-usdc" as const, outcome: "uncertain" as const };
    const add = (id: string, category: ObligationSnapshot["liabilities"][number]["category"], amount: string) => {
      liabilities.push({ ...common, id, originalId: id, evidenceId: `aggregate:${id}`, category, amount: obligationAmount.parse(amount) });
    };
    // This is deliberately partial: inventory payee membership is not proof that
    // every service receipt belongs to this signer. Foreign orders stay invalid.
    if (reader.role === "public") {
      const inventory = operatorInventorySchema.parse(await db.operatorInventory({ network: identity.network, payee: policy.signer, nowMs }));
      if (inventory.network !== identity.network || inventory.observedAt !== observedAt || inventory.invalidJobs > 0) throw new Error();
      add("prepaid-jobs", "prepaid-job-cap", String(BigInt(inventory.queuedCreatorMicroUsdc) + BigInt(inventory.unfinishedCreatorMicroUsdc)));
      add("unused-monthly-slots", "monthly-slot-cap", inventory.prepaidCreatorMicroUsdc);
    }
    const accounting = await db.hostedTreasuryAccounting(policy.signer, reader.role);
    const retained = BigInt(obligationAmount.parse(accounting.retainedMicroUsdc));
    const confirmed = BigInt(obligationAmount.parse(accounting.confirmedMicroUsdc));
    if (confirmed > retained || retained > BigInt(policy.lifetimeCapMicroUsdc)) throw new Error();
    add("hosted-unconfirmed-exposure", "payment-exposure", String(retained - confirmed));
    if (canonicalJson(applicationSqliteIdentity(db, "read")) !== canonicalJson(identity) ||
      canonicalJson(configuredHostedTreasuryPolicy(identity, origin, reader.role)) !== canonicalJson(policy)) throw new Error();
    const snapshot: ObligationSnapshot = { version: 1, snapshotId, scope, observedAt,
      source: "native-journal", consistency: "partial", domains: [], cash: [], liabilities, inclusions: [], overlap: "unresolved",
      policy: { originalId: "configured-hosted-policy", evidenceId: "reviewed-hosted-policy", snapshotId, scope, observedAt,
        expiresAt: new Date(policy.expiresAtSeconds * 1000).toISOString(), horizonAt: null, reviewed: false,
        reserveFloorMicroUsdc: null, operatingBudgetMicroUsdc: null,
        remainingOriginalCapacityMicroUsdc: String(BigInt(policy.lifetimeCapMicroUsdc) - retained) } };
    // Own plain immutable value graph; no caller-supplied JSON is admitted as a native snapshot.
    return projectOperatorObligations(JSON.parse(JSON.stringify(snapshot)), Date.now());
  } catch { throw new Error("Operator obligation inspection unavailable"); }
  finally { if (db && "close" in db && typeof db.close === "function") db.close(); }
}
