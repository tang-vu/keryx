import { createHash } from "node:crypto";
import { z } from "zod";
import { isWellFormedUtf16 } from "../llm/well-formed-utf16";
import { parseTeachingProposalRequest } from "./teaching-proposals-request";
import { WORK_PRODUCT_REQUEST, WORK_PRODUCT_DELIVERABLE, WORK_PRODUCT_CRITERIA } from "./work-product-intent";
const text = (maximum: number) => z.string().trim().min(1).max(maximum).refine(isWellFormedUtf16)
  .refine(value => !/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value));
export const workProductRequestSchema = z.object({ version: z.literal(1), questionSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  deliverable: text(160), criteria: z.array(text(100)).min(1).max(3) }).strict();
export type WorkProductRequest = z.infer<typeof workProductRequestSchema>;

/** Original caller text only. Added context, source content and model output may
 * never supply this opt-in. Ambiguous duplicate blocks retain ordinary delivery. */
export function parseWorkProductRequest(originalQuestion: string): WorkProductRequest | undefined {
  if (originalQuestion.length > 30_000 || !originalQuestion.startsWith(WORK_PRODUCT_REQUEST + "\n\n")) return;
  // The previously admitted teaching contract retains its separate rollout.
  if (parseTeachingProposalRequest(originalQuestion)) return;
  const blocks = originalQuestion.split("\n\n");
  const outputs = blocks.filter(block => block.startsWith(WORK_PRODUCT_DELIVERABLE));
  const checks = blocks.filter(block => block.startsWith(WORK_PRODUCT_CRITERIA + "\n"));
  if (outputs.length !== 1 || checks.length !== 1 || blocks.indexOf(outputs[0]) >= blocks.indexOf(checks[0])) return;
  const rows = checks[0].slice(WORK_PRODUCT_CRITERIA.length + 1).split("\n");
  if (!rows.every(row => row.startsWith("- "))) return;
  const parsed = workProductRequestSchema.safeParse({ version: 1,
    questionSha256: createHash("sha256").update(originalQuestion).digest("hex"),
    deliverable: outputs[0].slice(WORK_PRODUCT_DELIVERABLE.length), criteria: rows.map(row => row.slice(2)) });
  return parsed.success ? parsed.data : undefined;
}

export function validWorkProductRequest(request: WorkProductRequest, originalQuestion: string): boolean {
  try {
    const parsed = workProductRequestSchema.safeParse(request);
    return parsed.success && JSON.stringify(parsed.data) === JSON.stringify(request) &&
      JSON.stringify(parseWorkProductRequest(originalQuestion)) === JSON.stringify(request);
  } catch { return false; }
}
