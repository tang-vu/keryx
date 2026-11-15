import { canonicalJson } from "../canonical-json";
import { applicationStorageIdentity, assertApplicationStorageCurrentLocal, closeReadonlyApplicationStorage, createReadonlyApplicationStorage } from "../db/application-storage";
import { storageIdentityDigest } from "../db/storage-identity";
import type { KeryxDB } from "../db/keryx-db";
import { configuredHostedTreasuryPolicy } from "../payments/hosted-treasury-policy";
import { operatorInventorySchema } from "../business-operator/contracts";
import { config } from "../config";
import { obligationAmount, obligationInspectionSchema, type ObligationSnapshot, type ObligationScope } from "./contracts";
import { projectOperatorObligations } from "./projection";
import type { ObligationReader } from "./reader";
import { readRuntimeStorageDeployment } from "../db/runtime-storage-config";

/** The only runtime port. Selected sealed SQLite/native facade and reviewed public/private
 * role policy are rechecked. No secret field use, wallet construction, signing,
 * vendor balance reads, writer or alternate store. Central config reads environment.
 * Aggregate books cannot prove original inclusion, complete liabilities or atomic cash. */
export async function inspectOperatorObligations(reader: ObligationReader) {
  let db: KeryxDB | undefined;
  try {
    const { wallet, role } = reader;
    if (role !== "public" && role !== "private") throw new Error();
    let publish: (() => ReturnType<typeof obligationInspectionSchema.parse>) | undefined;
    try {
      db = await createReadonlyApplicationStorage();
      if (!db) throw new Error();
      assertApplicationStorageCurrentLocal(db, "read"); // Supabase/ordinary/fabricated facades refuse.
      const baseUrl = config.baseUrl, origin = new URL(baseUrl).origin;
      const selection = readRuntimeStorageDeployment(), selectionWire = canonicalJson(selection);
      const identity = await applicationStorageIdentity(db, "read"), identityWire = canonicalJson(identity);
      assertApplicationStorageCurrentLocal(db, "read");
      if (config.baseUrl !== baseUrl || canonicalJson(selection.identity) !== identityWire) throw new Error();
      const policy = configuredHostedTreasuryPolicy(identity, origin, role), policyWire = canonicalJson(policy);
      const configuredCurrent = () => {
        if (config.baseUrl !== baseUrl || canonicalJson(readRuntimeStorageDeployment()) !== selectionWire ||
          canonicalJson(configuredHostedTreasuryPolicy(identity, origin, role)) !== policyWire) throw new Error();
      };
      const refresh = async () => {
        assertApplicationStorageCurrentLocal(db!, "read");
        const current = await applicationStorageIdentity(db!, "read");
        assertApplicationStorageCurrentLocal(db!, "read");
        if (canonicalJson(current) !== identityWire) throw new Error();
        configuredCurrent();
      };
      const observedAt = new Date().toISOString(), nowMs = Date.parse(observedAt);
      const scope: ObligationScope = { custodyWallet: policy.signer, signer: policy.signer,
        custodyRole: role === "public" ? "public-hosted" : "private-hosted",
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
      if (role === "public") {
        const inventory = operatorInventorySchema.parse(await db.operatorInventory({ network: identity.network, payee: policy.signer, nowMs }));
        await refresh();
        if (inventory.network !== identity.network || inventory.observedAt !== observedAt || inventory.invalidJobs > 0) throw new Error();
        add("prepaid-jobs", "prepaid-job-cap", String(BigInt(inventory.queuedCreatorMicroUsdc) + BigInt(inventory.unfinishedCreatorMicroUsdc)));
        add("unused-monthly-slots", "monthly-slot-cap", inventory.prepaidCreatorMicroUsdc);
      }
      const accounting = await db.hostedTreasuryAccounting(policy.signer, role);
      await refresh();
      const retained = BigInt(obligationAmount.parse(accounting.retainedMicroUsdc));
      const confirmed = BigInt(obligationAmount.parse(accounting.confirmedMicroUsdc));
      if (confirmed > retained || retained > BigInt(policy.lifetimeCapMicroUsdc)) throw new Error();
      add("hosted-unconfirmed-exposure", "payment-exposure", String(retained - confirmed));
      const snapshot: ObligationSnapshot = { version: 1, snapshotId, scope, observedAt,
        source: "native-journal", consistency: "partial", domains: [], cash: [], liabilities, inclusions: [], overlap: "unresolved",
        policy: { originalId: "configured-hosted-policy", evidenceId: "reviewed-hosted-policy", snapshotId, scope, observedAt,
          expiresAt: new Date(policy.expiresAtSeconds * 1000).toISOString(), horizonAt: null, reviewed: false,
          reserveFloorMicroUsdc: null, operatingBudgetMicroUsdc: null,
          remainingOriginalCapacityMicroUsdc: String(BigInt(policy.lifetimeCapMicroUsdc) - retained) } };
      // Own plain immutable value graph; no caller-supplied JSON is admitted as a native snapshot.
      const value = obligationInspectionSchema.parse({ version: 1, readerWallet: wallet,
        projection: projectOperatorObligations(JSON.parse(JSON.stringify(snapshot)), Date.now()) });
      publish = () => { configuredCurrent(); return value; };
    } finally { if (db) await closeReadonlyApplicationStorage(db); }
    // Reader disposal is the last await. Policy/origin/expiry remain current
    // before publication; the intentionally closed reader cannot issue proof.
    if (!publish) throw new Error();
    return publish();
  } catch { throw new Error("Operator obligation inspection unavailable"); }
}
