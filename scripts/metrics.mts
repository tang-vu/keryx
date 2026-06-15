/**
 * metrics — print live dashboard metrics + creator leaderboard from the datastore.
 * Usage: npm run metrics  (or: node --import tsx scripts/metrics.mts)
 */

import { getDb } from "../lib/db/index.ts";

const db = await getDb();
const m = await db.metrics();
const board = await db.creatorLeaderboard();

console.log("\n📊 Keryx metrics");
console.log("─".repeat(48));
console.log(`Total payments        ${m.totalPayments}`);
console.log(`Total volume          $${m.totalVolumeUsdc}`);
console.log(`Creator payouts       $${m.totalCreatorPayoutsUsdc}`);
console.log(`Creators earning      ${m.creatorsEarning}`);
console.log(`Avg payment           $${m.avgPaymentUsdc}`);
console.log(`Queries               ${m.totalQueries}`);
console.log(`Paying queries        ${m.payingQueries}`);
console.log(`Reader→payer conv.    ${(m.readerToPayerConversion * 100).toFixed(0)}%`);

console.log("\n🏆 Creator leaderboard");
console.log("─".repeat(48));
for (const c of board) {
  console.log(
    `  $${c.totalEarnedUsdc.toFixed(6).padEnd(10)} ${c.sourceName}  ${c.citationCount} cite(s), ${c.paymentCount} pmt(s)`,
  );
}
console.log();
process.exit(0);
