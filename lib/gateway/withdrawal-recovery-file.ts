import { z } from "zod";
import { validateWithdrawalRequest, withdrawalOwnerSchema } from "./withdrawal-request";
import { readWithdrawalBrowserJournal, importWithdrawalBrowserJournal } from "./withdrawal-browser-journal";

const limit = 16384;
const envelope = z.object({ format: z.literal("keryx-withdrawal-recovery-v1"), network: z.literal("eip155:5042002"),
  recoveryOnly: z.literal(true), exportedAt: z.string().datetime(), original: z.unknown() }).strict();
function active(owner: string, current: () => string | null, signal: AbortSignal) {
  signal.throwIfAborted();
  if (withdrawalOwnerSchema.parse(current()) !== owner) throw new Error("Withdrawal account changed");
}
/** Private portable signed authorization, not a public receipt or proof of payment.
 * No export field grants submission permission; importing always uses recovery-only storage. */
export async function parseWithdrawalRecoveryFile(text: string, owner: string) {
  if (typeof text !== "string" || text.length > limit || new TextEncoder().encode(text).byteLength > limit)
    throw new Error("Withdrawal recovery file exceeds limit");
  const wallet = withdrawalOwnerSchema.parse(owner), parsed = envelope.parse(JSON.parse(text));
  const original = await validateWithdrawalRequest(parsed.original);
  if (original.owner !== wallet) throw new Error("Withdrawal recovery owner mismatch");
  return original;
}
export async function exportWithdrawalRecoveryFile(id: string, owner: string, current: () => string | null, signal: AbortSignal) {
  const wallet = withdrawalOwnerSchema.parse(owner); active(wallet, current, signal);
  const saved = await readWithdrawalBrowserJournal(id, wallet); active(wallet, current, signal);
  if (!saved.request) throw new Error("Withdrawal has no signed original to export");
  const text = JSON.stringify({ format: "keryx-withdrawal-recovery-v1", network: "eip155:5042002",
    recoveryOnly: true, exportedAt: new Date().toISOString(), original: saved.request }, null, 2);
  await parseWithdrawalRecoveryFile(text, wallet); active(wallet, current, signal);
  return text;
}
export async function importWithdrawalRecoveryFile(text: string, owner: string, current: () => string | null, signal: AbortSignal) {
  const wallet = withdrawalOwnerSchema.parse(owner); active(wallet, current, signal);
  const original = await parseWithdrawalRecoveryFile(text, wallet); active(wallet, current, signal);
  const saved = await importWithdrawalBrowserJournal(original, wallet); active(wallet, current, signal);
  return saved;
}
