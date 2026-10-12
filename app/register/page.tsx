"use client";

/**
 * Default onboarding verifies publishing control and uses sponsored gas.
 * The explicit wallet-funded query mode keeps the existing permissionless flow.
 * Both use the connected creator wallet and preserve the initiating draft through SIWE.
 */

import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import Link from "next/link";
import { currentArcLabel } from "@/lib/arc-network-display";
import { ShieldCheck, Wallet } from "lucide-react";
import { SiteHeader } from "@/components/keryx/site-header";
import {
  RegisterForm,
  type RegisterPrefill,
} from "@/components/keryx/register-form";
import { BulkImportForm } from "@/components/keryx/bulk-import-form";
import { ClaimOnchainPanel } from "@/components/keryx/claim-onchain-panel";
import { FaucetPanel } from "@/components/keryx/faucet-panel";
import { RegistrationSponsorLink } from "@/components/keryx/registration-sponsor-link";
import { CreatorRegistration } from "@/components/keryx/creator-registration";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";
import { WithdrawEarningsPanel } from "@/components/keryx/withdraw-earnings-panel";
import {
  SourcesList,
  type SourceCardData,
} from "@/components/keryx/sources-list";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { registrationConnectHref, registrationDraft, registrationTarget, type RegistrationDraft } from "@/lib/registration-return";

const uiCopy = createMessages("en");
const uiRichCopy = createRichMessages("en");

export default function RegisterPage() {
  const [restored, setRestored] = useState<{ draft: RegistrationDraft; error: string } | null>(null);
  useEffect(() => {
    try { setRestored({ draft: registrationDraft(new URLSearchParams(window.location.search)), error: "" }); }
    catch (error) { setRestored({ draft: {}, error: error instanceof Error ? error.message : uiCopy("registrationPage.restoreFailed") }); }
  }, []);
  if (restored?.draft.mode === "wallet-funded" && !restored.error) return <WalletFundedRegistrationPage initial={restored.draft} />;
  return <div className="min-h-screen bg-paper"><SiteHeader /><main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
    {restored ? <CreatorRegistration initial={restored.draft} initialError={restored.error} /> : <AuthPlaceholder message={uiCopy("registrationPage.checkingSession")} />}
  </main></div>;
}

