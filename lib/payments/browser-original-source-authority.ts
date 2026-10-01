import { createPublicClient, type Address, type Hex } from "viem";
import type { KeryxDB } from "../db/keryx-db";
import type { BrowserSourceOriginalAdmission } from "../db/browser-signing-originals";
import { prepareBrowserJournal } from "../db/browser-authorization-journal";
import { canonicalJson } from "../canonical-json";
import { arcTestnet } from "../chains";
import { config } from "../config";
import { attestedArcAuthorityHttp } from "../arc-rpc-attestation";
import { REGISTRY_ABI } from "../registry/registry-abi";
import { sourceItemContentVersion } from "../sources/source-item-asset";
import {
  ObservationElapsedGuard,
  observationUtcNow,
} from "./browser-original-observation-protocol";
import {
  browserOriginalSourceContextSchema,
  browserSourceContextPath,
  browserSourceRegistryId,
  verifyRetainedBrowserOriginalSourceContext,
  type BrowserOriginalSourceContext,
} from "./browser-original-source-context";
import { prepareBrowserSourceSigningOriginal } from "./browser-signing-original";

type Catalog = Pick<KeryxDB, "getSource" | "getItem" | "getArticleOffer">;
declare const verified: unique symbol;
export interface VerifiedBrowserOriginalSourceContext {
  readonly [verified]: true;
}
export interface BrowserOriginalSourceAuthority {
  resolve(
    input: BrowserSourceOriginalAdmission
  ): Promise<VerifiedBrowserOriginalSourceContext>;
}
const tokens = new WeakMap<
  object,
  {
    input: string;
    context: BrowserOriginalSourceContext;
    life: ObservationElapsedGuard;
    admissionDeadlineMs: number;
  }
>();
const refused = () => {
  throw new Error("Browser source authority refused");
};
let pendingResolutions = 0;

