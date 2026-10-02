import type { KeryxDB, SessionGrantRecord } from "../db/keryx-db";
import type { StorageDeploymentManifest } from "../db/runtime-storage-config";
import { validateStorageIdentity } from "../db/storage-identity";
import { createMainnetPilotSqliteAdapter } from "../db/enrolled-sqlite-adapter";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import type { BrowserGatewayContext } from "../payments/browser-cosign-gateway";
import type { ReasoningEngine } from "../llm/reasoning-engine";
import { pinPilotPolicy, type PilotPolicy } from "./policy";
import { createPilotAdmissions } from "./sqlite-admission";
import { createPilotSourceAuthority } from "./source-authority";
import { createPilotSignatures } from "./signatures";

declare const trusted: unique symbol;
export interface PilotServerContext {
  readonly [trusted]: true;
  readonly mode: "synthetic";
  readonly policy: PilotPolicy;
  readonly enrollmentDigest: string;
  readonly db: KeryxDB;
  readonly engine: ReasoningEngine;
  readonly sourceAuthority: ReturnType<typeof createPilotSourceAuthority>;
  readonly admissions: ReturnType<typeof createPilotAdmissions>;
  readonly getGrant: (owner: string) => Promise<SessionGrantRecord | undefined>;
  readonly fundedCapacityMicros: (signer: string) => Promise<number>;
  readonly gatewayContext: BrowserGatewayContext;
  readonly seller: (request: Request) => Promise<Response>;
  readonly signatures: ReturnType<typeof createPilotSignatures>;
  readonly unavailableSources: () => readonly string[];
  close(): void;
}
const contexts = new WeakSet<object>();
export function assertPilotServerContext(value: PilotServerContext): void {
  if (!contexts.has(value)) throw new Error("Pilot server context refused");
  value.admissions.assertPolicy();
}

/** Live activation remains a separate reviewed, owner-authorized release. No flag enables it. */
export async function getLivePilotServerContext(): Promise<PilotServerContext> {
  throw new Error("Mainnet pilot activation remains closed");
}

/** Explicit test composition, not a production context loader or caller-controlled switch. */
export async function createSyntheticPilotServerContext(input: {
  policy: PilotPolicy;
  deployment: Readonly<StorageDeploymentManifest>;
  rpcUrl: string;
  engine: ReasoningEngine;
  fundedCapacityMicros: (signer: string) => Promise<number>;
  seller: (request: Request, context: PilotServerContext) => Promise<Response>;
}): Promise<PilotServerContext> {
  if (process.env.NODE_ENV !== "test") throw new Error("Synthetic pilot context requires test process");
  const pinned = pinPilotPolicy(input.policy);
  const identity = validateStorageIdentity(input.deployment.identity);
  if (identity.authorityMode !== "mainnet-pilot-real" || identity.provenanceDigest !== pinned.digest ||
      input.deployment.backend.kind !== "sqlite") throw new Error("Pilot deployment identity refused");
  const deployment = Object.freeze({ ...input.deployment, identity, backend: Object.freeze({ ...input.deployment.backend }) });
  let admissions!: ReturnType<typeof createPilotAdmissions>;
  let closed = false;
  const db = await createMainnetPilotSqliteAdapter(deployment, () => {
    if (closed) throw new Error("Pilot storage closed");
  }, connection => {
    admissions = createPilotAdmissions(connection, pinned.policy);
    return admissions.hooks;
  });
  try {
    await db.activateBrowserJournal();
    const authority = createPilotSourceAuthority(pinned.policy, input.rpcUrl, true);
    const unavailable = new Set<string>();
    const catalog = new Proxy(Object.create(null), { get(_target, key) {
      if (key === "getArticleOffer") return async () => null;
      if (key === "listSources") return async () => {
        const results = await Promise.all((await db.listSources()).map(async source => {
          try { const resolved = await authority.resolve(source); unavailable.delete(source.id); return resolved.source; }
          catch { unavailable.add(source.id); return null; }
        }));
        return results.filter((source): source is NonNullable<typeof source> => source !== null);
      };
      const value = Reflect.get(db, key);
      return typeof value === "function" ? value.bind(db) : value;
    } }) as KeryxDB;
    const getGrant = async (owner: string) => {
      const grant = await db.getSessionGrant(owner);
      if (!grant || grant.ownerAddr.toLowerCase() !== owner || grant.expiry <= Date.now() ||
          Math.floor(Date.now() / 1000) >= pinned.policy.expiresAtSeconds ||
          !pinned.policy.invitedBuyers.includes(owner) ||
          pinned.policy.retainedTestnetSigners.includes(grant.sessAddr.toLowerCase())) return undefined;
      return grant;
    };
    let context!: PilotServerContext;
    const seller = (request: Request) => input.seller(request, context);
    const signatures = createPilotSignatures();
    const gatewayContext = Object.freeze({
      profile: ARC_MAINNET_PROFILE,
      origin: pinned.policy.origin,
      db: catalog,
      getGrant,
      sourceFetchPayTo: async source => (await authority.terms(source)).payTo,
      assertCitationPayTo: authority.citation,
      pathFor: path => {
        if (!path.startsWith("/api/source/") && !path.startsWith("/api/cite/")) throw new Error("Pilot seller path refused");
        return path.replace("/api/", "/api/mainnet-pilot/");
      },
      fetch: async (url, init) => {
        const selected = new URL(String(url));
        if (selected.origin !== pinned.policy.origin || !selected.pathname.startsWith("/api/mainnet-pilot/") ||
            init?.redirect !== "error") throw new Error("Pilot transport refused");
        return seller(new Request(selected, init));
      },
    } satisfies BrowserGatewayContext);
    context = Object.freeze({ mode: "synthetic", policy: pinned.policy, enrollmentDigest: pinned.digest, db: catalog, engine: input.engine,
      sourceAuthority: authority, admissions, getGrant, fundedCapacityMicros: input.fundedCapacityMicros, gatewayContext, seller, signatures,
      unavailableSources: () => Object.freeze([...unavailable]),
      close() { if (!closed) { signatures.close(); closed = true; db.close(); } } }) as PilotServerContext;
    contexts.add(context);
    return context;
  } catch (error) { closed = true; db.close(); throw error; }
}
