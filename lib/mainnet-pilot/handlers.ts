import { createHash, randomBytes } from "node:crypto";
import { recoverMessageAddress, type Hex } from "viem";
import { z } from "zod";
import { assertPilotServerContext, type PilotServerContext } from "./server-context";
import { pilotGrantFieldsSchema, createPilotGrantMessage } from "./public-enrollment";
import { readPilotJson } from "./read-json";
import { runPilotBrowserAsk } from "./run-browser-ask";
import { sourceItemIdentity } from "../sources/source-item-asset";

export const PILOT_SESSION_COOKIE = "__Host-keryx-pilot-session";
const address = z.string().regex(/^0x[0-9a-f]{40}$/);
const challengeSchema = z.object({ owner: address, signer: address }).strict();
const grantSchema = pilotGrantFieldsSchema.extend({ signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  enrollmentDigest: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
const requestSchema = z.object({ reqId: z.string().uuid() }).strict();
const signSchema = requestSchema.extend({ paymentHeader: z.string().min(1).max(4096) }).strict();
const refused = (status = 403) => Response.json({ error: "pilot_request_refused" }, { status });

function authenticated(context: PilotServerContext, request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const tokens = cookie.split(";").map(value => value.trim()).filter(value => value.startsWith(`${PILOT_SESSION_COOKIE}=`));
  if (tokens.length !== 1) throw new Error("Pilot session refused");
  const token = tokens[0].slice(PILOT_SESSION_COOKIE.length + 1);
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("Pilot session refused");
  const session = context.admissions.readSession(createHash("sha256").update(token).digest("hex"));
  if (!session) throw new Error("Pilot session refused");
  return session;
}

/** Routes and synthetic transports use this same server implementation. */
export async function handlePilotRequest(request: Request, context: PilotServerContext): Promise<Response> {
  try {
    assertPilotServerContext(context);
    const url = new URL(request.url);
    if (url.origin !== context.policy.origin) return refused();
    if (request.method !== "GET" && request.headers.get("origin") !== context.policy.origin) return refused();
    const path = url.pathname;
    if (path === "/api/mainnet-pilot/grant/challenge" && request.method === "POST") {
      const { owner, signer } = challengeSchema.parse(await readPilotJson(request));
      if (!context.policy.invitedBuyers.includes(owner)) return refused();
      const rate = await context.db.consumeRateLimit(`pilot-grant:${owner}`, 5, 60000, Date.now());
      if (!rate.allowed) return refused(429);
      const fields = context.admissions.issueGrant(owner, signer, await context.fundedCapacityMicros(signer));
      return Response.json({ ...fields, enrollmentDigest: context.enrollmentDigest }, { headers: { "Cache-Control": "no-store" } });
    }
    if (path === "/api/mainnet-pilot/grant" && request.method === "POST") {
      const { signature, enrollmentDigest, ...fields } = grantSchema.parse(await readPilotJson(request));
      if (enrollmentDigest !== context.enrollmentDigest) return refused();
      const message = createPilotGrantMessage({ enrollment: context.policy, enrollmentDigest: context.enrollmentDigest }, fields);
      if ((await recoverMessageAddress({ message, signature: signature as Hex })).toLowerCase() !== fields.owner) return refused();
      const token = randomBytes(32).toString("hex");
      context.admissions.consumeGrant(fields, createHash("sha256").update(token).digest("hex"));
      return Response.json({ ...fields, enrollmentDigest }, { headers: { "Cache-Control": "no-store",
        "Set-Cookie": `${PILOT_SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Number(fields.expirySeconds) - Math.floor(Date.now() / 1000))}` } });
    }
    if (path === "/api/mainnet-pilot/grant" && request.method === "GET") {
      return Response.json({ ...authenticated(context, request), enrollmentDigest: context.enrollmentDigest }, { headers: { "Cache-Control": "no-store" } });
    }
    const session = authenticated(context, request);
    const preview = /^\/api\/mainnet-pilot\/source\/(0x[0-9a-f]{64})\/item\/([^/]+)\/preview$/.exec(path);
    if (preview && request.method === "GET") {
      const source = await context.db.getSource(preview[1]);
      const item = await context.db.getItem(preview[1], decodeURIComponent(preview[2]));
      if (!source || !item || item.sourceId !== source.id || item.storageMode !== "db_encrypted" ||
          item.deliveryKind !== "full_text" || item.manifest || item.ipfsCid || !/^0x[0-9a-f]{64}$/.test(item.bodyHash ?? "") ||
          !Number.isSafeInteger(item.plaintextBytes) || item.plaintextBytes! <= 0 || item.plaintextBytes! > 262144) return refused();
      const identity = sourceItemIdentity(item);
      if (url.searchParams.size !== 1 || url.searchParams.get("version") !== identity.contentVersion) return refused(409);
      const resolved = await context.sourceAuthority.resolve(source);
      return Response.json({ sourceId: source.id, item: identity, payTo: resolved.terms.payTo,
        listPriceMicroUsdc: String(Math.round(resolved.terms.listPriceUsdc * 1e6)) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (path === "/api/mainnet-pilot/grant" && request.method === "DELETE") {
      if (!context.admissions.revokeGrant(session)) return refused(409);
      context.signatures.revoke(session.owner, session.grantEpoch);
      return Response.json({ revoked: true, retainedAuthorizations: true }, { headers: { "Cache-Control": "no-store",
        "Set-Cookie": `${PILOT_SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0` } });
    }
    if (path === "/api/mainnet-pilot/ask" && request.method === "POST") return runPilotBrowserAsk(request, context, session.owner);
    if (path === "/api/mainnet-pilot/challenge" && request.method === "POST") {
      const { reqId } = requestSchema.parse(await readPilotJson(request));
      return Response.json(await context.signatures.challenge(context, session.owner, reqId), { headers: { "Cache-Control": "no-store" } });
    }
    if (path === "/api/mainnet-pilot/sign" && request.method === "POST") {
      const { reqId, paymentHeader } = signSchema.parse(await readPilotJson(request));
      return Response.json(await context.signatures.acknowledge(context, session.owner, reqId, paymentHeader), { headers: { "Cache-Control": "no-store" } });
    }
    return refused();
  } catch { return refused(); }
}
