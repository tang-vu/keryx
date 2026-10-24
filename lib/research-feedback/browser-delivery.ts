"use client";
import { feedbackDeliverySchema, type FeedbackDelivery } from "./contracts";

// Original-caller memory only: no QueryRun/turn persistence, localStorage,
// public report, URL, export, analytics or recovery/reissue surface.
const packets = new Map<string, FeedbackDelivery>();
const listeners = new Set<() => void>();
export function receiveRequesterObservations(raw: unknown) {
  const parsed = feedbackDeliverySchema.safeParse(raw);
  if (!parsed.success) return;
  if (packets.has(parsed.data.runId)) return;
  packets.set(parsed.data.runId, parsed.data);
  if (packets.size > 20) packets.delete(packets.keys().next().value!);
  for (const listener of listeners) listener();
}
export const requesterObservation = (id: string) => packets.get(id) ?? null;
export function observeRequesterDelivery(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
