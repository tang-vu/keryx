import { describe, expect, it } from "vitest";
import type { SessionGrantRecord, WebSessionRecord } from "../db/keryx-db";
import { assertDecisionReviewAuthority } from "./decision-review-authority";
const owner = `0x${"1".repeat(40)}`, hash = "a".repeat(64), now = 1800000000000;
const session: WebSessionRecord = { hash, wallet: owner, issuedAt: now - 1000, expiresAt: now + 60000 };
const grant: SessionGrantRecord = { sessionId: owner, sessAddr: `0x${"2".repeat(40)}`, ownerAddr: owner, cap: 0.05, spent: 0,
  expiry: now + 60000, txHash: "synthetic", grantEpoch: "original-epoch" };
describe("fresh decision admission authority", () => {
  it("permits legitimate earlier spend without inventing a renewed request budget", () => {
    expect(() => assertDecisionReviewAuthority(owner, hash, session, grant, { ...grant, spent: 0.049999 }, now)).not.toThrow();
  });
  it.each([null, { ...session, hash: "b".repeat(64) }, { ...session, wallet: `0x${"3".repeat(40)}` },
    { ...session, expiresAt: now }, { ...session, issuedAt: now + 1 }, { ...session, expiresAt: NaN }])("refuses missing/logout/foreign/expired/invalid session %j", changed => {
    expect(() => assertDecisionReviewAuthority(owner, hash, changed, grant, grant, now)).toThrow("review_conflict");
  });
  it.each([undefined, { ...grant, grantEpoch: "new-epoch" }, { ...grant, sessAddr: `0x${"3".repeat(40)}` },
    { ...grant, ownerAddr: `0x${"3".repeat(40)}` }, { ...grant, sessionId: "another-session" }, { ...grant, cap: 0.06 },
    { ...grant, expiry: now }, { ...grant, spent: 0.050001 }, { ...grant, spent: -1e-15 }, { ...grant, spent: 1e-15 },
    { ...grant, spent: NaN }])("refuses revoked/replaced/changed/exhausted/malformed grant %j", changed => {
    expect(() => assertDecisionReviewAuthority(owner, hash, session, grant, changed, now)).toThrow("review_conflict");
  });
});
