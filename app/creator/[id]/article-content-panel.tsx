"use client";
import { formatNumber, selectPlural } from "@/lib/i18n/format";


import { createMessages } from "@/lib/i18n/messages";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileLock2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAccount, useSignTypedData } from "wagmi";

import { shortAddr } from "@/components/keryx/phase-style";
import { articleContentManifestTypedData } from "@/lib/sources/article-content-manifest-schema";

const uiCopy = createMessages("en");

interface ContentItem {
  itemId: string;
  itemTitle: string;
  itemUrl: string;
  contentVersion: string;
  contentReceipt?: {
    deliveryKind: string;
    storageMode: string;
    plaintextBytes: number;
    manifestId?: string;
  };
}

interface ContentData {
  sourceId: string;
  sourceName: string;
  creator: `0x${string}`;
  active: boolean;
  verified: boolean;
  items: ContentItem[];
}

function randomNonce(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

async function sha256Hex(value: string): Promise<`0x${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function ArticleContentPanel({ creatorId }: { creatorId: string }) {
  const [data, setData] = useState<ContentData | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [content, setContent] = useState("");
  const [working, setWorking] = useState(false);
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/creator/${creatorId}/content`, { cache: "no-store" });
      if (!response.ok) return;
      const next = (await response.json()) as ContentData;
      setData(next);
      setSelectedId((current) =>
        next.items.some((item) => item.itemId === current) ? current : (next.items[0]?.itemId ?? ""),
      );
    } catch {
      // Owner-only enhancement: never disrupt the public profile.
    }
  }, [creatorId]);

  useEffect(() => {
    // `load` reaches its first state update only after the fetch promise resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const selected = useMemo(
    () => data?.items.find((item) => item.itemId === selectedId),
    [data, selectedId],
  );
  if (!data || data.items.length === 0) return null;

  const wrongWallet = !!address && address.toLowerCase() !== data.creator.toLowerCase();
  const bytes = new TextEncoder().encode(content).byteLength;

  const publish = async () => {
    if (!selected || !address || wrongWallet) {
      toast.error(uiCopy("creatorContent.wallet", { wallet: shortAddr(data.creator) }));
      return;
    }
    if (bytes < 200 || bytes > 1_000_000) {
      toast.error(uiCopy("creatorContent.size"));
      return;
    }

    setWorking(true);
    try {
      const bodyHash = await sha256Hex(content);
      const nonce = randomNonce();
      const signature = await signTypedDataAsync(
        articleContentManifestTypedData({
          sourceId: data.sourceId,
          itemId: selected.itemId,
          canonicalUrl: selected.itemUrl,
          bodyHash,
          plaintextBytes: bytes,
          deliveryKind: "full_text",
          nonce,
        }),
      );
      const response = await fetch(`/api/creator/${creatorId}/content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: selected.itemId,
          content,
          bodyHash,
          plaintextBytes: bytes,
          nonce,
          signature,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? uiCopy("creatorContent.failed"));
      toast.success(uiCopy("creatorContent.published"));
      setContent("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : uiCopy("creatorContent.failed"));
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="mb-8 border border-line bg-paper p-5">
      <h2 className="mb-1 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <FileLock2 className="h-3.5 w-3.5 text-seal" /> {uiCopy("creatorContent.title")}
      </h2>
      <p className="mb-4 max-w-2xl font-serif text-[13px] text-ink-2">
        {uiCopy("creatorContent.description")}
      </p>

      <div className="grid gap-3">
        <select
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
          className="w-full border border-line bg-paper-2 px-3 py-2 font-serif text-[13px] text-ink"
        >
          {data.items.map((item) => (
            <option key={item.itemId} value={item.itemId}>
              {item.itemTitle} · {item.contentReceipt?.deliveryKind ?? uiCopy("creatorContent.unverified")}
            </option>
          ))}
        </select>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={10}
          placeholder={uiCopy("creatorContent.placeholder")}
          className="w-full resize-y border border-line bg-paper-2 p-3 font-serif text-[13px] leading-relaxed text-ink outline-none focus:border-seal"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[10px] text-ink-3">
            {selected?.contentReceipt?.manifestId ? uiCopy(selectPlural(bytes) === "one" ? "creatorContent.publishedBytes.one" : "creatorContent.publishedBytes.other", { count: formatNumber(bytes) }) : uiCopy(selectPlural(bytes) === "one" ? "creatorContent.bytes.one" : "creatorContent.bytes.other", { count: formatNumber(bytes) })}
          </p>
          <button
            type="button"
            onClick={() => void publish()}
            disabled={working || wrongWallet || !data.active || !data.verified || !selected}
            className="flex min-w-44 items-center justify-center gap-1.5 border border-ink bg-seal px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-cream disabled:opacity-50"
          >
            {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            {uiCopy("creatorContent.sign")}
          </button>
        </div>
      </div>
      {wrongWallet && (
        <p className="mt-3 font-mono text-[10px] text-amber-700">
          {uiCopy("creatorContent.authority", { wallet: shortAddr(data.creator) })}
        </p>
      )}
    </section>
  );
}
