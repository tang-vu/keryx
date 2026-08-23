import type { ActivationEvent, ActivationFunnel } from "./types";
import type { KeryxDB } from "./db/keryx-db";
import { safeErrorMessage } from "./ops/safe-error-message";

export const ACTIVATION_EVENTS = [
  "reader_landing",
  "reader_ask_started",
  "reader_answer_completed",
  "reader_wallet_connected",
  "reader_session_funded",
  "reader_returning_dispatch",
  "creator_registration_started",
  "creator_verification_completed",
  "creator_citation_settled",
  "creator_withdrawal_completed",
] as const satisfies readonly ActivationEvent[];

export function isActivationEvent(value: unknown): value is ActivationEvent {
  return typeof value === "string" && (ACTIVATION_EVENTS as readonly string[]).includes(value);
}

export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function activationWindow(days: number, now = new Date()): Pick<ActivationFunnel, "windowDays" | "sinceDay"> {
  const windowDays = Number.isFinite(days)
    ? Math.max(1, Math.min(365, Math.floor(days)))
    : 30;
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - (windowDays - 1));
  return { windowDays, sinceDay: utcDay(since) };
}

export function emptyActivationCounts(): ActivationFunnel["counts"] {
  return Object.fromEntries(ACTIVATION_EVENTS.map((event) => [event, 0])) as ActivationFunnel["counts"];
}

/** Best-effort product telemetry. It must never fail an auth, answer, payment, or creator action. */
export async function recordActivationEvent(
  db: KeryxDB,
  event: ActivationEvent,
  now = new Date(),
): Promise<void> {
  try {
    await db.recordActivationEvent(event, utcDay(now));
  } catch (error) {
    console.warn(
      `[activation] could not increment ${event}:`,
      safeErrorMessage(error),
    );
  }
}
