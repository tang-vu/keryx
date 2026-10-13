import { z } from "zod";
import { buildDraftCheck, MAX_DRAFT_CHECK_BYTES, parseDraftCheckRequest, type DraftCheckRequest } from "./draft-check";

export const DRAFT_CHECK_STORAGE_KEY = "keryx-private-draft-check-v1";
export const DRAFT_CHECK_LIFETIMES = [3600, 86400, 604800] as const;
export type DraftCheckLifetime = typeof DRAFT_CHECK_LIFETIMES[number];
export interface DraftCheckStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
const envelope = z.object({ version: z.literal(1), savedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(), request: z.unknown() }).strict();
const maxBytes = 66_000;

/** A malformed file must not silently replace private UTF-8 bytes with U+FFFD. */
export function readDraftCheckFile(bytes: Uint8Array): DraftCheckRequest {
  if (bytes.byteLength > MAX_DRAFT_CHECK_BYTES) throw new Error("Oversized draft input");
  const request = parseDraftCheckRequest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  buildDraftCheck(request);
  return request;
}

/** Explicit save only. Default editing/checking never calls this function. Browser
 * storage is origin-local, readable by same-origin scripts and outside server custody.
 * Expiry refuses restore; physical deletion occurs when this page next checks it. */
export function saveDraftCheck(storage: DraftCheckStorage, value: unknown, lifetime: DraftCheckLifetime, now = Date.now()) {
  if (!DRAFT_CHECK_LIFETIMES.includes(lifetime) || !Number.isSafeInteger(now) || now < 0) throw new Error("Invalid draft retention");
  const request = parseDraftCheckRequest(value);
  buildDraftCheck(request); // Refuse invalid spans/reference/source bindings before replacing a saved draft.
  const packet = { version: 1 as const, savedAt: now, expiresAt: now + lifetime * 1000, request };
  const raw = JSON.stringify(packet);
  storage.setItem(DRAFT_CHECK_STORAGE_KEY, raw);
  if (storage.getItem(DRAFT_CHECK_STORAGE_KEY) !== raw) throw new Error("Draft save unverified");
  return packet.expiresAt;
}
export function clearSavedDraftCheck(storage: DraftCheckStorage) {
  storage.removeItem(DRAFT_CHECK_STORAGE_KEY);
  if (storage.getItem(DRAFT_CHECK_STORAGE_KEY) !== null) throw new Error("Draft removal unverified");
}
export function restoreDraftCheck(storage: DraftCheckStorage, now = Date.now()): { request: DraftCheckRequest; expiresAt: number } | null {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid draft retention clock");
  const raw = storage.getItem(DRAFT_CHECK_STORAGE_KEY);
  if (raw === null) return null;
  try {
    if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new Error("Oversized saved draft");
    const packet = envelope.parse(JSON.parse(raw));
    if (!DRAFT_CHECK_LIFETIMES.some(seconds => packet.expiresAt - packet.savedAt === seconds * 1000) || packet.savedAt > now)
      throw new Error("Invalid draft expiry");
    if (packet.expiresAt <= now) { clearSavedDraftCheck(storage); return null; }
    const request = parseDraftCheckRequest(packet.request);
    buildDraftCheck(request); // Recompute; never restore an old/fabricated verdict.
    return { request, expiresAt: packet.expiresAt };
  } catch { clearSavedDraftCheck(storage); throw new Error("Saved draft unavailable"); }
}
