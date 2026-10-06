/**
 * Durable A2A research worker. It processes one paid order at a time so the treasury's bounded
 * creator budget remains easy to audit. A claimed job is never automatically requeued: a crash
 * can be ambiguous after a downstream x402 settlement, and retrying could double-spend.
 */

import crypto from "node:crypto";
import os from "node:os";
import { config } from "../lib/config.ts";
import { getDb } from "../lib/db/index.ts";
import { runNextA2aOrder } from "../lib/a2a/run-order.ts";
import { ARC_MAINNET_PROFILE } from "../lib/arc-network-profile.ts";
import { assertMainnetHostedCustodyReady } from "../lib/payments/mainnet-hosted-gateway.ts";
import { configuredResearchAllowance } from "../lib/research/research-allowance.ts";
import { runOperatorCycle, type OperatorAuditEvent } from "../lib/business-operator/cycle.ts";
import { observeOperatorLiquidity } from "../lib/business-operator/liquidity.ts";
import { operatorAuditDirectory, writeOperatorAudit } from "../lib/business-operator/journal.ts";
import { publishOperatorHeartbeat } from "../lib/business-operator/status.ts";
import { withPrivateWorkerLock } from "../lib/a2a/private-worker-lock.ts";
import { canonicalJson } from "../lib/canonical-json.ts";
import type { OperatorDecision } from "../lib/business-operator/contracts.ts";
import type { A2aWorkerOutcome } from "../lib/a2a/run-order.ts";
import { recoverOperatorOriginal } from "../lib/business-operator/recovery.ts";
import { canaryExecutionPaused, canaryOriginalClaim } from "../lib/business-operator/canary-policy.ts";
import { matchesA2aOriginalClaim } from "../lib/a2a/original-claim.ts";
import { a2aFailureDiagnostic, formatA2aFailureDiagnostic } from "../lib/a2a/failure-diagnostic.ts";

const workerId = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
let stopping = false;
let recoveryOrderId: string | null = null;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
    console.log(`[a2a-worker] ${signal} received; finishing the current order before exit`);
  });
}

const businessOperator = config.profile === ARC_MAINNET_PROFILE;
if (!config.sellerAddress || (!businessOperator && !config.funderKey) || process.env.KERYX_FORCE_OFFLINE === "1") {
  throw new Error("real A2A treasury is unavailable; refusing to start paid research worker");
}

