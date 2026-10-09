"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { creatorRegistrationCopy as copy } from "@/locales/en/creator-registration";

/** The ordinary registration flow stays available while sponsorship is disabled. */
export function RegistrationSponsorLink({ claimId, wallet }: { claimId?: string; wallet: string }) {
  const [result, setResult] = useState<{ wallet: string; available: boolean } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/sources/sponsor", { signal: controller.signal, cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(value => { if (!controller.signal.aborted) setResult({ wallet, available: value?.available === true }); }).catch(() => {});
    return () => controller.abort();
  }, [wallet]);
  if (result?.wallet !== wallet || !result.available) return null;
  return <section className="mb-4 border border-paid/30 bg-paper-2 p-4">
    <h2 className="font-display text-xl">{copy.invitationHeading}</h2>
    <p className="mt-2 text-sm text-ink-2">{copy.invitationExplanation}</p>
    <Link className="mt-3 inline-block text-sm underline" href={`/register/sponsored${claimId ? `?claimId=${encodeURIComponent(claimId)}` : ""}`}>{copy.sponsoredRegistrationLink}</Link>
  </section>;
}
