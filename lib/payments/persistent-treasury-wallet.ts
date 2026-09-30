import fs from "node:fs";
import { isAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const MAX_BYTES = 4096;
function refuse(): never { throw new Error("Persistent treasury wallet unavailable; owner recovery required"); }
/** Read the existing legacy {privateKey,address} document without creating or
 * repairing it. Loaded identity is not proof of unused keys or funding history. */
export function loadPersistentTreasuryWallet(file: string): Readonly<{ privateKey: Hex; address: Hex }> {
  let descriptor: number | undefined;
  try {
    // Refuse ordinary non-files before open (e.g. a FIFO would block). This is
    // not a race-free filesystem boundary against an untrusted local owner.
    if (!fs.lstatSync(file).isFile()) refuse();
    descriptor = fs.openSync(file, "r");
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_BYTES) refuse();
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = fs.readSync(descriptor, bytes, length, bytes.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length === 0 || length > MAX_BYTES) refuse();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
    // Exactly two literal legacy fields, in either order. Reject duplicate or
    // foreign fields rather than letting JSON.parse silently choose a key.
    const shape = /^\s*\{\s*"(privateKey|address)"\s*:\s*"(0x[0-9a-fA-F]+)"\s*,\s*"(privateKey|address)"\s*:\s*"(0x[0-9a-fA-F]+)"\s*\}\s*$/.exec(text);
    if (!shape || shape[1] === shape[3]) refuse();
    const value = JSON.parse(text) as { privateKey: unknown; address: unknown };
    if (typeof value.privateKey !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value.privateKey)
      || typeof value.address !== "string" || !isAddress(value.address)) refuse();
    const privateKey = value.privateKey as Hex, address = privateKeyToAccount(privateKey).address;
    if (address.toLowerCase() !== value.address.toLowerCase()) refuse();
    return Object.freeze({ privateKey, address });
  } catch { return refuse(); }
  finally { if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch { refuse(); } } }
}
