import { createCipheriv, createDecipheriv, createSecretKey, randomBytes } from "node:crypto";
import { mkdir, lstat, open, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { addressSchema } from "../buyer/protocol";
import { writeBuyerFile } from "../buyer/journal";
import { privateResearchIdSchema } from "./private-research-intent";
import type { KeryxDB } from "../db/keryx-db";
import type { QueryRun } from "../types";

const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const contextSchema = z.object({ id: privateResearchIdSchema, payer: addressSchema, workerId: z.string().uuid() }).strict();
const payloadSchema = contextSchema.extend({ serializedRun: z.string().min(2).max(4 * 1024 * 1024) }).strict();
const envelopeSchema = z.object({ schema: z.literal("keryx-private-result-spool-v1"), iv: z.string().regex(/^[a-f0-9]{24}$/),
  tag: z.string().regex(/^[a-f0-9]{32}$/), ciphertext: z.string().min(4).max(24 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict();
const maxFileBytes = 24 * 1024 * 1024;
const aad = (token: string) => Buffer.from(`keryx-private-result-spool-v1|${token}`, "utf8");

function validatePayload(value: unknown) {
  const payload = payloadSchema.parse(value);
  const identity = z.object({ id: z.string(), question: z.string(), budget: z.number().finite(),
    researchMode: z.enum(["quick", "deep"]), answer: z.string() }).parse(JSON.parse(payload.serializedRun));
  if (identity.id !== payload.id) throw new Error();
  return payload;
}

/** Dedicated environment-supplied encryption key, never a signing key. No plaintext
 * file is written. A spool record is a backup, not execution authority or a receipt.
 * Directory/key provisioning and worker integration remain operator responsibilities. */
export async function createPrivateResultSpool(directory: string, keyHex: string) {
  try {
    const key = createSecretKey(Buffer.from(z.string().regex(/^[a-fA-F0-9]{64}$/).parse(keyHex), "hex"));
    const root = resolve(directory);
    try {
      await mkdir(root, { mode: 0o700 });
      if (process.platform !== "win32") {
        const parent = await open(dirname(root), "r");
        try { await parent.sync(); } finally { await parent.close(); }
      }
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
    const file = (token: string) => join(root, `${tokenSchema.parse(token)}.json`);
    async function read(token: string) {
      try {
        const handle = await open(file(token), "r");
        let bytes: Buffer;
        try {
          const metadata = await handle.stat();
          if (!metadata.isFile() || metadata.size > maxFileBytes) throw new Error();
          bytes = Buffer.alloc(metadata.size + 1);
          let offset = 0;
          while (offset < bytes.length) {
            const result = await handle.read(bytes, offset, bytes.length - offset, null);
            if (!result.bytesRead) break;
            offset += result.bytesRead;
          }
          if (offset > metadata.size) throw new Error();
          bytes = bytes.subarray(0, offset);
        } finally { await handle.close(); }
        const envelope = envelopeSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "hex"), { authTagLength: 16 });
        decipher.setAAD(aad(token)); decipher.setAuthTag(Buffer.from(envelope.tag, "hex"));
        const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
        return validatePayload(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)));
      } catch { throw new Error("Private result backup unavailable"); }
    }
    return {
      async save(context: z.infer<typeof contextSchema>, run: QueryRun) {
        try {
          // Capture the entire result before asynchronous filesystem work.
          const payload = validatePayload({ ...contextSchema.parse(context), serializedRun: JSON.stringify(run) });
          const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
          if (plaintext.length > 16 * 1024 * 1024) throw new Error();
          const token = randomBytes(32).toString("hex"), iv = randomBytes(12);
          const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
          cipher.setAAD(aad(token));
          const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
          const envelope = { schema: "keryx-private-result-spool-v1", iv: iv.toString("hex"),
            tag: cipher.getAuthTag().toString("hex"), ciphertext: ciphertext.toString("base64") };
          if (Buffer.byteLength(JSON.stringify(envelope, null, 2) + "\n") > maxFileBytes) throw new Error();
          await writeBuyerFile(root, `${token}.json`, envelope);
          return token;
        } catch { throw new Error("Private result backup could not be saved"); }
      },
      read,
      async restore(db: Pick<KeryxDB, "savePrivateResearchResult">, token: string) {
        try {
          const payload = await read(token);
          // DB admission revalidates the original owner, worker claim and immutable result.
          const saved = await db.savePrivateResearchResult(payload.id, payload.payer, payload.workerId, JSON.parse(payload.serializedRun));
          if (saved.id !== payload.id || saved.serializedRun !== payload.serializedRun) throw new Error();
          await unlink(file(token));
          if (process.platform !== "win32") {
            const parent = await open(root, "r");
            try { await parent.sync(); } finally { await parent.close(); }
          }
          return { status: "restored" as const };
        } catch { throw new Error("Private result restore unavailable; check stored result and backup"); }
      },
    };
  } catch { throw new Error("Private result backup configuration unavailable"); }
}

export type PrivateResultSpool = Awaited<ReturnType<typeof createPrivateResultSpool>>;
