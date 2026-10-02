import fs from "node:fs";
import path from "node:path";
import { createHash, createHmac } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { writePrivateExclusive } from "./backup-files";

export const r2Limits = { objectBytes: 32 * 1024 * 1024, retainedObjects: 24, monthlyRequests: 1000, attemptRequests: 32 };
const objectPattern = /^keryx-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sqlite\.enc$/;
type Config = { endpoint: string; bucket: string; accessKey: string; secretKey: string };
type Ledger = { version: 1; month: string; reservedRequests: number; lastUploadDay: string | null };

export function r2Config(env: Record<string, string | undefined> = process.env): Config {
  const endpoint = env.KERYX_R2_ENDPOINT ?? "";
  const bucket = env.KERYX_R2_BUCKET ?? "";
  const accessKey = env.KERYX_R2_ACCESS_KEY_ID ?? "";
  const secretKey = env.KERYX_R2_SECRET_ACCESS_KEY ?? "";
  if (!/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(endpoint) ||
      !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || !accessKey || !secretKey) {
    throw new Error("R2 configuration rejected.");
  }
  return { endpoint, bucket, accessKey, secretKey };
}

function sha(bytes: string | Buffer) { return createHash("sha256").update(bytes).digest("hex"); }
function hmac(key: string | Buffer, data: string) { return createHmac("sha256", key).update(data).digest(); }

