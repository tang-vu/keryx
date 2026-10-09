/** Offline public-snapshot inspector: no env, database, HTTP, provider or wallet imports. */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { projectPurchaseOutcomes } from "../lib/research/purchase-outcomes-projector.ts";
import { PURCHASE_OUTCOMES_MAX_BYTES, purchaseOutcomeNetwork } from "../lib/research/purchase-outcomes-contract.ts";

try {
  const [file, selector, network, ...extra] = process.argv.slice(2);
  if (!file || selector !== "--network" || !purchaseOutcomeNetwork.safeParse(network).success || extra.length
    || /^https?:/i.test(file)) throw new Error();
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let snapshot: unknown;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > PURCHASE_OUTCOMES_MAX_BYTES) throw new Error();
    const bytes = Buffer.alloc(PURCHASE_OUTCOMES_MAX_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length > PURCHASE_OUTCOMES_MAX_BYTES) throw new Error();
    snapshot = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
  } finally { await handle.close(); }
  // Frozen archive metadata supplies its original network; the explicit flag
  // selects only unarchived snapshots and never relabels retained testnet data.
  process.stdout.write(JSON.stringify(projectPurchaseOutcomes(snapshot, network), null, 2) + "\n");
} catch {
  process.stderr.write("Purchase outcomes refused. Supply a bounded public dispatch JSON file and --network eip155:5042 or eip155:5042002.\n");
  process.exitCode = 1;
}
