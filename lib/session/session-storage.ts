"use client";

/**
 * Tab-scoped storage for the spending session.
 *
 * What is stored changed: `sessionStorage` used to hold the raw private key as hex. It now holds
 * only AES-GCM ciphertext, whose wrapping key lives in IndexedDB and cannot be exported. Reading
 * this out of the tab yields bytes nobody can use elsewhere.
 *
 * `sessionStorage` is still the right home for the ciphertext, not IndexedDB: it dies when the tab
 * closes, matching the session's intended lifetime. Cross-device recovery never depended on it
 * anyway — the key is derived from a wallet signature, so signing the message again reproduces it.
 */

import { bytesToHex, hexToBytes } from "viem";
import type { WrappedKey } from "./session-key-vault";

const CIPHERTEXT = "keryx_session_key_v2";
const IV = "keryx_session_iv_v2";
const ADDRESS = "keryx_session_addr";
const SESSION_ID = "keryx_session_id";
/** Marks "a deposit was made and is waiting for Circle Gateway to credit it". */
const PENDING = "keryx_session_pending";
/** Pre-worker builds wrote the private key here in the clear. */
const LEGACY_PLAINTEXT_KEY = "keryx_session_sk";

const PENDING_TTL_MS = 15 * 60 * 1000;

export interface StoredSession {
  blob: WrappedKey;
  sessAddr: string;
  sessionId: string;
}

/**
 * Delete any raw key left behind by a build that stored one. Called on mount, so a returning tab
 * stops carrying an exfiltratable key the moment it loads the new code.
 */
export function purgeLegacyPlaintextKey(): void {
  try {
    sessionStorage.removeItem(LEGACY_PLAINTEXT_KEY);
  } catch { /* private mode — nothing to purge */ }
}

export function readSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const ciphertext = sessionStorage.getItem(CIPHERTEXT);
    const iv = sessionStorage.getItem(IV);
    const sessAddr = sessionStorage.getItem(ADDRESS);
    const sessionId = sessionStorage.getItem(SESSION_ID);
    if (!ciphertext || !iv || !sessAddr || !sessionId) return null;
    return {
      blob: {
        wrapped: hexToBytes(ciphertext as `0x${string}`),
        iv: hexToBytes(iv as `0x${string}`),
      },
      sessAddr,
      sessionId,
    };
  } catch {
    return null;
  }
}

export function writeSession(blob: WrappedKey, sessAddr: string, sessionId: string): void {
  try {
    sessionStorage.setItem(CIPHERTEXT, bytesToHex(blob.wrapped));
    sessionStorage.setItem(IV, bytesToHex(blob.iv));
    sessionStorage.setItem(ADDRESS, sessAddr);
    sessionStorage.setItem(SESSION_ID, sessionId);
  } catch { /* storage full or private mode — non-fatal, recovery is a signature away */ }
}

export function clearSession(): void {
  try {
    for (const key of [CIPHERTEXT, IV, ADDRESS, SESSION_ID, PENDING, LEGACY_PLAINTEXT_KEY]) {
      sessionStorage.removeItem(key);
    }
  } catch { /* ignore */ }
}

export function markPending(): void {
  try { sessionStorage.setItem(PENDING, String(Date.now())); } catch { /* ignore */ }
}

export function clearPending(): void {
  try { sessionStorage.removeItem(PENDING); } catch { /* ignore */ }
}

/** True when a deposit is awaiting credit and the marker has not gone stale. */
export function isPendingFresh(): boolean {
  try {
    const at = Number(sessionStorage.getItem(PENDING) ?? "0");
    return at > 0 && Date.now() - at < PENDING_TTL_MS;
  } catch {
    return false;
  }
}