/** One request, one 30s deadline, no SDK retries, redirects, multipart, HEAD or traversal. */
export async function r2Request(config: Config, method: string, object = "", query = "", body?: Buffer): Promise<Response> {
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = now.slice(0, 8);
  const url = new URL(`${config.endpoint}/${config.bucket}${object ? `/${encodeURIComponent(object)}` : ""}${query ? `?${query}` : ""}`);
  const payloadHash = sha(body ?? Buffer.alloc(0));
  const headers = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": now };
  const signedHeaders = Object.keys(headers).join(";");
  const canonicalHeaders = Object.entries(headers).map(([key, value]) => `${key}:${value}\n`).join("");
  const canonical = [method, url.pathname, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/auto/s3/aws4_request`;
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secretKey}`, day), "auto"), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(`AWS4-HMAC-SHA256\n${now}\n${scope}\n${sha(canonical)}`).digest("hex");
  const response = await fetch(url, { method, headers: { ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` },
    body: body ? new Uint8Array(body) : undefined, redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error("R2 request failed; attempt budget remains reserved."); }
  return response;
}

export function reserveR2Budget(ledgerPath: string, requests: number, upload: boolean, now = new Date()): boolean {
  const metadata = fs.lstatSync(ledgerPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 4096) throw new Error("R2 budget ledger unavailable.");
  const value: Ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  if (value.version !== 1 || !/^\d{4}-\d{2}$/.test(value.month) || value.month > month ||
      !Number.isSafeInteger(value.reservedRequests) || value.reservedRequests < 0 || value.reservedRequests > r2Limits.monthlyRequests ||
      !(value.lastUploadDay === null || /^\d{4}-\d{2}-\d{2}$/.test(value.lastUploadDay)) ||
      !Number.isSafeInteger(requests) || requests < 1) throw new Error("R2 budget ledger rejected.");
  if (upload && value.lastUploadDay !== null && value.lastUploadDay >= day) return false;
  const reserved = value.month === month ? value.reservedRequests : 0;
  if (reserved + requests > r2Limits.monthlyRequests) throw new Error("R2 monthly job budget exhausted.");
  const next: Ledger = { version: 1, month, reservedRequests: reserved + requests,
    lastUploadDay: upload ? day : value.lastUploadDay };
  const temporary = `${ledgerPath}.pending`;
  writePrivateExclusive(temporary, JSON.stringify(next));
  fs.renameSync(temporary, ledgerPath);
  // Persist the rename before any network request on the production Linux host.
  if (process.platform !== "win32") { const fd = fs.openSync(path.dirname(ledgerPath), "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
  return true;
}

export async function initializeR2Budget(directory: string, config: Config): Promise<void> {
  const target = path.join(directory, "r2-budget.json");
  if (fs.existsSync(target)) throw new Error("Existing R2 budget ledger must never be reinitialized.");
  // Create before LIST; failure leaves a ledger requiring inspection, not retryable initialization.
  writePrivateExclusive(target, JSON.stringify({ version: 1, month: new Date().toISOString().slice(0, 7), reservedRequests: 1, lastUploadDay: null }));
  const objects = await listR2Objects(config);
  if (objects.length) throw new Error("R2 initialization requires a new empty dedicated bucket.");
}

async function boundedText(response: Response): Promise<string> {
  if (!response.body) throw new Error("R2 response missing.");
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const part of Readable.fromWeb(response.body as never)) {
    const chunk = Buffer.from(part); bytes += chunk.length;
    if (bytes > 64 * 1024) throw new Error("R2 listing response too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function parseR2Listing(xml: string): { key: string; size: number }[] {
  if (!/<IsTruncated>false<\/IsTruncated>/.test(xml)) throw new Error("R2 listing incomplete; refusing pagination.");
  const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((match) => {
    const key = /<Key>([^<]+)<\/Key>/.exec(match[1])?.[1] ?? "";
    const size = Number(/<Size>(\d+)<\/Size>/.exec(match[1])?.[1] ?? NaN);
    if (!objectPattern.test(key) || !Number.isSafeInteger(size) || size < 37 || size > r2Limits.objectBytes) {
      throw new Error("R2 bucket contains unexpected or oversized objects.");
    }
    return { key, size };
  });
  if (!/<ListBucketResult[\s>]/.test(xml) || objects.length > r2Limits.retainedObjects + 1 || new Set(objects.map((o) => o.key)).size !== objects.length) {
    throw new Error("R2 bucket inventory rejected.");
  }
  return objects.sort((a, b) => a.key.localeCompare(b.key));
}

async function listR2Objects(config: Config) {
  return parseR2Listing(await boundedText(await r2Request(config, "GET", "", "list-type=2&max-keys=26")));
}

/** Caller holds exclusive backup lock through reservation, listing, rotation and upload. */
export async function uploadR2Backup(source: string, directory: string, config: Config): Promise<"uploaded" | "daily-limit"> {
  const key = path.basename(source);
  const size = fs.lstatSync(source);
  if (!objectPattern.test(key) || !size.isFile() || size.isSymbolicLink() || size.size > r2Limits.objectBytes) throw new Error("R2 upload object rejected (32 MiB maximum).");
  if (!reserveR2Budget(path.join(directory, "r2-budget.json"), r2Limits.attemptRequests, true)) return "daily-limit";
  const objects = await listR2Objects(config);
  if (objects.some((object) => object.key === key)) throw new Error("R2 upload key already exists.");
  // Reconcile a previous ambiguous PUT/failed DELETE before adding a 26th object.
  while (objects.length > r2Limits.retainedObjects) {
    const oldest = objects.shift()!;
    if (oldest.key >= key) throw new Error("R2 snapshot timestamp rejected.");
    await (await r2Request(config, "DELETE", oldest.key)).body?.cancel();
  }
  // Keep all prior backups until PUT succeeds. 25 * 32 MiB = 800 MiB transient maximum.
  await (await r2Request(config, "PUT", key, "", fs.readFileSync(source))).body?.cancel();
  if (objects.length === r2Limits.retainedObjects) {
    const oldest = objects[0];
    if (oldest.key >= key) throw new Error("R2 snapshot timestamp rejected.");
    await (await r2Request(config, "DELETE", oldest.key)).body?.cancel();
  }
  return "uploaded";
}

/** Budgeted off-host retrieval for an offline drill; destination is exclusive and private. */
export async function downloadR2Backup(key: string, destination: string, directory: string, config: Config): Promise<void> {
  if (!objectPattern.test(key)) throw new Error("R2 object name rejected.");
  reserveR2Budget(path.join(directory, "r2-budget.json"), 1, false);
  const response = await r2Request(config, "GET", key);
  if (!response.body) throw new Error("R2 response missing.");
  let size = 0;
  await pipeline(Readable.fromWeb(response.body as never), new Transform({ transform(chunk: Buffer, _encoding, done) {
    size += chunk.length; done(size > r2Limits.objectBytes ? new Error("R2 download size limit exceeded.") : null, chunk);
  } }), fs.createWriteStream(destination, { flags: "wx", mode: 0o600 }));
}