const db = await getDb();
// Mainnet must prove its original dedicated custody; a legacy testnet key cannot
// satisfy startup. This comparison does not construct a signer or move funds.
if (businessOperator) await assertMainnetHostedCustodyReady(db);
const auditDirectory = businessOperator ? await operatorAuditDirectory() : null;
let lastHeldAudit: string | null = null;
let lastAuditAt = 0;
let retainedDecision: OperatorDecision | null = null;
let heartbeat: { decision: OperatorDecision; phase: "decision" | "outcome"; outcome?: A2aWorkerOutcome | null } | null = null;
async function audit(event: OperatorAuditEvent) {
  if (!auditDirectory) throw new Error("Operator audit unavailable");
  // Quiet idle/held polling retains an existing audit and refreshes the public
  // heartbeat. Every run-next decision is separately durable before its claim.
  const decision = { ...event.decision, observedAt: undefined };
  const inventory = event.inventory ? { ...event.inventory, observedAt: undefined } : null;
  const signature = canonicalJson({ decision, inventory, liquidity: event.liquidity });
  if (event.phase === "decision" && event.decision.action !== "run-next" &&
    signature === lastHeldAudit && Date.now() - lastAuditAt < 900_000 && retainedDecision) return retainedDecision;
  await writeOperatorAudit(auditDirectory, event);
  lastHeldAudit = signature; lastAuditAt = Date.now();
  retainedDecision = event.decision;
  return retainedDecision;
}
async function loop() {
  console.log(`[a2a-worker] online as ${workerId}`);
  await db.setSyncState("a2aWorker", JSON.stringify({ workerId, status: "idle", orderId: null, updatedAt: new Date().toISOString() }));
  while (!stopping) {
    try {
      if (recoveryOrderId) {
        const recovered = await recoverOperatorOriginal(db, recoveryOrderId);
        if (recovered === "completed" || recovered === "failed") {
          recoveryOrderId = null;
        } else {
          await db.setSyncState(
            "a2aWorker",
            JSON.stringify({
              workerId,
              status: "recovery_pending",
              orderId: recoveryOrderId,
              updatedAt: new Date().toISOString(),
            }),
          );
          await delay(2_000);
          continue;
        }
      }
      let canaryReady = false;
      try {
        const expected = canaryOriginalClaim();
        if (expected) {
          const order = await db.getA2aOrder(expected.id);
          const catalog = await db.operatorPublicSnapshot(Date.now());
          canaryReady = !!order && matchesA2aOriginalClaim(order, expected) &&
            !!db.hasA2aOriginalSettlement && await db.hasA2aOriginalSettlement(expected) &&
            catalog.creatorCatalog.registered === 0;
        }
      } catch { /* A changed/expired/unknown finite window is held before any atomic claim. */ }
      const run = async () => {
        if (stopping) return null;
        const result = await runNextA2aOrder(db, workerId, {
          expectedPayee: config.sellerAddress,
          ...(process.env.KERYX_OPERATOR_DECISION_BRIEF === "1" ? { answerFormat: "decision-brief" as const } : {}),
          onClaim: async (order) => {
            await db.setSyncState(
              "a2aWorker",
              JSON.stringify({
                workerId,
                status: "processing",
                orderId: order.id,
                updatedAt: new Date().toISOString(),
              }),
            );
          },
        });
        // Emit only the closed private diagnostic before fallible outcome audit/sync writes.
        if (result?.diagnostic) console.log(`[a2a-worker] research failure ${formatA2aFailureDiagnostic(result.diagnostic)}`);
        return result;
      };
      const outcome = businessOperator ? await runOperatorCycle({
        inventory: () => db.operatorInventory({ network: config.networkId, payee: config.sellerAddress, nowMs: Date.now() }),
        liquidity: () => observeOperatorLiquidity(db), run, audit,
        publish: (decision, phase, result) => {
          heartbeat = { decision, phase, outcome: result };
          return publishOperatorHeartbeat(db, config.networkId, decision, phase, result);
        },
        rememberOutcome: (result) => {
          if (result?.status === "recovery_pending") {
            recoveryOrderId = result.id;
            if (heartbeat) heartbeat = { ...heartbeat, phase: "outcome", outcome: result };
          }
        },
        now: Date.now, acceptancePaused: () => configuredResearchAllowance() !== null || canaryExecutionPaused() && !canaryReady,
      }) : await run();
      if (outcome?.status === "recovery_pending") recoveryOrderId = outcome.id;
      await db.setSyncState(
        "a2aWorker",
        JSON.stringify({
          workerId,
          status: outcome?.status ?? "idle",
          orderId: outcome?.id ?? null,
          updatedAt: new Date().toISOString(),
        }),
      );
      if (outcome) {
        console.log(`[a2a-worker] ${outcome.id} ${outcome.status}`);
        if (outcome.status === "recovery_pending") recoveryOrderId = outcome.id;
        continue;
      }
      await delay(businessOperator ? 5_000 : 1_000);
    } catch (error) {
      // Stop refreshing a prior working state after a failed observation/audit.
      // A captured recovery outcome remains an explicit hold on the original.
      if (!recoveryOrderId) heartbeat = null;
      console.error(`[a2a-worker] loop failure ${formatA2aFailureDiagnostic(a2aFailureDiagnostic(error))}`);
      await delay(5_000);
    }
  }
}
// Cooperative single-host exclusion. A crash keeps its lock for explicit
// inspection; neither age nor a recycled PID permits replaying a started job.
if (auditDirectory) await withPrivateWorkerLock(auditDirectory, async () => {
  let pendingHeartbeat: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (!heartbeat || pendingHeartbeat) return;
    pendingHeartbeat = publishOperatorHeartbeat(db, config.networkId, heartbeat.decision, heartbeat.phase, heartbeat.outcome)
      .catch(() => undefined).finally(() => { pendingHeartbeat = null; });
  }, 30_000);
  try { await loop(); } finally { clearInterval(timer); await pendingHeartbeat; }
});
else await loop();

await db.setSyncState(
  "a2aWorker",
  JSON.stringify({ workerId, status: "stopped", updatedAt: new Date().toISOString() }),
).catch(() => undefined);
console.log("[a2a-worker] stopped");

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
