import { z } from "zod";
import { idSchema, revisionSchema, statusSchema, recipientSchema, receiptSchema, type Association } from "./contracts";

export const inboxItemSchema = z.object({ assignmentId: idSchema, revision: revisionSchema, status: statusSchema,
  assignedAt: z.number().int().nonnegative(), confirmedAt: z.number().int().nonnegative().nullable(),
  admissionExpiresAt: z.number().int().nonnegative(), effective: z.boolean(),
  // These fields are absent when suppressed. Negative decisions need no original content.
  runId: z.string().optional(), network: z.enum(["eip155:5042", "eip155:5042002"]).optional(),
  attribution: z.enum(["assigned-by-owner", "claimed-from-owner-assignment"]).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.effective !== (v.runId !== undefined && v.network !== undefined && v.attribution !== undefined)
    || !v.effective && (v.runId !== undefined || v.network !== undefined || v.attribution !== undefined))
    ctx.addIssue({ code: "custom", message: "Invalid effective assignment projection" });
  if (v.effective && (v.status !== "assigned-by-owner" && v.status !== "claimed"
    || v.attribution !== (v.status === "claimed" ? "claimed-from-owner-assignment" : "assigned-by-owner")))
    ctx.addIssue({ code: "custom", message: "Invalid assignment attribution discriminator" });
});
export type InboxItem = z.infer<typeof inboxItemSchema>;
export const inboxSchema = z.object({ version: z.literal(1), kind: z.literal("owner-assignment-inbox"), recipient: recipientSchema,
  history: z.array(inboxItemSchema).max(25), profile: z.object({ assignedByOwner: z.number().int().min(0).max(25),
    claimedFromOwnerAssignment: z.number().int().min(0).max(25) }).strict(), receipt: receiptSchema.optional() }).strict().superRefine((v, ctx) => {
  if (v.profile.assignedByOwner !== v.history.filter(r => r.effective && r.attribution === "assigned-by-owner").length
    || v.profile.claimedFromOwnerAssignment !== v.history.filter(r => r.effective && r.attribution === "claimed-from-owner-assignment").length)
    ctx.addIssue({ code: "custom", message: "Assignment counts do not match qualified history" });
});
export type AssignmentInbox = z.infer<typeof inboxSchema>;
export function projectAssignment(row: Association, effective: boolean): InboxItem {
  return inboxItemSchema.parse({ assignmentId: row.member.assignmentId, revision: row.revision, status: row.status,
    assignedAt: row.assignedAt, confirmedAt: row.confirmedAt, admissionExpiresAt: row.manifest.admissionExpiresAt, effective,
    ...(effective ? { runId: row.member.runId, network: row.manifest.binding.network,
      attribution: row.status === "claimed" ? "claimed-from-owner-assignment" : "assigned-by-owner" } : {}) });
}
