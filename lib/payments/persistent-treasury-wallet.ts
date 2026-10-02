import fs from "node:fs";
import { isAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const MAX_BYTES = 4096;
const RECOVERY_ERROR = "Persistent treasury wallet unavailable; owner recovery required";

function refuse(): never { throw new Error(RECOVERY_ERROR); }

function sameFile(a: fs.BigIntStats, b: fs.BigIntStats): boolean {
  return a.isFile() && b.isFile() && a.nlink === BigInt(1) && b.nlink === BigInt(1)
    && a.dev === b.dev && a.ino === b.ino && a.size === b.size
    && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

/** Load only an existing legacy wallet. Never create, repair, replace or log it.
 * Host ACLs and protection from a malicious local owner remain deployment duties. */
export function loadPersistentTreasuryWallet(file: string): Readonly<{ privateKey: Hex; address: Hex }> {
  let descriptor: number | undefined;
  const bytes = Buffer.alloc(MAX_BYTES + 1);
  try {
    const original = fs.lstatSync(file, { bigint: true });
    if (!original.isFile() || original.nlink !== BigInt(1) || original.size < BigInt(1) || original.size > BigInt(MAX_BYTES)) refuse();
    // lstat rejects ordinary symlinks/FIFOs. NOFOLLOW/NONBLOCK also bound their
    // replacement races on POSIX; Windows relies on the subsequent handle check.
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!sameFile(original, opened)) refuse();
    let length = 0;
    while (length < bytes.length) {
      const read = fs.readSync(descriptor, bytes, length, bytes.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (BigInt(length) !== original.size || length > MAX_BYTES
      || !sameFile(opened, fs.fstatSync(descriptor, { bigint: true }))
      || !sameFile(opened, fs.lstatSync(file, { bigint: true }))) refuse();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
    // Literal legacy fields in either order. JSON.parse alone permits duplicate
    // keys; escaped/foreign fields do not extend the custody format implicitly.
    const shape = /^\s*\{\s*"(privateKey|address)"\s*:\s*"(0x[0-9a-fA-F]+)"\s*,\s*"(privateKey|address)"\s*:\s*"(0x[0-9a-fA-F]+)"\s*\}\s*$/.exec(text);
    if (!shape || shape[1] === shape[3]) refuse();
    const value = JSON.parse(text) as { privateKey: unknown; address: unknown };
    if (typeof value.privateKey !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value.privateKey)
      || typeof value.address !== "string" || !isAddress(value.address)) refuse();
    const privateKey = value.privateKey as Hex;
    const address = privateKeyToAccount(privateKey).address;
    if (address.toLowerCase() !== value.address.toLowerCase()) refuse();
    return Object.freeze({ privateKey, address });
  } catch { return refuse(); }
  finally {
    bytes.fill(0);
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { refuse(); }
    }
  }
}
