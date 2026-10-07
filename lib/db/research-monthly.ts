import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";
import { assertVerifiedSqliteConnection } from "./storage-identity-connection";
import { storagePaymentProfile, storageIdentityDigest } from "./storage-identity";
import { a2aOrderId, a2aRequestHash, sameA2aOrder, type A2aOrder } from "../a2a/order";
import { a2aResearchPackageFingerprint, isSupportedA2aResearchPackage, type A2aResearchPackage } from "../a2a/research-package";
import { sourceClaimReceiptSchema } from "../sources/public-source-claim";
import { admitSqliteSourceClaimPurchasePolicy } from "./public-source-claims";
import type { SourceClaimReceipt } from "../types";

export const MONTHLY_REQUEST_LIMIT = 4;
export const MONTHLY_TERM_MS = 30 * 24 * 60 * 60_000;
export interface MonthlyPurchase {
  /** Explicit original rail on fresh mainnet; unlabelled historical records remain testnet only. */
  format?: "keryx-research-monthly-purchase-v2"; network?: string; asset?: string; gatewayContract?: string;
  id: string; payer: string; payee: string; authorizationId: string; transaction: string; quoteId: string;
  createdAt: string; expiresAt: string; creatorBudgetMicros: number; serviceFeeMicros: number;
  totalMicros: number; researchPackage: A2aResearchPackage;
}
export interface MonthlyRedemption { requestId: string; orderId: string; requestHash: string; createdAt: string; slot: number }
export interface MonthlyRedemptionInput { monthlyId: string; payer: string; requestId: string; now: string; order: A2aOrder }
export interface ResearchPurchaseClaim {
  network: string; asset?: string; payer: string; payee: string; authorizationId: string;
  purpose: "a2a" | "monthly" | "resource"; requestHash: string; amountMicros: number;
  /** Paid Monthly admission verifies a previously issued challenge; it never creates a claim. */
  requireExisting?: boolean;
  /** Exact EIP-3009 validity and separate challenge expiry, in decimal epoch seconds. */
  issued?: { validAfter: string; validBefore: string; expiresAt: string };
  /** Exact seller source even when a managed caller omits its required expected policy. */
  resourceSourceId?: string;
  resourceKind?: "fetch" | "citation" | "operating-fee";
  sourceClaim?: { sourceId: string; receipt: SourceClaimReceipt; kind: "fetch" | "citation" };
}
function trustedProfile(profile: ArcNetworkProfile) {
  if (profile !== ARC_MAINNET_PROFILE && profile !== ARC_TESTNET_PROFILE) throw new Error("Untrusted research profile");
  return profile;
}

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const monthlyId = z.string().regex(/^monthly_[0-9a-f]{64}$/);
const requestId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const timestamp = z.string().datetime({ offset: true });
const micros = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const epochSeconds = z.string().regex(/^(0|[1-9]\d{0,15})$/);
const issuedShape = z.object({ validAfter: epochSeconds, validBefore: epochSeconds, expiresAt: epochSeconds }).strict();
const validIssuedPeriod = (value: {validAfter:string;validBefore:string;expiresAt:string}) =>
  BigInt(value.validBefore)-BigInt(value.validAfter)>=BigInt(604800) && BigInt(value.validBefore)-BigInt(value.validAfter)<=BigInt(2592000) &&
  BigInt(value.expiresAt)>BigInt(value.validAfter) && BigInt(value.expiresAt)<BigInt(value.validBefore);
const issuedSchema = issuedShape.refine(validIssuedPeriod,"Invalid issued challenge window");
const storedIssuedSchema = issuedShape.extend({submitted:z.boolean()}).refine(validIssuedPeriod,"Invalid stored issued challenge window");
const purchaseSchema = z.object({
  id: monthlyId, payer: address, payee: address, authorizationId: z.string().min(1).max(256),
  transaction: z.string().min(1).max(512), quoteId: z.string().regex(/^[0-9a-f]{64}$/), createdAt: timestamp, expiresAt: timestamp,
  creatorBudgetMicros: micros, serviceFeeMicros: micros, totalMicros: micros,
  researchPackage: z.custom<A2aResearchPackage>((value) => isSupportedA2aResearchPackage(value as A2aResearchPackage)),
}).strict();
const redemptionSchema = z.object({ requestId, orderId: z.string().regex(/^a2a_[0-9a-f]{64}$/), requestHash: z.string().regex(/^[0-9a-f]{64}$/), createdAt: timestamp, slot: z.number().int().min(0).max(3) }).strict();