/** The resolver owns catalog and RPC selection. Callers supply neither payout nor block authority. */
export function createBrowserOriginalSourceAuthority(
  catalog: Catalog
): BrowserOriginalSourceAuthority {
  const rpcUrl = config.rpcUrl;
  const registry = config.registryReadAddress;
  return Object.freeze({
    resolve: (input: BrowserSourceOriginalAdmission) =>
      create(catalog, rpcUrl, registry).resolve(input),
  });
}
/** Explicit localhost-only composition for actual native synthetic RPC fixtures. */
export function createSyntheticBrowserOriginalSourceAuthority(
  catalog: Catalog,
  rpcUrl: string,
  registry: string
): BrowserOriginalSourceAuthority {
  const url = new URL(rpcUrl);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password
  )
    return refused();
  return create(catalog, rpcUrl, registry);
}
function create(
  catalog: Catalog,
  rpcUrl: string,
  registry: string
): BrowserOriginalSourceAuthority {
  if (!/^0x[0-9a-fA-F]{40}$/.test(registry)) return refused();
  const client = createPublicClient({
    chain: arcTestnet,
    transport: attestedArcAuthorityHttp(rpcUrl, {
      timeout: 4000,
      retryCount: 0,
    }),
  });
  return Object.freeze({
    async resolve(
      value: BrowserSourceOriginalAdmission
    ): Promise<VerifiedBrowserOriginalSourceContext> {
      if (pendingResolutions >= 8) return refused();
      const admissionDeadlineMs = observationUtcNow() + 5000;
      if (!Number.isSafeInteger(admissionDeadlineMs)) return refused();
      const life = new ObservationElapsedGuard(5000);
      pendingResolutions++;
      const pending = (async () => {
        try {
          const input = JSON.parse(
            canonicalJson(value)
          ) as BrowserSourceOriginalAdmission;
          const binding = canonicalJson(input);
          life.live();
          if (
            input.protocol !== "durable-v3" ||
            input.journal.kind !== "fetch" ||
            input.journal.sourceId !== input.source.sourceId ||
            input.journal.offerId !== input.source.offerId
          )
            return refused();
          const journal = prepareBrowserJournal(input.journal);
          const sourceValue = await catalog.getSource(input.source.sourceId);
          life.live();
          const source = sourceValue && JSON.parse(canonicalJson(sourceValue));
          const itemValue = await catalog.getItem(
            input.source.sourceId,
            input.source.itemId
          );
          life.live();
          const item = itemValue && JSON.parse(canonicalJson(itemValue));
          if (
            !source ||
            !item ||
            source.id !== input.source.sourceId ||
            item.sourceId !== source.id ||
            item.id !== input.source.itemId ||
            source.active === false ||
            source.verified === false ||
            !/^0x[0-9a-fA-F]{64}$/.test(source.onchainId ?? "") ||
            sourceItemContentVersion(item) !== input.source.contentVersion
          )
            return refused();
          const block = await client.getBlock({ blockTag: "latest" });
          life.live();
          if (block.number === null || block.hash === null) return refused();
          const record = await client.readContract({
            address: registry as Address,
            abi: REGISTRY_ABI,
            functionName: "get",
            args: [source.onchainId as Hex],
            blockNumber: block.number,
          });
          life.live();
          const finalBlock = await client.getBlock({
            blockNumber: block.number,
          });
          life.live();
          if (
            finalBlock.hash !== block.hash ||
            !record.active ||
            browserSourceRegistryId(record.creator, source.url) !==
              source.onchainId.toLowerCase() ||
            record.payoutWallet.toLowerCase() !==
              journal.requirements.payTo.toLowerCase()
          )
            return refused();
          let price: BrowserOriginalSourceContext["price"];
          if (input.source.offerId === null) {
            price = {
              mode: "list",
              amountMicros: record.fetchPriceUsdc6.toString(),
            };
          } else {
            const offerValue = await catalog.getArticleOffer(
              source.id,
              item.id
            );
            life.live();
            const offer = offerValue && JSON.parse(canonicalJson(offerValue));
            if (!offer || offer.id !== input.source.offerId) return refused();
            offer.signer = offer.signer.toLowerCase();
            offer.signature = offer.signature.toLowerCase();
            price = {
              mode: "creator-offer",
              amountMicros: String(offer.priceUsdc6),
              offer,
            };
          }
          const context = browserOriginalSourceContextSchema.parse({
            version: "source-context-v1",
            service: "https://keryx.cc",
            kind: "fetch",
            source: {
              sourceId: source.id,
              canonicalUrl: source.url,
              registryId: source.onchainId.toLowerCase(),
            },
            item: {
              itemId: item.id,
              contentVersion: input.source.contentVersion,
            },
            endpoint: { method: "GET", path: "/" },
            registry: {
              network: "eip155:5042002",
              contract: registry.toLowerCase(),
              blockNumber: block.number.toString(),
              blockHash: block.hash.toLowerCase(),
              blockTimestamp: block.timestamp.toString(),
              creator: record.creator.toLowerCase(),
              payoutWallet: record.payoutWallet.toLowerCase(),
              listPriceMicros: record.fetchPriceUsdc6.toString(),
              active: true,
            },
            price,
          });
          context.endpoint.path = browserSourceContextPath(context);
          const admissionJournal = prepareBrowserJournal(input.journal);
          const original = prepareBrowserSourceSigningOriginal(
            admissionJournal,
            input.queryNamespace,
            context
          );
          const retained = await verifyRetainedBrowserOriginalSourceContext(
            context,
            original,
            admissionJournal
          );
          life.live();
          const token = Object.freeze(
            {}
          ) as VerifiedBrowserOriginalSourceContext;
          tokens.set(token, {
            input: binding,
            context: retained,
            life,
            admissionDeadlineMs,
          });
          return token;
        } catch {
          life.close();
          return refused();
        }
      })().finally(() => {
        pendingResolutions--;
      });
      let timeout: () => void = () => {};
      const expired = new Promise<never>((_, reject) => {
        timeout = () => reject(new Error("Browser source authority refused"));
        life.abort.signal.addEventListener("abort", timeout, { once: true });
        if (life.abort.signal.aborted) timeout();
      });
      try {
        return await Promise.race([pending, expired]);
      } finally {
        life.abort.signal.removeEventListener("abort", timeout);
      }
    },
  });
}
export function assertVerifiedBrowserOriginalSourceContextCurrent(
  token: VerifiedBrowserOriginalSourceContext,
  input: BrowserSourceOriginalAdmission
): void {
  const record = tokens.get(token);
  if (!record || record.input !== canonicalJson(input)) return refused();
  record.life.live();
}
/** Final guard is also required immediately before the backend call/transaction. */
export function prepareBrowserSourceSigningAdmission(
  input: BrowserSourceOriginalAdmission,
  token: VerifiedBrowserOriginalSourceContext
) {
  assertVerifiedBrowserOriginalSourceContextCurrent(token, input);
  const captured = JSON.parse(
    canonicalJson(input)
  ) as BrowserSourceOriginalAdmission;
  const record = tokens.get(token);
  if (!record) return refused();
  const context = record.context;
  const journal = prepareBrowserJournal(captured.journal);
  const original = prepareBrowserSourceSigningOriginal(
    journal,
    captured.queryNamespace,
    context
  );
  const prepared = JSON.parse(
    canonicalJson({
      input: { ...captured, sourceContext: context },
      journal,
      original,
      admissionDeadlineMs: record.admissionDeadlineMs,
    })
  ) as {
    input: BrowserSourceOriginalAdmission & {
      sourceContext: BrowserOriginalSourceContext;
    };
    journal: typeof journal;
    original: typeof original;
    admissionDeadlineMs: number;
  };
  function freeze(value: object): void {
    for (const child of Object.values(value))
      if (child && typeof child === "object") freeze(child);
    Object.freeze(value);
  }
  freeze(prepared);
  return prepared;
}
