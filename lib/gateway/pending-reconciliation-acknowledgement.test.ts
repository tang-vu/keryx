import { describe, expect, it } from "vitest";
import type { PaymentRecord } from "../types";
import {
  addPendingReconciliationAcknowledgementOnce,
  createPendingReconciliationAcknowledgement,
  decodePendingReconciliationAcknowledgements,
  isAcknowledgedLegacyTreasuryPending,
  isLegacyTreasuryAcknowledgementEligible,
  parsePendingReconciliationAcknowledgements,
  serializePendingReconciliationAcknowledgements,
} from "./pending-reconciliation-acknowledgement";

const NOW = new Date("2026-08-30T00:00:00.000Z");
const TREASURY = "0x1111111111111111111111111111111111111111";
const payment = (overrides: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: "x402:0xabc",
  kind: "fetch",
  queryId: "query",
  sourceId: "source",
  sourceName: "Source",
  payer: "0x1111111111111111111111111111111111111111",
  payee: "0x2222222222222222222222222222222222222222",
  amountUsdc: 0.002,
  network: "eip155:5042002",
  settled: false,
  settlementStatus: "pending",
  authorizationId: "0xabc",
  createdAt: "2026-08-20T00:00:00.000Z",
  ...overrides,
});

describe("pending reconciliation acknowledgement", () => {
  it("allows only old legacy treasury ambiguity", () => {
    expect(isLegacyTreasuryAcknowledgementEligible(payment(), TREASURY, NOW.getTime())).toBe(true);
    expect(
      isLegacyTreasuryAcknowledgementEligible(
        payment({ grantEpoch: "browser-epoch" }),
        TREASURY,
        NOW.getTime(),
      ),
    ).toBe(false);
    expect(
      isLegacyTreasuryAcknowledgementEligible(
        payment({ authorizationExpiresAt: "2026-08-28T00:00:00.000Z" }),
        TREASURY,
        NOW.getTime(),
      ),
    ).toBe(false);
    expect(
      isLegacyTreasuryAcknowledgementEligible(
        payment({ createdAt: "2026-08-29T12:00:01.000Z" }),
        TREASURY,
        NOW.getTime(),
      ),
    ).toBe(false);
    expect(
      isLegacyTreasuryAcknowledgementEligible(
        payment(),
        "0x3333333333333333333333333333333333333333",
        NOW.getTime(),
      ),
    ).toBe(false);
  });

  it("binds an audit acknowledgement to the complete economic tuple", () => {
    const acknowledgement = createPendingReconciliationAcknowledgement(payment(), {
      treasuryPayer: TREASURY,
      reason: "Circle scan was complete and returned no matching transfer.",
      circleCheckedAt: "2026-08-29T23:59:00.000Z",
      circleCandidateCount: 32,
      now: NOW,
    });
    expect(
      isAcknowledgedLegacyTreasuryPending(
        payment(),
        [acknowledgement],
        TREASURY,
        NOW.getTime(),
      ),
    ).toBe(true);
    expect(
      isAcknowledgedLegacyTreasuryPending(
        payment({ amountUsdc: 0.003 }),
        [acknowledgement],
        TREASURY,
        NOW.getTime(),
      ),
    ).toBe(false);
  });

  it("round-trips valid audit records and drops malformed state", () => {
    const acknowledgement = createPendingReconciliationAcknowledgement(payment(), {
      treasuryPayer: TREASURY,
      reason: "Circle scan was complete and returned no matching transfer.",
      circleCheckedAt: "2026-08-29T23:59:00.000Z",
      circleCandidateCount: 32,
      now: NOW,
    });
    expect(
      parsePendingReconciliationAcknowledgements(
        serializePendingReconciliationAcknowledgements([acknowledgement]),
      ),
    ).toEqual([acknowledgement]);
    expect(parsePendingReconciliationAcknowledgements("not json")).toEqual([]);
    expect(parsePendingReconciliationAcknowledgements('{"schemaVersion":2}')).toEqual([]);
    expect(decodePendingReconciliationAcknowledgements("not json")).toEqual({
      valid: false,
      acknowledgements: [],
    });
    expect(
      decodePendingReconciliationAcknowledgements(
        JSON.stringify({
          schemaVersion: 1,
          acknowledgements: [acknowledgement, acknowledgement],
        }),
      ).valid,
    ).toBe(false);
  });

  it("is idempotent and refuses to overwrite a conflicting audit tuple", () => {
    const acknowledgement = createPendingReconciliationAcknowledgement(payment(), {
      treasuryPayer: TREASURY,
      reason: "Circle scan was complete and returned no matching transfer.",
      circleCheckedAt: "2026-08-29T23:59:00.000Z",
      circleCandidateCount: 32,
      now: NOW,
    });
    expect(addPendingReconciliationAcknowledgementOnce([], acknowledgement)).toMatchObject({
      created: true,
      acknowledgements: [acknowledgement],
    });
    expect(
      addPendingReconciliationAcknowledgementOnce([acknowledgement], {
        ...acknowledgement,
        acknowledgedAt: "2026-08-30T01:00:00.000Z",
        reason: "A later invocation must not replace the original audit record.",
      }),
    ).toEqual({
      created: false,
      acknowledgement,
      acknowledgements: [acknowledgement],
    });
    expect(() =>
      addPendingReconciliationAcknowledgementOnce([acknowledgement], {
        ...acknowledgement,
        economicTupleHash: "f".repeat(64),
      }),
    ).toThrow(/conflicts/);
  });
});