function WalletFundedRegistrationPage({ initial }: { initial: RegistrationDraft }) {
  const { address, isConnected, chainId } = useAccount();
  const profile = browserPaymentProfile();
  const { session } = useSiweAuth();
  const [sources, setSources] = useState<SourceCardData[]>([]);
  const [sourcesState, setSourcesState] = useState<"loading" | "ready" | "error">("loading");
  // Pre-fill for claiming a pre-registry source on-chain. The form applies initial values on
  // mount only, so bump the key to re-initialise it with each claim.
  const [prefill, setPrefill] = useState<RegisterPrefill | null>(initial);
  const [formKey, setFormKey] = useState(0);
  // Single source at a time, or a pasted batch of feeds. Claiming a pre-registry source pre-fills
  // the single form, so a claim always snaps back to that tab.
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [draftFeed, setDraftFeed] = useState(initial.rssUrl ?? "");
  const [feedError, setFeedError] = useState("");
  const [draftContextError, setDraftContextError] = useState("");
  const [draftOwner, setDraftOwner] = useState(initial.owner);

  const saveDraft = (draft: RegistrationDraft) => {
    draft = { ...draft, mode: "wallet-funded", chainId: initial.chainId ?? profile.chainId };
    const target = registrationTarget(draft);
    window.history.replaceState(window.history.state, "", target);
    setDraftOwner(draft.owner);
    setDraftContextError("");
    setPrefill(draft);
    setDraftFeed(draft.rssUrl ?? "");
    setFormKey((key) => key + 1);
    setMode("single");
  };

  const prepareFeed = () => {
    try {
      const parsed = new URL(draftFeed.trim());
      if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) throw new Error("Invalid feed URL");
      if (parsed.username || parsed.password) throw new Error("Invalid feed URL");
      const rssUrl = registrationDraft(new URLSearchParams({ rss: parsed.toString() })).rssUrl;
      if (!rssUrl) throw new Error("Invalid feed URL");
      saveDraft({ rssUrl, fetchPrice: prefill?.fetchPrice, ...(rssUrl === prefill?.rssUrl ? { gapId: prefill.gapId, matchedItemLink: prefill.matchedItemLink } : {}), ...(address ? { owner: address.toLowerCase() } : {}) });
      setFeedError("");
    } catch {
      setFeedError(uiCopy("registrationPage.feedUrlInvalid"));
    }
  };

  const loadSources = useCallback(async () => {
    try {
      const res = await fetch("/api/sources", { cache: "no-store" });
      if (!res.ok) throw new Error("Sources unavailable");
      const data = (await res.json()) as { sources: SourceCardData[] };
      if (!Array.isArray(data.sources)) throw new Error("Invalid sources response");
      setSources(data.sources ?? []);
      setSourcesState("ready");
    } catch {
      setSourcesState("error");
    }
  }, []);

  useEffect(() => {
    (async () => {
      await loadSources();
    })();
  }, [loadSources]);

  // Permissionless: any signed-in wallet may list its first source (which then
  // makes it a creator). No creator-role precondition.
  const accountMatches = !!session && !!address && isConnected && session.address.toLowerCase() === address.toLowerCase();
  const ownerMatches = !draftOwner || draftOwner === address?.toLowerCase();
  const networkMatches = chainId === profile.chainId && (initial.chainId === undefined || initial.chainId === profile.chainId);
  const canRegister = accountMatches && ownerMatches && networkMatches && !draftContextError;
  const connectHref = draftContextError ? null : registrationConnectHref({ ...initial, ...prefill, owner: draftOwner ?? address?.toLowerCase(), chainId: initial.chainId ?? profile.chainId, mode: "wallet-funded" });
  const feedOnlyDraft: RegistrationDraft = { rssUrl: prefill?.rssUrl, fetchPrice: prefill?.fetchPrice, gapId: prefill?.gapId, matchedItemLink: prefill?.matchedItemLink, owner: draftOwner ?? address?.toLowerCase(), chainId: initial.chainId ?? profile.chainId, mode: "wallet-funded" };

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
        <header className="mb-9 max-w-2xl">
          <div className="font-mono text-[12px] uppercase tracking-[0.2em] text-seal">
            {uiCopy("registrationPage.eyebrow")}
          </div>
          <h1 className="letterpress mt-2.5 max-w-[16ch] font-display text-[clamp(34px,6vw,68px)] font-medium leading-[0.96] tracking-[-0.01em] text-ink">
            {prefill?.sourceClaimId ? <>{uiRichCopy("registrationPage.claimHeading", { source: <em className="italic text-paid">{uiCopy("registrationPage.sourceEmphasis")}</em> })}</> : <>{uiRichCopy("registrationPage.heading", { toll: <em className="italic text-paid">{uiCopy("registrationPage.tollEmphasis")}</em> })}</>}
          </h1>
          <p className="mt-3 max-w-[54ch] text-[18px] leading-relaxed text-ink-2">
            {uiCopy("registrationPage.introduction", { network: currentArcLabel })}
          </p>
          <p className="mt-3 max-w-[65ch] text-sm leading-relaxed text-ink-2">
            {uiRichCopy("registrationPage.paymentEvents", { sourcesLink: <Link href="/me/sources" className="underline">{uiCopy("registrationPage.mySources")}</Link>, paymentsLink: <Link href="/dashboard" className="underline">{uiCopy("registrationPage.paymentsProof")}</Link> })}
          </p>
          <p className="mt-3 text-sm text-ink-2">{uiRichCopy("registrationPage.claimInvitation", { claimLink: <Link href="/claim-source" className="underline">{uiCopy("registrationPage.claimSource")}</Link> })}</p>
        </header>

        {prefill?.sourceClaimId ? <section className="mb-8 max-w-2xl border border-ink bg-paper-2 p-5"><h2 className="font-display text-xl">{uiCopy("registrationPage.claimTitle")}</h2><p className="mt-2 text-sm text-ink-2">{uiRichCopy("registrationPage.claimReview", { claimLink: <Link href={`/claim-source?claimId=${encodeURIComponent(prefill.sourceClaimId)}`} className="underline">{uiCopy("registrationPage.returnClaim")}</Link> })}</p></section> : <section className="mb-8 max-w-2xl border border-ink bg-paper-2 p-5" aria-labelledby="feed-first-title">
          <h2 id="feed-first-title" className="font-display text-xl text-ink">{uiCopy("registrationPage.feedTitle")}</h2>
          <p className="mt-1 text-sm text-ink-2">{uiCopy("registrationPage.feedPreparation")}</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input type="url" value={draftFeed} onChange={(event) => setDraftFeed(event.target.value)} placeholder="https://your-site.example/feed.xml" aria-label={uiCopy("registrationPage.feedLabel")} className="min-h-11 min-w-0 flex-1 border border-line bg-paper px-3 font-mono text-sm text-ink" />
            <button type="button" onClick={prepareFeed} className="min-h-11 border border-ink bg-ink px-4 font-mono text-xs text-paper">{uiCopy("registrationPage.prepareFeed")}</button>
          </div>
          {feedError && <p role="alert" className="mt-2 text-sm text-seal">{feedError}</p>}
          {prefill?.rssUrl && !feedError && <p className="mt-2 break-all text-sm text-ink-2">{uiCopy("registrationPage.feedReady", { url: prefill.rssUrl })}</p>}
        </section>}

        <div className="grid gap-10 lg:grid-cols-[minmax(0,440px)_1fr]">
          <div className="lg:sticky lg:top-24 lg:self-start">
            {/* Auth gate — show form only when signed in with appropriate role */}
            {session === undefined && (
              <AuthPlaceholder message={uiCopy("registrationPage.checkingSession")} />
            )}

            {session === null && !isConnected && connectHref && (
              <AuthGate
                heading={uiCopy("registrationPage.connectTitle")}
                body={uiCopy("registrationPage.connectBody")}
                cta={uiCopy("registrationPage.connect")}
                href={connectHref}
              />
            )}

            {session === null && isConnected && connectHref && (
              <AuthGate
                heading={uiCopy("registrationPage.signInTitle")}
                body={uiCopy("registrationPage.signInBody")}
                cta={uiCopy("registrationPage.signIn")}
                href={connectHref}
              />
            )}

            {!canRegister && !connectHref && <div role="alert" className="space-y-3 border border-seal p-5 text-sm">
              <p>{draftContextError || uiCopy("registrationPage.draftTooLarge")}</p>
              {!draftContextError && prefill?.rssUrl && registrationConnectHref(feedOnlyDraft) && <button type="button" onClick={() => saveDraft(feedOnlyDraft)} className="underline">{uiCopy("registrationPage.keepFeed")}</button>}
              <p><a href="/register" className="underline">{uiCopy("registrationPage.newDraft")}</a></p>
            </div>}
            {session && !accountMatches && connectHref && <AuthGate heading={uiCopy("registrationPage.payoutTitle")} body={uiCopy("registrationPage.payoutBody")} cta={uiCopy("registrationPage.reviewSignIn")} href={connectHref} />}
            {session && accountMatches && !ownerMatches && <div role="alert" className="border border-line p-5 text-sm">{uiRichCopy("registrationPage.draftWallet", { owner: draftOwner ?? "", restartLink: <a className="underline" href="/register">{uiCopy("registrationPage.restartRegistration")}</a> })}</div>}
            {session && accountMatches && ownerMatches && !networkMatches && connectHref && <AuthGate heading={uiCopy("registrationPage.payoutTitle")} body={`Switch your wallet to ${profile.label} to use this registration draft.`} cta={uiCopy("registrationPage.reviewSignIn")} href={connectHref} />}
            {canRegister && (
              <>
                {/* Show which wallet will be used as the payout address */}
                <div className="mb-4 flex items-center gap-2 border border-line bg-paper-2 px-3 py-2.5">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-paid" />
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                      {uiCopy("registrationPage.payoutLabel")}
                    </p>
                    <p className="truncate font-mono text-[11px] text-ink">
                      {address}
                    </p>
                  </div>
                </div>
                {/* Returning creators: pull accrued citation earnings on-chain (gasless). */}
                {address && <WithdrawEarningsPanel address={address} />}
                {address && <RegistrationSponsorLink wallet={address} claimId={prefill?.sourceClaimId} publisherUrl={prefill?.url} rssUrl={prefill?.rssUrl} name={prefill?.name} fetchPrice={prefill?.fetchPrice} />}
                {/* Sources this wallet listed before the registry existed — one click pre-fills
                    the form below with the source's own feed/URL and price to claim it on-chain. */}
                {!prefill?.sourceClaimId && <ClaimOnchainPanel
                  sources={sources}
                  address={address}
                  onClaim={(s) => {
                    setPrefill({
                      rssUrl: s.rssUrl,
                      // Without a feed the claim goes through the manual fields instead.
                      ...(s.rssUrl
                        ? {}
                        : { name: s.name, url: s.url, description: s.description }),
                      fetchPrice: s.fetchPrice,
                    });
                    setFormKey((k) => k + 1);
                    setMode("single"); // a claim pre-fills the single form
                  }}
                />}
                {/* Registering writes the source to the on-chain registry from the creator's own
                    wallet, so it costs gas. A wallet arriving here empty would dead-end at the
                    signature prompt; the drip is one click and one claim per address. */}
                <div className="mb-4">
                  <FaucetPanel />
                </div>
                {/* One source at a time, or paste a whole list of feeds at once. */}
                {!prefill?.sourceClaimId && <div className="mb-4 flex gap-1 border border-line bg-paper-2 p-1">
                  {(["single", "bulk"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={`flex-1 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${
                        mode === m
                          ? "bg-ink text-cream"
                          : "text-ink-3 hover:text-ink"
                      }`}
                    >
                      {m === "single" ? uiCopy("registrationPage.single") : uiCopy("registrationPage.bulk")}
                    </button>
                  ))}
                </div>}
                {mode === "single" ? (
                  <RegisterForm
                    key={`${formKey}:${session?.address.toLowerCase()}`}
                    onCreated={loadSources}
                    prefillWalletAddress={address}
                    prefill={prefill ?? undefined}
                  />
                ) : (
                  <BulkImportForm onRegistered={loadSources} />
                )}
              </>
            )}
          </div>

          <section>
            <h2 className="mb-4 font-mono text-[12px] uppercase tracking-[0.16em] text-ink-3">{uiCopy("registrationPage.sourcesTitle")}</h2>
            {sourcesState === "loading" && <p role="status" className="text-sm text-ink-3">{uiCopy("registrationPage.sourcesLoading")}</p>}
            {sourcesState === "error" && <p role="status" className="text-sm text-ink-3">{uiRichCopy("registrationPage.sourcesUnavailable", { retryButton: <button type="button" onClick={() => { setSourcesState("loading"); void loadSources(); }} className="underline">{uiCopy("registrationPage.retry")}</button> })}</p>}
            {sourcesState === "ready" && <SourcesList sources={sources} />}
          </section>
        </div>
      </main>
    </div>
  );
}

function AuthPlaceholder({ message }: { message: string }) {
  return (
    <div className="border border-line bg-paper-2 p-7">
      <p className="font-mono text-[12px] text-ink-3">{message}</p>
    </div>
  );
}

function AuthGate({
  heading,
  body,
  cta,
  href,
}: {
  heading: string;
  body: string;
  cta: string;
  href: string;
}) {
  return (
    <div className="border border-ink bg-paper p-7 space-y-5">
      <div className="flex items-start gap-3">
        <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-seal" />
        <div>
          <p className="font-display text-lg font-medium text-ink">{heading}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{body}</p>
        </div>
      </div>
      <Link
        href={href}
        className="flex w-full items-center justify-center gap-2 border border-ink bg-seal px-4 py-3.5 font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-cream transition-all hover:-translate-y-0.5 hover:shadow-[0_5px_0_var(--ink)] active:translate-y-0 active:shadow-none"
      >
        {cta}
      </Link>
    </div>
  );
}
