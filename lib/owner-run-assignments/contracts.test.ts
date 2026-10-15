import { describe, expect, it } from "vitest";
import { inboxItemSchema, inboxSchema } from "./projection";
import { recipientActionSchema } from "./contracts";
describe("owner269 distinct revocable contract (authored UNRUN)", () => {
  const item = { assignmentId: "11111111-1111-4111-8111-111111111111", revision: 1, status: "assigned-by-owner",
    assignedAt: 1, confirmedAt: null, admissionExpiresAt: 2, effective: true, runId: "synthetic", network: "eip155:5042", attribution: "assigned-by-owner" };
  it("rejects claim-shaped labels, terminal authority and content in a suppressed projection", () => {
    expect(inboxItemSchema.safeParse({ ...item, attribution: "claimed" }).success).toBe(false);
    expect(inboxItemSchema.safeParse({ ...item, attribution: "claimed-from-owner-assignment" }).success).toBe(false);
    expect(inboxItemSchema.safeParse({ ...item, status: "revoked" }).success).toBe(false);
    expect(inboxItemSchema.safeParse({ ...item, effective: false }).success).toBe(false);
    expect(inboxItemSchema.safeParse({ ...item, question: "private" }).success).toBe(false);
  });
  it("refuses unknown versions and counts that inflate qualified attribution", () => {
    const reply = { version: 1, kind: "owner-assignment-inbox", recipient: { accountId: `acct_${"a".repeat(64)}`,
      wallet: `0x${"a".repeat(40)}`, accountCreatedAt: 1, memberGeneration: "b".repeat(64) },
      history: [item], profile: { assignedByOwner: 1, claimedFromOwnerAssignment: 0 } };
    expect(inboxSchema.safeParse(reply).success).toBe(true);
    expect(inboxSchema.safeParse({ ...reply, version: 2 }).success).toBe(false);
    expect(inboxSchema.safeParse({ ...reply, profile: { assignedByOwner: 0, claimedFromOwnerAssignment: 1 } }).success).toBe(false);
  });
  it("cannot accept an owner action through recipient JSON", () => {
    expect(recipientActionSchema.safeParse({ action: "apply", requestId: item.assignmentId, owner: "dev", verified: true }).success).toBe(false);
  });
});
