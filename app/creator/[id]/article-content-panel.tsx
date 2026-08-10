"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileLock2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAccount, useSignTypedData } from "wagmi";

import { shortAddr } from "@/components/keryx/phase-style";
import { articleContentManifestTypedData } from "@/lib/sources/article-content-manifest-schema";

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
      toast.error(`Connect the creator wallet ${shortAddr(data.creator)}.`);
      return;
    }
    if (bytes < 200 || bytes > 1_000_000) {
      toast.error("Full text must be between 200 bytes and 1 MB.");
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
      if (!response.ok) throw new Error(result.error ?? "Could not publish full text");
      toast.success("Signed full text encrypted and pinned to IPFS.");
      setContent("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not publish full text");
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="mb-8 border border-line bg-paper p-5">
      <h2 className="mb-1 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <FileLock2 className="h-3.5 w-3.5 text-seal" /> Signed full-text vault
      </h2>
      <p className="mb-4 max-w-2xl font-serif text-[13px] text-ink-2">
        Attach the complete article to its RSS entry. Your wallet signs the body hash; Keryx stores
        only encrypted ciphertext on public IPFS and reveals plaintext after payment settles.
      </p>

      <div className="grid gap-3">
        <select
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
          className="w-full border border-line bg-paper-2 px-3 py-2 font-serif text-[13px] text-ink"
        >
          {data.items.map((item) => (
            <option key={item.itemId} value={item.itemId}>
              {item.itemTitle} · {item.contentReceipt?.deliveryKind ?? "unverified"}
            </option>
          ))}
        </select>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={10}
          placeholder="Paste the complete article body here…"
          className="w-full resize-y border border-line bg-paper-2 p-3 font-serif text-[13px] leading-relaxed text-ink outline-none focus:border-seal"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[10px] text-ink-3">
            {bytes.toLocaleString()} bytes
            {selected?.contentReceipt?.manifestId ? " · signed full text already published" : ""}
          </p>
          <button
            type="button"
            onClick={() => void publish()}
            disabled={working || wrongWallet || !data.active || !data.verified || !selected}
            className="flex min-w-44 items-center justify-center gap-1.5 border border-ink bg-seal px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-cream disabled:opacity-50"
          >
            {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            Sign &amp; encrypt
          </button>
        </div>
      </div>
      {wrongWallet && (
        <p className="mt-3 font-mono text-[10px] text-amber-700">
          Content authority is {shortAddr(data.creator)}. Switch the connected wallet to sign.
        </p>
      )}
    </section>
  );
}
