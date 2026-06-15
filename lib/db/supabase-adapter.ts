/**
 * Supabase adapter (deploy path). Same interface as the SQLite adapter.
 * Metrics/leaderboard aggregate in JS — fine for hackathon volume, no DB functions needed.
 * Requires the tables in supabase/migrations to exist (service-role key used for writes).
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type {
  DashboardMetrics,
  PaymentRecord,
  QueryRun,
  Source,
  SourceItem,
} from "../types";
import type { CreatorEarnings, KeryxDB } from "./keryx-db";

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
    });
  }

  async listSources(): Promise<Source[]> {
    const { data } = await this.sb.from("sources").select("*").order("created_at");
    return (data ?? []).map(rowToSource);
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
    }));
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
      .select("amount_usdc,source_id,query_id");
    const { count: qCount } = await this.sb
      .from("query_runs")
      .select("*", { count: "exact", head: true });
    const rows = pays ?? [];
    const vol = rows.reduce((s, r) => s + Number(r.amount_usdc), 0);
    const creators = new Set(rows.map((r) => r.source_id)).size;
    const paying = new Set(rows.map((r) => r.query_id)).size;
    const totalQueries = qCount ?? 0;
    return {
      totalPayments: rows.length,
      totalVolumeUsdc: round(vol),
      totalCreatorPayoutsUsdc: round(vol),
      creatorsEarning: creators,
      avgPaymentUsdc: rows.length ? round(vol / rows.length) : 0,
      totalQueries,
      payingQueries: paying,
      readerToPayerConversion: totalQueries ? round(paying / totalQueries) : 0,
    };
  }

  async creatorLeaderboard(): Promise<CreatorEarnings[]> {
    const { data } = await this.sb
      .from("payment_events")
      .select("source_id,source_name,payee,amount_usdc,kind");
    const map = new Map<string, CreatorEarnings>();
    for (const r of data ?? []) {
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
