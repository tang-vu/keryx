import { z } from "zod";

const blocks = z.string().regex(/^[1-9]\d{0,15}$/).refine(value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER));
// Only the public build pin is visible to the independently enrolled worker.
const publicMaxAheadBlocks = process.env.NEXT_PUBLIC_KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS;
export function browserSessionCashoutMaxAheadBlocks() {
  return blocks.parse(publicMaxAheadBlocks);
}
/** Invoked by actual mainnet cashout admission, not testnet startup or payment-only clients. */
export function configuredSessionCashoutMaxAheadBlocks() {
  const configured = blocks.parse(process.env.KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS);
  if (configured !== publicMaxAheadBlocks) throw new Error("Mainnet withdrawal block-window settings differ");
  return configured;
}