export function monthlyPurchaseId(input: Parameters<typeof a2aOrderId>[0]): string {
  return a2aOrderId(input).replace(/^a2a_/, "monthly_");
}
export function monthlyOrderId(id: string, request: string): string {
  monthlyId.parse(id); requestId.parse(request);
  return `a2a_${crypto.createHash("sha256").update(JSON.stringify(["keryx-monthly-redemption-v1", id, request])).digest("hex")}`;
}
export function validateMonthlyPurchase(value: unknown, profile: ArcNetworkProfile = ARC_TESTNET_PROFILE): MonthlyPurchase {
  trustedProfile(profile);
  const labelled = purchaseSchema.extend({ format: z.literal("keryx-research-monthly-purchase-v2"), network: z.literal(profile.networkId),
    asset: z.literal(profile.usdcAddress.toLowerCase()), gatewayContract: z.literal(profile.gatewayWallet.toLowerCase()) }).strict();
  const purchase: MonthlyPurchase = profile === ARC_MAINNET_PROFILE ? labelled.parse(value) : z.union([purchaseSchema, labelled]).parse(value);
  if (purchase.id !== monthlyPurchaseId({ ...purchase, network: profile.networkId }) ||
    purchase.totalMicros !== MONTHLY_REQUEST_LIMIT * purchase.creatorBudgetMicros + purchase.serviceFeeMicros ||
    purchase.serviceFeeMicros % MONTHLY_REQUEST_LIMIT !== 0 ||
    Date.parse(purchase.expiresAt) - Date.parse(purchase.createdAt) !== MONTHLY_TERM_MS) {
    throw new Error("Invalid Monthly purchase contract");
  }
  return purchase;
}
function samePurchase(a: MonthlyPurchase, b: MonthlyPurchase) {
  return a.format === b.format && a.network === b.network && a.asset === b.asset && a.gatewayContract === b.gatewayContract && a.id === b.id && a.payer.toLowerCase() === b.payer.toLowerCase() && a.payee.toLowerCase() === b.payee.toLowerCase() &&
    a.authorizationId.toLowerCase() === b.authorizationId.toLowerCase() && a.transaction === b.transaction && a.quoteId === b.quoteId &&
    a.createdAt === b.createdAt && a.expiresAt === b.expiresAt && a.creatorBudgetMicros === b.creatorBudgetMicros &&
    a.serviceFeeMicros === b.serviceFeeMicros && a.totalMicros === b.totalMicros &&
    a2aResearchPackageFingerprint(a.researchPackage) === a2aResearchPackageFingerprint(b.researchPackage);
}
function inputKey(input: MonthlyRedemptionInput) {
  return { monthlyId: monthlyId.parse(input.monthlyId), payer: address.parse(input.payer), requestId: requestId.parse(input.requestId), now: timestamp.parse(input.now) };
}
function assertOrder(purchase: MonthlyPurchase, input: MonthlyRedemptionInput, profile: ArcNetworkProfile = ARC_TESTNET_PROFILE) {
  const key = inputKey(input), order = input.order;
  if (!order || (profile === ARC_MAINNET_PROFILE && order.request?.network !== profile.networkId) ||
    (order.request?.network !== undefined && order.request.network !== profile.networkId) || key.payer.toLowerCase() !== purchase.payer.toLowerCase() ||
    order.id !== monthlyOrderId(purchase.id, key.requestId) || order.queryId !== order.id ||
    order.authorizationId !== `${purchase.authorizationId}:monthly:${key.requestId}` ||
    order.payer.toLowerCase() !== purchase.payer.toLowerCase() || order.payee.toLowerCase() !== purchase.payee.toLowerCase() ||
    order.transaction !== purchase.transaction || order.creatorBudgetUsdc !== purchase.creatorBudgetMicros / 1e6 ||
    order.serviceFeeUsdc !== purchase.serviceFeeMicros / MONTHLY_REQUEST_LIMIT / 1e6 ||
    order.amountUsdc !== purchase.totalMicros / MONTHLY_REQUEST_LIMIT / 1e6 ||
    !isSupportedA2aResearchPackage(order.researchPackage, order.researchMode) ||
    a2aResearchPackageFingerprint(order.researchPackage) !== a2aResearchPackageFingerprint(purchase.researchPackage) ||
    !order.request || order.request.origin !== "a2a" || order.request.monthlyId !== purchase.id || typeof order.request.question !== "string" || !order.request.question.trim() ||
    order.request.question.length > 10_000 || (order.request.model !== undefined && (typeof order.request.model !== "string" || order.request.model.length > 256)) ||
    order.requestHash !== a2aRequestHash({ ...order, ...order.request }) ||
    order.status !== "running" || order.startedAt !== null || order.workerId !== null || order.executionJournalVersion !== 1 ||
    order.paymentStartedAt !== null || order.resultSavingAt !== null || order.response !== null || order.errorCode !== null || order.resolution !== null ||
    !timestamp.safeParse(order.createdAt).success || order.updatedAt !== order.createdAt) {
    throw new Error("Monthly redemption contract mismatch");
  }
}
function assertReplay(stored: A2aOrder, proposed: A2aOrder, redemption: MonthlyRedemption) {
  if (!sameA2aOrder(stored, proposed) || !stored.request || !proposed.request ||
    stored.request.network !== proposed.request.network || stored.request.question !== proposed.request.question || stored.request.model !== proposed.request.model ||
    stored.request.origin !== "a2a" || stored.request.monthlyId !== proposed.request.monthlyId || redemption.orderId !== stored.id || redemption.requestHash !== stored.requestHash) {
    throw new Error("Monthly request replay conflict");
  }
}
function parseData(value: unknown): unknown { return typeof value === "string" ? JSON.parse(value) : value; }
function checkedRedemptions(purchase: MonthlyPurchase, values: unknown[]): MonthlyRedemption[] {
  const redemptions = values.map(value => redemptionSchema.parse(value));
  if (redemptions.length > MONTHLY_REQUEST_LIMIT || redemptions.some((value, index) =>
    value.slot !== index || value.orderId !== monthlyOrderId(purchase.id, value.requestId) ||
    Date.parse(value.createdAt) < Date.parse(purchase.createdAt) || Date.parse(value.createdAt) >= Date.parse(purchase.expiresAt)) ||
    new Set(redemptions.map(value => value.requestId)).size !== redemptions.length) {
    throw new Error("Invalid stored Monthly redemptions");
  }
  return redemptions;
}

