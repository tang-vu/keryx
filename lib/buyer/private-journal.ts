import { mkdir, open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { addressSchema, requirementSchema } from "./protocol";
import { PRIVATE_RESEARCH_RESOURCE } from "./private-request-commitment";
import { privateResearchIdSchema, preparePrivateResearchIntent } from "../a2a/private-research-intent";
import type { PrivateMerchantPolicy } from "./private-merchant-policy";
import { writeBuyerFile } from "./journal";

const envelope = z.object({ schema: z.literal("keryx-private-buyer-intent-v1"), resource: z.literal(PRIVATE_RESEARCH_RESOURCE),
  id: privateResearchIdSchema, requirement: requirementSchema, submission: z.unknown() }).strict();

/** Local plaintext journal, not encryption. Contains private research and a bearer authorization.
 * Restore verifies the original signature/commitment; it never refreshes the salt or nonce. */
export async function validatePrivateBuyerIntent(value: unknown, payer: string, merchants: PrivateMerchantPolicy) {
  const owner = addressSchema.parse(payer).toLowerCase();
  const parsed = envelope.parse(value);
  const intent = await preparePrivateResearchIntent(parsed.submission, parsed.requirement, merchants);
  if (intent.id !== parsed.id || intent.submission.payment.authorization.from !== owner || !("reasoning" in intent.submission.request))
    throw new Error("Private buyer journal does not match the owner or signed job");
  return { schema: parsed.schema, resource: parsed.resource, id: intent.id, requirement: intent.requirement, submission: intent.submission };
}

export async function createPrivateBuyerJournal(directory: string, value: unknown, payer: string, merchants: PrivateMerchantPolicy) {
  const intent = await validatePrivateBuyerIntent(value, payer, merchants);
  const absolute = resolve(directory);
  await mkdir(absolute, { mode: 0o700 });
  if (process.platform !== "win32") {
    const parent = await open(dirname(absolute), "r");
    try { await parent.sync(); } finally { await parent.close(); }
  }
  await writeBuyerFile(absolute, "private-intent.json", intent);
}

export async function readPrivateBuyerJournal(directory: string, payer: string, merchants: PrivateMerchantPolicy) {
  const handle = await open(join(directory, "private-intent.json"), "r");
  let bytes: Buffer;
  try {
    // Read one bounded buffer, including files that grow after opening.
    bytes = Buffer.alloc(65537);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length-offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > 65536) throw new Error("Private buyer journal exceeds size limit");
    bytes = bytes.subarray(0, offset);
  } finally { await handle.close(); }
  return validatePrivateBuyerIntent(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), payer, merchants);
}

/** Must complete before the first signed HTTP submission. An existing marker, including a
 * partial write, denies another attempt. A failed fsync never grants permission to submit.
 * This local claim does not replace the server's global durable nonce/admission checks. */
export async function claimPrivateBuyerSubmission(directory: string, payer: string, merchants: PrivateMerchantPolicy) {
  const intent = await readPrivateBuyerJournal(directory, payer, merchants);
  try {
    await writeBuyerFile(directory, "private-submission-attempt.json", { schema: "keryx-private-buyer-attempt-v1", id: intent.id });
    return { claimed: true as const, intent };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return { claimed: false as const };
    throw new Error("Private buyer submission marker unavailable");
  }
}
