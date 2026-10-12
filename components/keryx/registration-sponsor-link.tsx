"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { creatorRegistrationCopy as copy } from "@/locales/en/creator-registration";

/** The ordinary registration flow stays available while sponsorship is disabled. */
export function RegistrationSponsorLink({ claimId, wallet, publisherUrl }: { claimId?: string; wallet: string; publisherUrl?: string }) {
  const [result, setResult] = useState<{ wallet: string; available: boolean; publisherOrigins?: string[] } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/sources/sponsor", { signal: controller.signal, cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(value => { if (!controller.signal.aborted) setResult({ wallet, available: value?.available === true,
        ...(Array.isArray(value?.publisherOrigins) && value.publisherOrigins.every((origin: unknown) => typeof origin === "string") ? { publisherOrigins: value.publisherOrigins } : {}) }); }).catch(() => {});
    return () => controller.abort();
  }, [wallet]);
  if (result?.wallet !== wallet || !result.available) return null;
  if (publisherUrl && result.publisherOrigins?.length) {
    try { if (!result.publisherOrigins.includes(new URL(publisherUrl).origin)) return null; }
    catch { return null; }
  }
  return <section className="mb-4 border border-paid/30 bg-paper-2 p-4">
    <h2 className="font-display text-xl">{copy.invitationHeading}</h2>
    <p className="mt-2 text-sm text-ink-2">{copy.invitationExplanation}</p>
    {!!result.publisherOrigins?.length && <p className="mt-2 text-sm text-ink-2">{copy.publisherScope({ publishers: result.publisherOrigins.join(", ") })}</p>}
    <Link className="mt-3 inline-block text-sm underline" href={`/register/sponsored${claimId ? `?claimId=${encodeURIComponent(claimId)}` : ""}`}>{copy.sponsoredRegistrationLink}</Link>
  </section>;
}