/** Shared row shape used by the atomic Supabase RPC and SQLite insertion. */
export function monthlyOrderToRow(order: A2aOrder): Record<string, unknown> {
  return { id: order.id, query_id: order.queryId, authorization_id: order.authorizationId, request_hash: order.requestHash,
    payer: order.payer, payee: order.payee, amount_usdc: order.amountUsdc, creator_budget_usdc: order.creatorBudgetUsdc,
    service_fee_usdc: order.serviceFeeUsdc, research_mode: order.researchMode, package_data: order.researchPackage,
    status: order.status, transaction_id: order.transaction, request_data: order.request, started_at: order.startedAt,
    worker_id: order.workerId, execution_journal_version: order.executionJournalVersion, payment_started_at: order.paymentStartedAt,
    result_saving_at: order.resultSavingAt, response_data: order.response, error_code: order.errorCode,
    resolution_data: order.resolution, created_at: order.createdAt, updated_at: order.updatedAt };
}

/** Canonical profile schema, with no historical backfill or network adoption. */
export function researchMonthlySchemaSql(profile: ArcNetworkProfile): string {
  trustedProfile(profile);
  return `
CREATE TABLE IF NOT EXISTS research_purchase_authorizations (
  network TEXT NOT NULL CHECK(network='${profile.networkId}'), asset TEXT NOT NULL CHECK(asset='${profile.usdcAddress.toLowerCase()}'),
  payer TEXT NOT NULL, payee TEXT NOT NULL, authorization_id TEXT NOT NULL,
  product TEXT NOT NULL CHECK(product IN ('a2a','monthly','resource')), purchase_id TEXT NOT NULL,
  request_hash TEXT NOT NULL, amount_micros INTEGER NOT NULL CHECK(amount_micros > 0),
  issued_data TEXT,
  PRIMARY KEY(network,asset,payer,authorization_id)
);
CREATE TABLE IF NOT EXISTS research_monthly (
  id TEXT PRIMARY KEY, payer TEXT NOT NULL, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS research_monthly_redemptions (
  monthly_id TEXT NOT NULL REFERENCES research_monthly(id), request_id TEXT NOT NULL,
  order_id TEXT NOT NULL UNIQUE REFERENCES a2a_orders(id) DEFERRABLE INITIALLY DEFERRED,
  request_hash TEXT NOT NULL, created_at TEXT NOT NULL, slot INTEGER NOT NULL CHECK(slot BETWEEN 0 AND 3),
  PRIMARY KEY(monthly_id,request_id), UNIQUE(monthly_id,slot)
);
CREATE TRIGGER IF NOT EXISTS a2a_purchase_authorization AFTER INSERT ON a2a_orders
WHEN NOT EXISTS (SELECT 1 FROM research_monthly_redemptions WHERE order_id=NEW.id)
BEGIN
  ${profile === ARC_MAINNET_PROFILE ? "SELECT CASE WHEN json_extract(NEW.request_data,'$.network') IS NOT 'eip155:5042' THEN RAISE(ABORT,'Original research network required') END;" : ""}
  SELECT CASE WHEN EXISTS (SELECT 1 FROM research_purchase_authorizations
    WHERE payer=lower(NEW.payer) AND authorization_id=lower(NEW.authorization_id)
      AND (payee!=lower(NEW.payee) OR product!='a2a' OR purchase_id!=NEW.id OR request_hash!=NEW.request_hash OR amount_micros!=round(NEW.amount_usdc*1000000))) THEN RAISE(ABORT,'Research authorization already used') END;
  INSERT OR IGNORE INTO research_purchase_authorizations (network,asset,payer,payee,authorization_id,product,purchase_id,request_hash,amount_micros)
    VALUES('${profile.networkId}','${profile.usdcAddress.toLowerCase()}',lower(NEW.payer),lower(NEW.payee),lower(NEW.authorization_id),'a2a',NEW.id,NEW.request_hash,round(NEW.amount_usdc*1000000));
END;
CREATE TRIGGER IF NOT EXISTS research_monthly_immutable BEFORE UPDATE ON research_monthly
BEGIN SELECT RAISE(ABORT,'Monthly purchases are immutable'); END;
CREATE TRIGGER IF NOT EXISTS research_monthly_redemptions_immutable BEFORE UPDATE ON research_monthly_redemptions
BEGIN SELECT RAISE(ABORT,'Monthly redemptions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS research_monthly_no_delete BEFORE DELETE ON research_monthly
BEGIN SELECT RAISE(ABORT,'Monthly purchases are immutable'); END;
CREATE TRIGGER IF NOT EXISTS research_monthly_redemptions_no_delete BEFORE DELETE ON research_monthly_redemptions
BEGIN SELECT RAISE(ABORT,'Monthly redemptions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS research_purchase_authorizations_immutable BEFORE UPDATE ON research_purchase_authorizations
WHEN NOT COALESCE((NEW.network=OLD.network AND NEW.asset=OLD.asset AND NEW.payer=OLD.payer AND NEW.payee=OLD.payee
  AND NEW.authorization_id=OLD.authorization_id AND NEW.product=OLD.product AND NEW.purchase_id=OLD.purchase_id
  AND NEW.request_hash=OLD.request_hash AND NEW.amount_micros=OLD.amount_micros
  AND json_extract(OLD.issued_data,'$.submitted')=0 AND NEW.issued_data=json_set(OLD.issued_data,'$.submitted',json('true'))),0)
BEGIN SELECT RAISE(ABORT,'Research authorization claims are immutable'); END;
CREATE TRIGGER IF NOT EXISTS research_purchase_authorizations_no_delete BEFORE DELETE ON research_purchase_authorizations
BEGIN SELECT RAISE(ABORT,'Research authorization claims are immutable'); END;`;
}
/** Historical ordinary testnet installation retains its explicit backfills. */
export const RESEARCH_MONTHLY_SQL = researchMonthlySchemaSql(ARC_TESTNET_PROFILE) + `INSERT OR IGNORE INTO research_purchase_authorizations (network,asset,payer,payee,authorization_id,product,purchase_id,request_hash,amount_micros)
SELECT 'eip155:5042002','0x3600000000000000000000000000000000000000',lower(payer),lower(payee),lower(authorization_id),'a2a',id,request_hash,round(amount_usdc*1000000) FROM a2a_orders
WHERE NOT EXISTS (SELECT 1 FROM research_monthly_redemptions WHERE order_id=a2a_orders.id);
INSERT OR IGNORE INTO research_purchase_authorizations (network,asset,payer,payee,authorization_id,product,purchase_id,request_hash,amount_micros)
SELECT network,'0x3600000000000000000000000000000000000000',lower(payer),lower(payee),lower(authorization_id),'resource',id,'legacy:unbound',round(amount_usdc*1000000)
FROM payment_events WHERE network='eip155:5042002' AND authorization_id IS NOT NULL AND authorization_id!='' AND amount_usdc > 0;
`;

