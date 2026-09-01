import { getDb } from "../lib/db/index.ts";
import {
  closeReviewedA2aOrder,
  inspectA2aOrder,
  repairA2aOrderFromSavedRun,
} from "../lib/a2a/operator-resolution.ts";
import { publicA2aResolution } from "../lib/a2a/result.ts";
import type { A2aOrderInspection } from "../lib/a2a/operator-resolution.ts";

const args = process.argv.slice(2);
const id = /^a2a_[a-f0-9]{64}$/.test(args[0] ?? "") ? args[0] : undefined;
const repair = args.includes("--repair");
const closeFailed = args.includes("--close-failed");
const help = args.includes("--help") || args.includes("-h");
const confirmIndex = args.indexOf("--confirm");
const confirm = confirmIndex >= 0 ? args[confirmIndex + 1] : undefined;

function usage() {
  console.log(`Usage:
  npm run review:a2a -- <a2a_order_id>
  npm run review:a2a -- <a2a_order_id> --repair --confirm <a2a_order_id>
  npm run review:a2a -- <a2a_order_id> --close-failed --confirm <a2a_order_id>

Inspection is read-only. Mutations never run research or invoke a payment gateway.`);
}

function safeInspection(inspection: A2aOrderInspection) {
  const { order, queryRun, evidence, state } = inspection;
  return {
    id: order.id,
    status: order.status,
    operationalState: state,
    createdAt: order.createdAt,
    startedAt: order.startedAt,
    updatedAt: order.updatedAt,
    savedQueryRun: queryRun !== null,
    savedRealQueryRun: queryRun?.paymentMode === "real",
    executionJournalVersion: evidence.executionJournalVersion,
    paymentBoundaryCrossed: evidence.paymentBoundaryCrossed,
    resultSaveBoundaryCrossed: evidence.resultSaveBoundaryCrossed,
    creatorPayments: {
      attempts: evidence.creatorAttempts,
      settledUsdc: evidence.settledCreatorMicros / 1e6,
      pendingUsdc: evidence.pendingCreatorMicros / 1e6,
      failedUsdc: evidence.failedCreatorMicros / 1e6,
      simulatedUsdc: evidence.simulatedCreatorMicros / 1e6,
    },
    resolution: publicA2aResolution(order) ?? null,
  };
}

if (!id || help) {
  usage();
  process.exitCode = help ? 0 : 1;
} else if (repair && closeFailed) {
  console.error("Choose exactly one mutation: --repair or --close-failed.");
  process.exitCode = 1;
} else {
  try {
    const db = await getDb();
    const initial = await inspectA2aOrder(db, id);
    if (!repair && !closeFailed) {
      console.log(JSON.stringify(safeInspection(initial), null, 2));
    } else {
      if (confirm !== id) {
        throw new Error("mutation requires --confirm followed by the exact same A2A order id");
      }
      if (repair) {
        if (!initial.queryRun) throw new Error("no saved QueryRun exists to repair from");
        await repairA2aOrderFromSavedRun(
          db,
          initial.order,
          initial.queryRun,
          "operator-cli",
        );
      } else {
        await closeReviewedA2aOrder(db, id);
      }
      const final = await inspectA2aOrder(db, id);
      console.log(JSON.stringify(safeInspection(final), null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "A2A review failed");
    process.exitCode = 1;
  }
}
