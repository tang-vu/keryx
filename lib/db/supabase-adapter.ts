/**
 * Supabase adapter (deploy path). Same interface as the SQLite adapter.
 * Metrics/leaderboard aggregate in JS — fine for hackathon volume, no DB functions needed.
 * Requires the tables in supabase/migrations to exist (service-role key used for writes).
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import type {
  DashboardMetrics,
  PaymentRecord,
  QueryRun,
  Source,
  SourceItem,
} from "../types";
import type { ApiKeyRow, ApiKeyUsage, CreatorEarnings, KeryxDB } from "./keryx-db";

export class SupabaseAdapter implements KeryxDB {
  private sb: SupabaseClient;

  constructor() {
    this.sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
  }

  async init(): Promise<void> {
    /* schema applied via migrations */
  }

  async upsertSource(s: Source): Promise<void> {
    // active defaults to true for offline/DB-direct rows that predate the flag.
    await this.sb.from("sources").upsert({
      id: s.id,
      name: s.name,
      url: s.url,
      description: s.description,
      rss_url: s.rssUrl ?? null,
      wallet_address: s.walletAddress,
      fetch_price: s.fetchPrice,
      tags: s.tags,
      authors: s.authors,
      created_at: s.createdAt,
      ipfs_cid: s.ipfsCid ?? null,
      active: s.active !== false, // treat undefined as true
    });
  }

  async listSources(): Promise<Source[]> {
    // Filter to active=true only — deactivated on-chain sources must not be discovered/cited (H1 fix).
    const { data } = await this.sb
      .from("sources")
      .select("*")
      .eq("active", true)
      .order("created_at");
    return (data ?? []).map(rowToSource);
  }

  async setSourceMeta(id: string, meta: import("./keryx-db").SourceMeta): Promise<void> {
    await this.sb.from("source_meta").upsert({
      id,
      name: meta.name,
      description: meta.description,
      url: meta.url,
      updated_at: new Date().toISOString(),
    });
  }

  async getSourceMeta(id: string): Promise<import("./keryx-db").SourceMeta | null> {
    const { data } = await this.sb
      .from("source_meta")
      .select("name,description,url")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    return {
      name: (data.name as string) ?? "",
      description: (data.description as string) ?? "",
      url: (data.url as string) ?? "",
    };
  }

  async getSource(id: string): Promise<Source | null> {
    const { data } = await this.sb.from("sources").select("*").eq("id", id).maybeSingle();
    return data ? rowToSource(data) : null;
  }

  async addItems(items: SourceItem[]): Promise<void> {
    if (!items.length) return;
    await this.sb.from("source_items").upsert(
      items.map((i) => ({
        id: i.id,
        source_id: i.sourceId,
        title: i.title,
        summary: i.summary,
        content: i.content,
        link: i.link,
        published_at: i.publishedAt ?? null,
        ipfs_cid: i.ipfsCid ?? null,
        item_key_enc: i.itemKeyEnc ?? null,
        item_iv: i.itemIv ?? null,
        item_auth_tag: i.itemAuthTag ?? null,
      })),
    );
  }

  async getItems(sourceId: string): Promise<SourceItem[]> {
    const { data } = await this.sb
      .from("source_items")
      .select("*")
      .eq("source_id", sourceId)
      .order("published_at", { ascending: false });
    return (data ?? []).map((r) => ({
      id: r.id,
      sourceId: r.source_id,
      title: r.title,
      summary: r.summary,
      content: r.content,
      link: r.link,
      publishedAt: r.published_at ?? undefined,
      ipfsCid: r.ipfs_cid ?? undefined,
      itemKeyEnc: r.item_key_enc ?? undefined,
      itemIv: r.item_iv ?? undefined,
      itemAuthTag: r.item_auth_tag ?? undefined,
    }));
  }

  async isCreatorWallet(addr: string): Promise<boolean> {
    // ilike performs case-insensitive comparison in Postgres — avoids LOWER() on
    // the indexed wallet_address column, which would prevent index use.
    const { data } = await this.sb
      .from("sources")
      .select("id")
      .ilike("wallet_address", addr)
      .limit(1)
      .maybeSingle();
    return data !== null;
  }

  async getCached(sourceId: string): Promise<string | null> {
    const { data } = await this.sb
      .from("cache_items")
      .select("text")
      .eq("source_id", sourceId)
      .maybeSingle();
    return data?.text ?? null;
  }

  async setCached(sourceId: string, text: string): Promise<void> {
    await this.sb
      .from("cache_items")
      .upsert({ source_id: sourceId, text, updated_at: new Date().toISOString() });
  }

  async saveQueryRun(run: QueryRun): Promise<void> {
    await this.sb.from("query_runs").upsert({
      id: run.id,
      created_at: run.createdAt,
      question: run.question,
      budget: run.budget,
      engine: run.engine,
      total_spent: run.totalSpent,
      total_to_creators: run.totalToCreators,
      answer: run.answer,
      data: run,
    });
  }

  async getQueryRun(id: string): Promise<QueryRun | null> {
    const { data } = await this.sb.from("query_runs").select("data").eq("id", id).maybeSingle();
    return (data?.data as QueryRun) ?? null;
  }

  async listRecentQueries(limit: number): Promise<QueryRun[]> {
    const { data } = await this.sb
      .from("query_runs")
      .select("data")
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map((r) => r.data as QueryRun);
  }

  async recordPayment(p: PaymentRecord): Promise<void> {
    await this.sb.from("payment_events").insert({
      id: p.id ?? crypto.randomUUID(),
      created_at: p.createdAt,
      kind: p.kind,
      query_id: p.queryId,
      source_id: p.sourceId,
      source_name: p.sourceName,
      payer: p.payer,
      payee: p.payee,
      amount_usdc: p.amountUsdc,
      weight: p.weight ?? null,
      rationale: p.rationale ?? null,
      tx_hash: p.txHash ?? null,
      network: p.network,
      settled: p.settled,
    });
  }

  async listPayments(limit: number): Promise<PaymentRecord[]> {
    const { data } = await this.sb
      .from("payment_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map(rowToPayment);
  }

  async metrics(): Promise<DashboardMetrics> {
    const { data: pays } = await this.sb
      .from("payment_events")
      .select("amount_usdc,source_id,query_id,kind");
    const { count: qCount } = await this.sb
      .from("query_runs")
      .select("*", { count: "exact", head: true });
    const rows = pays ?? [];
    const vol = rows.reduce((s, r) => s + Number(r.amount_usdc), 0);
    // Creator payouts exclude inbound A2A fees (platform revenue, not creator earnings).
    const creatorRows = rows.filter((r) => r.kind !== "inbound");
    const creatorVol = creatorRows.reduce((s, r) => s + Number(r.amount_usdc), 0);
    const creators = new Set(creatorRows.map((r) => r.source_id)).size;
    const paying = new Set(creatorRows.map((r) => r.query_id)).size;
    const totalQueries = qCount ?? 0;
    return {
      totalPayments: rows.length,
      totalVolumeUsdc: round(vol),
      totalCreatorPayoutsUsdc: round(creatorVol),
      creatorsEarning: creators,
      avgPaymentUsdc: rows.length ? round(vol / rows.length) : 0,
      totalQueries,
      payingQueries: paying,
      readerToPayerConversion: totalQueries ? round(paying / totalQueries) : 0,
    };
  }

  async getSyncState(key: string): Promise<string | null> {
    const { data } = await this.sb
      .from("sync_state")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    return data?.value ?? null;
  }

  async setSyncState(key: string, value: string): Promise<void> {
    await this.sb
      .from("sync_state")
      .upsert({ key, value, updated_at: new Date().toISOString() });
  }

  // ── api keys ──

  async mintApiKey(
    wallet: string,
    prefix: string,
    keyHash: string,
    label?: string,
  ): Promise<{ rawKey: string; prefix: string; id: string }> {
    const id = crypto.randomUUID();
    await this.sb.from("api_keys").insert({
      id,
      prefix,
      key_hash: keyHash,
      wallet,
      label: label ?? null,
      created_at: new Date().toISOString(),
    });
    return { rawKey: "", prefix, id };
  }

  async verifyApiKey(
    prefix: string,
    incomingHash: string,
  ): Promise<{ walletAddress: string; keyId: string } | null> {
    const { data } = await this.sb
      .from("api_keys")
      .select("id,key_hash,wallet")
      .eq("prefix", prefix)
      .is("revoked_at", null)
      .maybeSingle();
    if (!data) return null;

    const storedHash = data.key_hash as string;
    if (storedHash.length !== incomingHash.length) return null;
    const match = crypto.timingSafeEqual(
      Buffer.from(storedHash, "hex"),
      Buffer.from(incomingHash, "hex"),
    );
    if (!match) return null;

    // Fire-and-forget last_used_at update.
    void this.sb
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id as string);

    return { walletAddress: data.wallet as string, keyId: data.id as string };
  }

  async listApiKeys(wallet: string): Promise<ApiKeyRow[]> {
    const { data } = await this.sb
      .from("api_keys")
      .select("id,prefix,wallet,label,created_at,last_used_at,revoked_at")
      .eq("wallet", wallet)
      .order("created_at", { ascending: false });
    return (data ?? []).map((r) => ({
      id: r.id as string,
      prefix: r.prefix as string,
      wallet: r.wallet as string,
      label: (r.label as string) ?? null,
      createdAt: r.created_at as string,
      lastUsedAt: (r.last_used_at as string) ?? null,
      revokedAt: (r.revoked_at as string) ?? null,
    }));
  }

  async revokeApiKey(id: string, wallet: string): Promise<void> {
    await this.sb
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("wallet", wallet)
      .is("revoked_at", null);
  }

  async incrementUsage(keyId: string): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    await this.sb.rpc("upsert_api_key_usage", { p_key_id: keyId, p_day: day });
  }

  async getUsage(keyId: string, days = 30): Promise<ApiKeyUsage[]> {
    const { data } = await this.sb
      .from("api_key_usage")
      .select("day,call_count")
      .eq("key_id", keyId)
      .order("day", { ascending: false })
      .limit(days);
    return (data ?? []).map((r) => ({ day: r.day as string, count: r.call_count as number }));
  }

  async creatorLeaderboard(): Promise<CreatorEarnings[]> {
    const { data } = await this.sb
      .from("payment_events")
      .select("source_id,source_name,payee,amount_usdc,kind");
    const map = new Map<string, CreatorEarnings>();
    for (const r of data ?? []) {
      if (r.kind === "inbound") continue;
      const e =
        map.get(r.source_id) ??
        ({
          sourceId: r.source_id,
          sourceName: r.source_name,
          walletAddress: r.payee,
          totalEarnedUsdc: 0,
          paymentCount: 0,
          citationCount: 0,
        } as CreatorEarnings);
      e.totalEarnedUsdc = round(e.totalEarnedUsdc + Number(r.amount_usdc));
      e.paymentCount += 1;
      if (r.kind === "citation") e.citationCount += 1;
      map.set(r.source_id, e);
    }
    return [...map.values()].sort((a, b) => b.totalEarnedUsdc - a.totalEarnedUsdc);
  }
}

