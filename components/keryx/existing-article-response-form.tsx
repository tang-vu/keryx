"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileCheck2, Loader2, ShieldCheck } from "lucide-react";
import { useAccount, useSignTypedData } from "wagmi";

import { fmtUsdc } from "@/components/keryx/phase-style";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { articleOfferTypedData } from "@/lib/offers/article-offer";

interface ResponseSource {
  sourceId: string;
  sourceName: string;
  creator: `0x${string}`;
  listPriceUsdc: number;
  minPriceUsdc: number;
  article: {
    itemId: string;
    itemTitle: string;
    itemUrl: string;
    contentVersion: string;
    summary: string;
    priceUsdc: number;
    offerId?: string;
    offerExpiresAt?: number;
  };
}

interface ResponseData {
  gap: { id: string; claim: string };
  sources: ResponseSource[];
}

function nonce(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function ExistingArticleResponseForm({ gapId }: { gapId: string }) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { session, authState, signIn } = useSiweAuth();
  const { signTypedDataAsync } = useSignTypedData();
  const [data, setData] = useState<ResponseData | null>(null);
  const [selected, setSelected] = useState("");
  const [price, setPrice] = useState("");
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/wanted/respond?gapId=${encodeURIComponent(gapId)}`, {
        cache: "no-store",
      });
      const next = (await response.json()) as ResponseData & { error?: string };
      if (!response.ok) throw new Error(next.error ?? "Could not load your articles");
      setData(next);
      const first = next.sources[0];
      if (first) {
        setSelected((current) => current || `${first.sourceId}:${first.article.itemId}`);
        setPrice((current) => current || String(first.article.priceUsdc));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your articles");
    } finally {
      setLoading(false);
    }
  }, [gapId, session]);

  useEffect(() => {
    // `load` reaches state updates only after its fetch promise resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const choice = useMemo(
    () => data?.sources.find((source) => `${source.sourceId}:${source.article.itemId}` === selected),
    [data, selected],
  );

  const choose = (value: string) => {
    setSelected(value);
    const next = data?.sources.find((source) => `${source.sourceId}:${source.article.itemId}` === value);
    if (next) setPrice(String(next.article.priceUsdc));
  };

  const respond = async () => {
    if (!choice || working) return;
    setWorking(true);
    setError("");
    setReceipt("");
    try {
      let articleOfferId = choice.article.offerId;
      const priceUsdc6 = Math.round(Number(price) * 1_000_000);
      const listPriceUsdc6 = Math.round(choice.listPriceUsdc * 1_000_000);
      const minPriceUsdc6 = Math.round(choice.minPriceUsdc * 1_000_000);
      if (!Number.isSafeInteger(priceUsdc6) || priceUsdc6 < minPriceUsdc6 || priceUsdc6 > listPriceUsdc6) {
        throw new Error(`Price must be $${fmtUsdc(choice.minPriceUsdc)}–$${fmtUsdc(choice.listPriceUsdc)}.`);
      }

      if (priceUsdc6 < listPriceUsdc6 && priceUsdc6 !== Math.round(choice.article.priceUsdc * 1_000_000)) {
        if (!address || address.toLowerCase() !== choice.creator.toLowerCase()) {
          throw new Error("Connect the registry creator wallet to sign this discount.");
        }
        const expiresAt = Math.floor(Date.now() / 1_000) + 7 * 24 * 60 * 60;
        const offerNonce = nonce();
        const signature = await signTypedDataAsync(articleOfferTypedData({
          sourceId: choice.sourceId,
          itemId: choice.article.itemId,
          contentVersion: choice.article.contentVersion,
          priceUsdc6,
          expiresAt,
          nonce: offerNonce,
        }));
        const offerResponse = await fetch(`/api/creator/${choice.sourceId}/offers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId: choice.article.itemId,
            contentVersion: choice.article.contentVersion,
            priceUsdc6,
            expiresAt,
            nonce: offerNonce,
            signature,
          }),
        });
        const offerResult = (await offerResponse.json()) as { offer?: { id: string }; error?: string };
        if (!offerResponse.ok || !offerResult.offer) {
          throw new Error(offerResult.error ?? "Could not publish the signed article offer");
        }
        articleOfferId = offerResult.offer.id;
      } else if (priceUsdc6 === listPriceUsdc6 && choice.article.offerId) {
        const revokeResponse = await fetch(`/api/creator/${choice.sourceId}/offers`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId: choice.article.itemId }),
        });
        if (!revokeResponse.ok) {
          const revokeResult = (await revokeResponse.json()) as { error?: string };
          throw new Error(revokeResult.error ?? "Could not restore the registry price");
        }
        articleOfferId = undefined;
      }

      const response = await fetch("/api/wanted/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gapId,
          sourceId: choice.sourceId,
          itemId: choice.article.itemId,
          contentVersion: choice.article.contentVersion,
          ...(articleOfferId ? { articleOfferId } : {}),
        }),
      });
      const result = (await response.json()) as { intent?: { id: string }; error?: string };
      if (!response.ok || !result.intent) throw new Error(result.error ?? "Could not queue the response");
      setReceipt(result.intent.id);
      await load();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not offer this article");
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="mt-9 border border-line bg-paper p-5">
      <h2 className="flex items-center gap-2 font-display text-[23px] font-medium text-ink">
        <FileCheck2 className="h-5 w-5 text-seal" /> Already listed? Offer the exact article.
      </h2>
      <p className="mt-2 max-w-[66ch] font-serif text-[14px] leading-relaxed text-ink-2">
        Keryx rechecks your registry authority and public preview, then guarantees this version a
        place in the retry. The agent still decides BUY or SKIP; only grounded, settled evidence fills the claim.
      </p>

      {session === null && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {isConnected ? (
            <button
              type="button"
              onClick={() => void signIn().then(async (result) => {
                if (result.ok) await load();
              })}
              disabled={authState !== "idle"}
              className="border border-ink bg-ink px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-cream disabled:opacity-50"
            >
              Sign in to see your articles
            </button>
          ) : (
            <Link href="/connect" className="border border-ink bg-ink px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-cream">
              Connect creator wallet
            </Link>
          )}
        </div>
      )}

      {session && loading && <Loader2 className="mt-4 h-4 w-4 animate-spin text-seal" />}
      {session && !loading && data?.sources.length === 0 && (
        <p className="mt-4 font-mono text-[10.5px] leading-relaxed text-ink-3">
          None of your active, verified articles passes this claim&apos;s public-preview match yet.
        </p>
      )}
      {choice && (
        <div className="mt-5 border-y border-line py-4">
          <label className="block font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
            Matching article
            <select
              value={selected}
              onChange={(event) => choose(event.target.value)}
              className="mt-2 w-full border border-line bg-paper-2 px-3 py-2.5 font-serif text-[13px] normal-case tracking-normal text-ink"
            >
              {data?.sources.map((source) => (
                <option key={`${source.sourceId}:${source.article.itemId}`} value={`${source.sourceId}:${source.article.itemId}`}>
                  {source.sourceName} — {source.article.itemTitle}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-3 font-mono text-[9.5px] text-ink-3">
            {choice.article.contentVersion.slice(0, 34)}… · registry ceiling ${fmtUsdc(choice.listPriceUsdc)}
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
              Read price
              <span className="mt-1 flex w-36 items-center border border-line bg-paper-2 px-3 py-2">
                $<input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" className="ml-1 min-w-0 flex-1 bg-transparent text-ink outline-none" />
              </span>
            </label>
            <button
              type="button"
              onClick={() => void respond()}
              disabled={working}
              className="inline-flex items-center gap-2 border border-ink bg-seal px-4 py-2.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-cream disabled:opacity-50"
            >
              {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              {Number(price) < choice.listPriceUsdc ? "Sign discount + offer" : "Offer at registry price"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-4 font-mono text-[10.5px] text-destructive">{error}</p>}
      {receipt && (
        <p className="mt-4 border border-paid/40 bg-paid/10 p-3 font-mono text-[10.5px] text-paid">
          Response admitted · {receipt.slice(0, 8)}… · waiting for the bounded autonomous retry.
        </p>
      )}
    </section>
  );
}
