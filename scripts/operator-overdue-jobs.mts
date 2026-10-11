/** Private, read-only operator observation of unfinished paid jobs past their accepted target.
 * It never claims, retries, signs, buys, reconciles, refunds, notifies or starts a scheduler. */
import { paidJobEscalationQueue, UNFINISHED_A2A_ORDER_SCAN_LIMIT } from "../lib/a2a/overdue-escalation-queue.ts";

const args = process.argv.slice(2);
const usage = `Usage:
  npm run operator:overdue
  npm run operator:overdue -- --limit <1-${UNFINISHED_A2A_ORDER_SCAN_LIMIT}>

Lists running or failed research originals that passed their accepted completion target, oldest
first, with the original order, original payment reference and last recorded stage. Output is
private operator data: do not publish it.

Exit status: 0 nothing needs a person; 2 a person must review (overdue, timing unavailable,
unreadable rows or a truncated scan); 1 the observation itself was unavailable.

Read-only. Nothing is claimed, retried, signed, bought, reconciled or refunded, no one is
notified and no schedule is created. Requires the selected enrolled read-only storage; no fallback
or schema installation. Inspect one listed order with: npm run review:a2a -- <id>`;

let limit = UNFINISHED_A2A_ORDER_SCAN_LIMIT, valid = true;
if (args.length === 2 && args[0] === "--limit" && /^[1-9]\d{0,2}$/.test(args[1])) limit = Number(args[1]);
else if (args.length !== 0) valid = false;

if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
  console.log(usage);
} else if (!valid || limit > UNFINISHED_A2A_ORDER_SCAN_LIMIT) {
  console.error(usage);
  process.exitCode = 1;
} else {
  try {
    const { createReadonlyApplicationStorage, closeReadonlyApplicationStorage } = await import("../lib/db/application-storage.ts");
    const db = await createReadonlyApplicationStorage();
    if (!db) throw new Error("Selected read-only storage is unavailable");
    try {
      const queue = await paidJobEscalationQueue(db, Date.now(), limit);
      console.log(JSON.stringify(queue, null, 2));
      process.exitCode = queue.attentionNeeded ? 2 : 0;
    } finally { closeReadonlyApplicationStorage(db); }
  } catch {
    // Storage errors can carry connection detail; an unavailable observation is never "no overdue jobs".
    console.error("Overdue paid-job observation unavailable. No conclusion about unfinished jobs can be drawn.");
    process.exitCode = 1;
  }
}