function rowToSource(r: Record<string, unknown>): Source {
  return {
    id: r.id as string,
    name: r.name as string,
    url: r.url as string,
    description: r.description as string,
    rssUrl: (r.rss_url as string) ?? undefined,
    walletAddress: r.wallet_address as string,
    fetchPrice: Number(r.fetch_price),
    tags: (r.tags as string[]) ?? [],
    authors: (r.authors as Source["authors"]) ?? [],
    createdAt: r.created_at as string,
    ipfsCid: (r.ipfs_cid as string) ?? undefined,
    // active=null means old row before the column existed — treat as active.
    active: r.active === undefined || r.active === null ? true : Boolean(r.active),
  };
}

function rowToPayment(r: Record<string, unknown>): PaymentRecord {
  return {
    id: r.id as string,
    kind: r.kind as PaymentRecord["kind"],
    queryId: r.query_id as string,
    sourceId: r.source_id as string,
    sourceName: r.source_name as string,
    payer: r.payer as string,
    payee: r.payee as string,
    amountUsdc: Number(r.amount_usdc),
    weight: (r.weight as number) ?? undefined,
    rationale: (r.rationale as string) ?? undefined,
    txHash: (r.tx_hash as string) ?? null,
    network: r.network as string,
    settled: Boolean(r.settled),
    createdAt: r.created_at as string,
  };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
