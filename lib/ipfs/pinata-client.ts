/**
 * Pinata IPFS client — thin wrapper for pinning encrypted blobs and fetching by CID.
 *
 * Offline guard: all exports check hasPinata() before attempting network calls.
 * When PINATA_JWT is unset the module is a no-op — callers fall back to DB plaintext.
 *
 * Rate limit: Pinata free tier allows 60 req/min. At hackathon scale (< 500 items)
 * this is not a concern for ingest. The serve path is cached (decrypted via setCached)
 * so repeat IPFS fetches are avoided.
 */

import { PinataSDK } from "pinata";

let _client: PinataSDK | null = null;

function getClient(): PinataSDK {
  if (!_client) {
    const jwt = process.env.PINATA_JWT;
    if (!jwt) throw new Error("PINATA_JWT is not set");
    _client = new PinataSDK({ pinataJwt: jwt });
  }
  return _client;
}

/** True when PINATA_JWT is configured — IPFS path is active. */
export function hasPinata(): boolean {
  return Boolean(process.env.PINATA_JWT);
}

/**
 * Pin an encrypted buffer to Pinata IPFS. Returns the CIDv1 string.
 * The buffer is already ciphertext — Pinata sees only opaque bytes.
 */
export async function pinEncrypted(buf: Buffer, filename: string): Promise<string> {
  const client = getClient();
  // Wrap in Uint8Array — File constructor accepts ArrayBufferView, not Buffer directly.
  const file = new File([new Uint8Array(buf)], filename, { type: "application/octet-stream" });
  const result = await client.upload.public.file(file);
  // result.cid is the CIDv1 string (base32)
  return result.cid;
}

/**
 * Fetch raw bytes for a CID from the configured IPFS gateway.
 * Defaults to the Pinata public gateway; override with KERYX_IPFS_GATEWAY.
 * Retries once on 5xx to handle transient gateway errors.
 */
export async function fetchByCid(cid: string): Promise<Buffer> {
  const gateway = process.env.KERYX_IPFS_GATEWAY ?? "https://gateway.pinata.cloud";
  const url = `${gateway}/ipfs/${cid}`;

  let res = await fetch(url);
  if (!res.ok && res.status >= 500) {
    // Single retry for transient gateway errors.
    res = await fetch(url);
  }
  if (!res.ok) {
    throw new Error(`IPFS gateway fetch failed: ${res.status} ${res.statusText} (CID: ${cid})`);
  }
  return Buffer.from(await res.arrayBuffer());
}