export function installMainnetResearchSchema(db: DatabaseSync): void {
  if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name IN ('keryx_storage_identity','research_purchase_authorizations','research_monthly','research_monthly_redemptions')").get() ||
    db.prepare("SELECT 1 FROM payment_events UNION ALL SELECT 1 FROM a2a_orders LIMIT 1").get()) throw new Error("Fresh research namespace required");
  db.exec(researchMonthlySchemaSql(ARC_MAINNET_PROFILE));
  db.exec(`CREATE TRIGGER mainnet_research_order_network BEFORE INSERT ON a2a_orders
    WHEN json_extract(NEW.request_data,'$.network') IS NOT 'eip155:5042'
    BEGIN SELECT RAISE(ABORT,'Original research network required'); END;
    CREATE TRIGGER mainnet_monthly_submitted_claim BEFORE INSERT ON research_monthly
    WHEN NOT EXISTS(SELECT 1 FROM research_purchase_authorizations c WHERE c.network='eip155:5042'
      AND c.asset='0x3600000000000000000000000000000000000000'
      AND c.payer=lower(NEW.payer) AND c.authorization_id=lower(json_extract(NEW.data,'$.authorizationId'))
      AND c.product='monthly' AND c.purchase_id=NEW.id AND c.payee=lower(json_extract(NEW.data,'$.payee'))
      AND c.request_hash=json_extract(NEW.data,'$.quoteId') AND c.amount_micros=json_extract(NEW.data,'$.totalMicros')
      AND json_extract(c.issued_data,'$.submitted')=1)
    BEGIN SELECT RAISE(ABORT,'Submitted original Monthly challenge required'); END;`);
}

