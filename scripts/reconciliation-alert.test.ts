import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PENDING_RECONCILIATION_ALERT_STATE_KEY } from "../lib/gateway/pending-reconciliation-health";
import { reconcileAlertState } from "./reconciliation-alert";

const stale = { status: "stale" as const, oldestPendingAgeSeconds: 3600, degraded: true };
const summary = {
  scanned: 1,
  awaiting: 1,
  mismatched: 0,
  oldestPendingAt: "2026-09-29T00:00:00.000Z",
  browserAwaiting: 1,
  treasuryAwaiting: 0,
  acknowledgedAwaiting: 0,
  unacknowledgedAwaiting: 1,
  expiredAwaiting: 0,
  unknownExpiryAwaiting: 0,
};

function stateStore() {
  let fingerprint: string | null = null;
  const writes: string[] = [];
  return {
    writes,
    get fingerprint() { return fingerprint; },
    async getSyncState(key: string) {
      expect(key).toBe(PENDING_RECONCILIATION_ALERT_STATE_KEY);
      return fingerprint;
    },
    async setSyncState(key: string, value: string) {
      expect(key).toBe(PENDING_RECONCILIATION_ALERT_STATE_KEY);
      fingerprint = value;
      writes.push(value);
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("reconciliation alert delivery state", () => {
  it("retries on the next run when no webhook is configured", async () => {
    vi.stubEnv("KERYX_ALERT_WEBHOOK", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendAlert } = await import("../lib/notify/alert");
    const db = stateStore();
    expect(await reconcileAlertState(db, summary, stale, sendAlert)).toBe(true);
    expect(await reconcileAlertState(db, summary, stale, sendAlert)).toBe(true);
    expect(db.fingerprint).toBeNull();
    expect(db.writes).toEqual([]);
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith("[reconcile] out-of-band alert not delivered; retrying next run.");
  });

  it("retries after a non-2xx webhook response", async () => {
    vi.stubEnv("KERYX_ALERT_WEBHOOK", "https://example.invalid/alert");
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetch);
    const { sendAlert } = await import("../lib/notify/alert");
    const db = stateStore();
    expect(await reconcileAlertState(db, summary, stale, sendAlert)).toBe(true);
    expect(db.writes).toEqual([]);
    expect(await reconcileAlertState(db, summary, stale, sendAlert)).toBe(true);
    expect(db.writes).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries after a timed-out webhook request", async () => {
    vi.useFakeTimers();
    vi.stubEnv("KERYX_ALERT_WEBHOOK", "https://example.invalid/alert");
    const fetch = vi.fn().mockImplementationOnce((_url: string, options: RequestInit) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    ).mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetch);
    const { sendAlert } = await import("../lib/notify/alert");
    const db = stateStore();
    const first = reconcileAlertState(db, summary, stale, sendAlert);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(await first).toBe(true);
    expect(db.writes).toEqual([]);
    expect(await reconcileAlertState(db, summary, stale, sendAlert)).toBe(true);
    expect(db.writes).toHaveLength(1);
  });

  it("deduplicates delivered alerts but sends again when the fingerprint changes", async () => {
    const db = stateStore();
    const send = vi.fn().mockResolvedValue(true);
    expect(await reconcileAlertState(db, summary, stale, send)).toBe(true);
    expect(await reconcileAlertState(db, summary, stale, send)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(db.writes).toHaveLength(1);
    const changed = { ...summary, browserAwaiting: 2 };
    expect(await reconcileAlertState(db, changed, stale, send)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(db.writes).toHaveLength(2);
    expect(db.writes[1]).not.toBe(db.writes[0]);
  });

  it("clears delivered state on recovery and alerts if the incident returns", async () => {
    const db = stateStore();
    const send = vi.fn().mockResolvedValue(true);
    await reconcileAlertState(db, summary, stale, send);
    expect(await reconcileAlertState(db, { ...summary, awaiting: 0 }, { status: "clean", oldestPendingAgeSeconds: null, degraded: false }, send)).toBe(false);
    expect(db.fingerprint).toBe("");
    expect(await reconcileAlertState(db, summary, stale, send)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("keeps the incident retryable if the notifier throws", async () => {
    const db = stateStore();
    const send = vi.fn().mockRejectedValueOnce(new Error("https://secret.example/webhook/token"))
      .mockResolvedValueOnce(true);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await reconcileAlertState(db, summary, stale, send)).toBe(true);
    expect(db.writes).toEqual([]);
    expect(error.mock.calls.flat().join(" ")).not.toContain("secret.example");
    expect(await reconcileAlertState(db, summary, stale, send)).toBe(true);
    expect(db.writes).toHaveLength(1);
  });
});
