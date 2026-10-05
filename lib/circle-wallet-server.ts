import { createHash, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { config } from "./config";
import { authJson } from "./auth-challenge";
import { checkRateLimit, clientIp } from "./rate-limit";
import { circleWalletPublicConfigured } from "./circle-wallet-config";
import { AUTH_CHALLENGE_TTL_MS } from "./auth-time-policy";

export const CIRCLE_LOGIN_TTL_MS = AUTH_CHALLENGE_TTL_MS;
export const CIRCLE_LOGIN_COOKIE = "keryx_circle_login";
export const circleLoginStateSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const circleUserTokenSchema = z.string().min(16).max(8192).regex(/^[A-Za-z0-9._~+\/-]+=*$/);
export const circleLoginHash = (state: string) => createHash("sha256").update(`keryx-circle-login-v1:${state}`).digest("hex");
export const circleBlockchain = () => config.profile.testnet ? "ARC-TESTNET" : "ARC";
export function circleWalletReady() {
  return process.env.KERYX_CIRCLE_GOOGLE_ENABLED === "true" && !!process.env.CIRCLE_API_KEY && !!config.jwtSecret && circleWalletPublicConfigured();
}

/** No caller-controlled URLs or vendor error payloads reach application logs/clients. */
export class CircleWalletError extends Error {
  constructor(public readonly status: number, public readonly code?: number) { super("Circle wallet request unavailable"); }
}
export async function circleRequest(path: string, input?: { userToken?: string; body?: unknown }) {
  const response = await fetch(`https://api.circle.com/v1/w3s/${path}`, {
    method: input?.body === undefined ? "GET" : "POST", cache: "no-store", redirect: "error",
    signal: AbortSignal.timeout(15_000), headers: {
      Authorization: `Bearer ${process.env.CIRCLE_API_KEY}`, "X-Request-Id": randomUUID(),
      ...(input?.userToken ? { "X-User-Token": circleUserTokenSchema.parse(input.userToken) } : {}),
      ...(input?.body === undefined ? {} : { "Content-Type": "application/json" }),
    }, ...(input?.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new CircleWalletError(response.status, typeof value?.code === "number" ? value.code : undefined);
  if (!value?.data || typeof value.data !== "object") throw new CircleWalletError(502);
  return value.data as Record<string, unknown>;
}

export const circleWalletSchema = z.object({ id: z.string().uuid(), address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  blockchain: z.string(), custodyType: z.literal("ENDUSER"), accountType: z.literal("EOA"), state: z.literal("LIVE"),
  userId: z.string().min(1).max(256), createDate: z.string().datetime() });
export type CircleWallet = z.infer<typeof circleWalletSchema>;

/** Circle authenticates X-User-Token and scopes this list. Never accept userId/address from the browser. */
export async function verifiedCircleWallet(userToken: string): Promise<CircleWallet | null> {
  const data = await circleRequest(`wallets?blockchain=${circleBlockchain()}&pageSize=50&order=ASC`, { userToken });
  if (!Array.isArray(data.wallets) || data.wallets.length >= 50) throw new CircleWalletError(502);
  const rows = z.array(z.object({ id: z.string().uuid(), blockchain: z.literal(circleBlockchain()),
    userId: z.string().min(1).max(256), createDate: z.string().datetime() }).passthrough()).parse(data.wallets);
  if (new Set(rows.map(value => value.userId)).size > 1) throw new CircleWalletError(502);
  // Choose the immutable oldest identity BEFORE checking usability. A frozen/unsupported
  // original never silently promotes a newer wallet and abandons its funded budget.
  const original = rows.sort((a, b) => a.createDate.localeCompare(b.createDate) || a.id.localeCompare(b.id))[0];
  if (!original) return null;
  const wallet = circleWalletSchema.safeParse(original);
  if (!wallet.success) throw new CircleWalletError(409);
  return wallet.data;
}

/** Require an explicit same-origin browser POST, with a bounded UTF-8 body and deadline. */
export async function guardCirclePost(request: Request): Promise<Response | null> {
  if (!circleWalletReady()) return authJson({ error: "Google wallet sign-in is not configured" }, 503);
  try {
    if (new URL(request.headers.get("origin") ?? "").origin !== new URL(request.url).origin
      || (request.headers.get("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) {
      return authJson({ error: "origin mismatch" }, 403);
    }
  } catch { return authJson({ error: "missing or invalid origin" }, 403); }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return authJson({ error: "JSON body required" }, 400);
  const key = createHash("sha256").update(clientIp(request)).digest("hex");
  const limited = await checkRateLimit(`circle-auth:${key}`, "public");
  if (limited) limited.headers.set("Cache-Control", "no-store");
  return limited;
}
export async function readCircleBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (!request.body) throw new Error("Missing body");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => {
    reject(new Error("Body deadline")); void reader.cancel().catch(() => undefined);
  }, 10_000); });
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), deadline]); if (done) break;
      length += value.length; if (length > 32_768) throw new Error("Body too large"); chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return schema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } finally { clearTimeout(timer); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
export async function circleLoginCookieMatches(state: string) {
  return circleLoginStateSchema.safeParse(state).success && (await cookies()).get(CIRCLE_LOGIN_COOKIE)?.value === state;
}
export function circleFailure(error: unknown) {
  return authJson({ error: error instanceof CircleWalletError && [401, 403].includes(error.status)
    ? "Google wallet authentication expired; sign in again" : "Google wallet operation unavailable; please try again" },
  error instanceof CircleWalletError && [401, 403].includes(error.status) ? 401 : 503);
}