/** The canonical adapter profile and actual sealed writer bind purchase authority. */
export function assertSqliteResearchAuthority(db: DatabaseSync, profile: ArcNetworkProfile = ARC_TESTNET_PROFILE, write = false): void {
  trustedProfile(profile);
  if (profile === ARC_TESTNET_PROFILE) { assertOrdinarySqliteResearchAuthority(db); return; }
  const identity = assertVerifiedSqliteConnection(db);
  if (identity.authorityMode !== "mainnet-real" || storagePaymentProfile(identity) !== profile) throw new Error("Research storage profile unavailable");
  if (write && db.prepare("SELECT keryx_storage_capability(?,?) AS admitted").get(storageIdentityDigest(identity),identity.authorityMode)?.admitted !== 1)
    throw new Error("Research storage writer unavailable");
  // The connection independently verifies the complete source-generated catalog.
  for (const name of ["research_purchase_authorizations","research_monthly","research_monthly_redemptions"])
    if (db.prepare("SELECT type FROM sqlite_schema WHERE name=?").get(name)?.type !== "table") throw new Error("Research schema unavailable");
}

/** Refuse ambiguous historical debit identities instead of selecting a backfill winner. */
export function initializeSqliteResearchMonthly(db: DatabaseSync) {
  assertOrdinarySqliteResearchAuthority(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    assertOrdinarySqliteResearchAuthority(db);
    db.exec(RESEARCH_MONTHLY_SQL);
    if (!db.prepare("PRAGMA table_info(research_purchase_authorizations)").all().some(column => column.name === "issued_data"))
      db.exec("ALTER TABLE research_purchase_authorizations ADD COLUMN issued_data TEXT");
    // Upgrade only the known pre-issuance local feature trigger; no issued evidence is inferred.
    const claimTrigger=db.prepare("SELECT sql FROM sqlite_schema WHERE name='research_purchase_authorizations_immutable'").get();
    if (claimTrigger && !String(claimTrigger.sql).includes("json_set")) {
      db.exec("DROP TRIGGER research_purchase_authorizations_immutable");
      db.exec(RESEARCH_MONTHLY_SQL);
    }
    const conflict = db.prepare(`SELECT 1 FROM a2a_orders a JOIN research_purchase_authorizations c
      ON c.payer=lower(a.payer) AND c.authorization_id=lower(a.authorization_id)
      WHERE NOT EXISTS (SELECT 1 FROM research_monthly_redemptions WHERE order_id=a.id)
        AND (c.payee!=lower(a.payee) OR c.product!='a2a' OR c.purchase_id!=a.id OR c.request_hash!=a.request_hash OR c.amount_micros!=round(a.amount_usdc*1000000))
      UNION ALL SELECT 1 FROM payment_events p JOIN research_purchase_authorizations c
        ON c.payer=lower(p.payer) AND c.authorization_id=lower(p.authorization_id)
      WHERE p.network='eip155:5042002' AND p.authorization_id IS NOT NULL AND p.authorization_id!='' AND p.amount_usdc>0
        AND (c.payee!=lower(p.payee) OR c.amount_micros!=round(p.amount_usdc*1000000)
          OR (c.product IN ('a2a','monthly') AND (p.kind IS NOT 'inbound' OR p.query_id IS NOT c.purchase_id))) LIMIT 1`).get();
    if (conflict) throw new Error("Ambiguous historical research authorization; reconciliation required");
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

/** Historical ordinary/testnet installation cannot adopt any enrolled namespace. */
export function assertOrdinarySqliteResearchAuthority(db: DatabaseSync) {
  if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name='keryx_storage_identity'").get())
    throw new Error("Research purchase authority is unavailable in enrolled storage");
}

function claimRow(value: ResearchPurchaseClaim, profile: ArcNetworkProfile = ARC_TESTNET_PROFILE) {
  trustedProfile(profile);
  const claim = z.object({ network: z.literal(profile.networkId), asset: z.literal(profile.usdcAddress.toLowerCase()).optional(), payer: address, payee: address,
    authorizationId: z.string().min(1).max(256), purpose: z.enum(["a2a", "monthly", "resource"]), requestHash: z.string().regex(/^[0-9a-f]{64}$/), amountMicros: micros,
    requireExisting: z.boolean().optional(), issued: issuedSchema.optional(), resourceSourceId: z.string().min(1).max(256).optional(), resourceKind: z.enum(["fetch", "citation", "operating-fee"]).optional(),
    sourceClaim: z.object({ sourceId: z.string().min(1).max(256), receipt: sourceClaimReceiptSchema, kind: z.enum(["fetch", "citation"]) }).strict().optional() }).strict().parse(value);
  if (claim.sourceClaim && (claim.purpose !== "resource" || claim.resourceSourceId && claim.resourceSourceId !== claim.sourceClaim.sourceId ||
    claim.resourceKind && claim.resourceKind !== claim.sourceClaim.kind))
    throw new Error("Research source claim context differs from seller resource");
  if (claim.requireExisting && (!claim.issued || claim.purpose !== "monthly")) throw new Error("Issued Monthly authorization required");
  if (claim.issued) {
    const now=BigInt(Math.floor(Date.now()/1000)),after=BigInt(claim.issued.validAfter),before=BigInt(claim.issued.validBefore),expiry=BigInt(claim.issued.expiresAt);
    if (claim.purpose !== "monthly" || (!claim.requireExisting && (after < now-BigInt(660) || now<=after || before<now+BigInt(604800) || expiry<=now || expiry>now+BigInt(660))))
      throw new Error("Issued Monthly authorization expired or invalid");
  }
  return { required: claim.requireExisting === true, row: { network: profile.networkId, asset: profile.usdcAddress.toLowerCase(), payer: claim.payer.toLowerCase(), payee: claim.payee.toLowerCase(), authorization_id: claim.authorizationId.toLowerCase(),
    product: claim.purpose, purchase_id: claim.purpose === "monthly" ? monthlyPurchaseId(claim) : a2aOrderId(claim), request_hash: claim.requestHash, amount_micros: claim.amountMicros,
    issued_data: claim.issued ?? null } };
}
export function claimSqliteResearchPurchase(db: DatabaseSync, value: ResearchPurchaseClaim, profile: ArcNetworkProfile = ARC_TESTNET_PROFILE) {
  assertSqliteResearchAuthority(db,profile,true);
  const {row,required} = claimRow(value,profile);
  const ownTransaction = !db.isTransaction;
  if (ownTransaction) db.exec("BEGIN IMMEDIATE");
  try {
    assertSqliteResearchAuthority(db,profile,true);
    const existing = db.prepare("SELECT 1 FROM research_purchase_authorizations WHERE network=? AND asset=? AND payer=? AND authorization_id=?").get(row.network,row.asset,row.payer,row.authorization_id);
    admitSqliteSourceClaimPurchasePolicy(db, { identity: { network: row.network, payer: row.payer, authorizationId: row.authorization_id },
      existing: Boolean(existing), sourceId: value.resourceSourceId ?? value.sourceClaim?.sourceId,
      receipt: value.sourceClaim?.receipt, kind: value.sourceClaim?.kind ?? value.resourceKind, payee: row.payee, amountMicros: row.amount_micros, requestHash: row.request_hash });
    if (!required) db.prepare("INSERT OR IGNORE INTO research_purchase_authorizations (network,asset,payer,payee,authorization_id,product,purchase_id,request_hash,amount_micros,issued_data) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(...Object.values(row).map(value => value !== null && typeof value === "object" ? JSON.stringify({...value,submitted:false}) : value));
    const stored = db.prepare("SELECT * FROM research_purchase_authorizations WHERE network=? AND asset=? AND payer=? AND authorization_id=?").get(row.network,row.asset,row.payer,row.authorization_id);
    if (!stored || Object.entries(row).some(([key, value]) => key !== "issued_data" && stored[key] !== value)) throw new Error("Research authorization claim conflict");
    const issued = stored.issued_data == null ? null : storedIssuedSchema.parse(parseData(stored.issued_data));
    if ((required && !issued) || (row.issued_data && (!issued || issued.validAfter!==row.issued_data.validAfter || issued.validBefore!==row.issued_data.validBefore || issued.expiresAt!==row.issued_data.expiresAt))) throw new Error("Issued Monthly authorization mismatch");
    if (required && issued && !issued.submitted) {
      const now=BigInt(Math.floor(Date.now()/1000));
      if (now<=BigInt(issued.validAfter) || now>=BigInt(issued.validBefore) || now>=BigInt(issued.expiresAt)) throw new Error("Issued Monthly authorization expired");
      db.prepare("UPDATE research_purchase_authorizations SET issued_data=json_set(issued_data,'$.submitted',json('true')) WHERE network=? AND asset=? AND payer=? AND authorization_id=?")
        .run(row.network,row.asset,row.payer,row.authorization_id);
    }
    if (ownTransaction) db.exec("COMMIT");
  } catch (error) { if (ownTransaction) db.exec("ROLLBACK"); throw error; }
}
export async function claimSupabaseResearchPurchase(db: SupabaseClient, value: ResearchPurchaseClaim) {
  if (value.sourceClaim) throw new Error("Atomic managed source payment admission is unsupported on Supabase");
  const {row,required}=claimRow(value);
  const { data, error } = await db.rpc("claim_research_purchase", { p_claim: {...row,requireExisting:required} });
  if (error || data !== true) throw new Error("Research authorization claim conflict");
}

export function createSqliteResearchMonthly(db: DatabaseSync, value: MonthlyPurchase, profile: ArcNetworkProfile = ARC_TESTNET_PROFILE) {
  assertSqliteResearchAuthority(db,profile,true);
  const purchase = validateMonthlyPurchase(value,profile);
  db.exec("BEGIN IMMEDIATE");
  try {
    const original = getSqliteResearchMonthly(db, purchase.id,profile);
    if (original) {
      if (!samePurchase(original.purchase, purchase)) throw new Error("Monthly purchase replay conflict");
      db.exec("COMMIT"); return { created: false, purchase: original.purchase };
    }
    if (profile === ARC_MAINNET_PROFILE) {
      const issued = db.prepare("SELECT issued_data FROM research_purchase_authorizations WHERE network=? AND asset=? AND payer=? AND authorization_id=?").get(profile.networkId,profile.usdcAddress.toLowerCase(),purchase.payer.toLowerCase(),purchase.authorizationId.toLowerCase());
      if (!issued?.issued_data || !storedIssuedSchema.parse(parseData(issued.issued_data)).submitted) throw new Error("Submitted original Monthly challenge required");
    }
    claimSqliteResearchPurchase(db, { network: profile.networkId, payer: purchase.payer, payee: purchase.payee, authorizationId: purchase.authorizationId, purpose: "monthly", requestHash: purchase.quoteId, amountMicros: purchase.totalMicros },profile);
    db.prepare("INSERT INTO research_monthly (id,payer,data) VALUES (?,?,?)").run(purchase.id, purchase.payer.toLowerCase(), JSON.stringify(purchase));
    db.exec("COMMIT"); return { created: true, purchase };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
export function getSqliteResearchMonthly(db: DatabaseSync, id: string, profile: ArcNetworkProfile = ARC_TESTNET_PROFILE) {
  assertSqliteResearchAuthority(db,profile);
  monthlyId.parse(id);
  const row = db.prepare("SELECT payer,data FROM research_monthly WHERE id=?").get(id);
  if (!row) return null;
  const purchase = validateMonthlyPurchase(parseData(row.data),profile);
  if (purchase.id !== id || purchase.payer.toLowerCase() !== row.payer) throw new Error("Invalid stored Monthly purchase");
  const redemptions = checkedRedemptions(purchase, db.prepare("SELECT request_id AS requestId,order_id AS orderId,request_hash AS requestHash,created_at AS createdAt,slot FROM research_monthly_redemptions WHERE monthly_id=? ORDER BY slot").all(id));
  return { purchase, redemptions };
}
export function redeemSqliteResearchMonthly(db: DatabaseSync, input: MonthlyRedemptionInput, rowToOrder: (row: Record<string, unknown>) => A2aOrder, profile: ArcNetworkProfile = ARC_TESTNET_PROFILE) {
  assertSqliteResearchAuthority(db,profile,true);
  const key = inputKey(input);
  db.exec("BEGIN IMMEDIATE");
  try {
    const monthly = getSqliteResearchMonthly(db, key.monthlyId,profile);
    if (!monthly) throw new Error("Monthly purchase unavailable");
    assertOrder(monthly.purchase, input,profile);
    const existing = monthly.redemptions.find(value => value.requestId === key.requestId);
    if (existing) {
      const row = db.prepare("SELECT * FROM a2a_orders WHERE id=?").get(existing.orderId);
      if (!row) throw new Error("Monthly order unavailable");
      const order = rowToOrder(row); assertReplay(order, input.order, existing);
      db.exec("COMMIT"); return { created: false, order };
    }
    if (Date.parse(key.now) < Date.parse(monthly.purchase.createdAt) || Date.parse(key.now) >= Date.parse(monthly.purchase.expiresAt)) throw new Error("Monthly term expired");
    if (monthly.redemptions.length >= MONTHLY_REQUEST_LIMIT) throw new Error("Monthly request limit reached");
    if (input.order.createdAt !== key.now) throw new Error("Monthly acceptance time mismatch");
    db.prepare("INSERT INTO research_monthly_redemptions (monthly_id,request_id,order_id,request_hash,created_at,slot) VALUES (?,?,?,?,?,?)")
      .run(key.monthlyId, key.requestId, input.order.id, input.order.requestHash, key.now, monthly.redemptions.length);
    const row = monthlyOrderToRow(input.order), columns = Object.keys(row);
    db.prepare(`INSERT INTO a2a_orders (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
      .run(...Object.values(row).map(value => value !== null && typeof value === "object" ? JSON.stringify(value) : value as string | number | null));
    db.exec("COMMIT"); return { created: true, order: input.order };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export async function createSupabaseResearchMonthly(db: SupabaseClient, value: MonthlyPurchase) {
  const purchase = validateMonthlyPurchase(value);
  const { data, error } = await db.rpc("create_research_monthly", { p_purchase: purchase });
  if (error || !data || typeof data.created !== "boolean") throw new Error("Monthly purchase storage unavailable");
  const stored = validateMonthlyPurchase(data.purchase);
  if (!samePurchase(stored, purchase)) throw new Error("Monthly purchase replay conflict");
  return { created: data.created as boolean, purchase: stored };
}
export async function getSupabaseResearchMonthly(db: SupabaseClient, id: string) {
  monthlyId.parse(id);
  const { data, error } = await db.rpc("get_research_monthly", { p_id: id });
  if (error) throw new Error("Monthly purchase storage unavailable");
  if (data === null) return null;
  const purchase = validateMonthlyPurchase(data?.purchase);
  if (purchase.id !== id || !Array.isArray(data.redemptions)) throw new Error("Invalid stored Monthly purchase");
  return { purchase, redemptions: checkedRedemptions(purchase, data.redemptions) };
}
export async function redeemSupabaseResearchMonthly(db: SupabaseClient, input: MonthlyRedemptionInput, rowToOrder: (row: Record<string, unknown>) => A2aOrder) {
  const key = inputKey(input);
  const monthly = await getSupabaseResearchMonthly(db, key.monthlyId);
  if (!monthly) throw new Error("Monthly purchase unavailable");
  assertOrder(monthly.purchase, input);
  const { data, error } = await db.rpc("redeem_research_monthly", { p_id: key.monthlyId, p_payer: key.payer, p_request_id: key.requestId, p_now: key.now, p_order: monthlyOrderToRow(input.order) });
  if (error || !data || typeof data.created !== "boolean" || !data.order) throw new Error("Monthly redemption rejected");
  const order = rowToOrder(data.order);
  assertReplay(order, input.order, { requestId: key.requestId, orderId: input.order.id, requestHash: input.order.requestHash, createdAt: order.createdAt, slot: 0 });
  return { created: data.created as boolean, order };
}
