"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";
import { CIRCLE_GOOGLE_CONNECTOR_ID } from "@/lib/circle-wallet-config";
import { walletWorkspaceMessages as copy } from "@/locales/en/wallet-workspace";
import { CircleGoogleWalletButton } from "./circle-google-wallet";
import { SessionGrantPanel } from "./session-grant-panel";
import { FaucetPanel } from "./faucet-panel";
import { ArcCardOnrampPanel } from "./arc-card-onramp-panel";

function ReceivingWallet({ address }: { address: string }) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const profile = browserPaymentProfile();
  return <section id="add-money" className="scroll-mt-6 space-y-4 border border-line bg-paper-2 p-4 sm:p-6">
    <div>
      <h2 className="font-display text-2xl">{copy.addMoney}</h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-2">{copy.addMoneyDescription}</p>
    </div>
    <div className="space-y-3 border border-line bg-paper p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{copy.address}</h3>
        <span className="border border-paid/30 px-2 py-1 font-mono text-xs text-paid">{profile.label}</span>
      </div>
      <p className="break-all font-mono text-sm select-all">{address}</p>
      <button type="button" className="min-h-11 border border-ink px-4 text-sm hover:bg-paper-2" onClick={async () => {
        try { await navigator.clipboard.writeText(address); setFeedback(copy.copied); }
        catch { setFeedback(copy.copyFailed); }
      }}>{copy.copyAddress}</button>
      {feedback && <p role="status" className="text-sm text-ink-2">{feedback}</p>}
      <p className="text-xs leading-relaxed text-ink-3">{copy.receiveNotice}</p>
    </div>
    <FaucetPanel />
    {!profile.testnet && <details className="border-t border-line pt-3">
      <summary className="min-h-11 cursor-pointer py-3 text-sm underline underline-offset-4">{copy.bankOptions}</summary>
      <ArcCardOnrampPanel />
    </details>}
  </section>;
}

export function WalletWorkspace() {
  const { address, isConnected, session, refresh } = useSiweAuth();
  const { connector } = useAccount();
  if (session === undefined) return <p role="status" className="text-sm text-ink-2">{copy.loading}</p>;
  if (!session) return <section className="space-y-4 border border-line bg-paper-2 p-6">
    <h2 className="font-display text-2xl">{copy.signInTitle}</h2>
    <p className="text-sm leading-relaxed text-ink-2">{copy.signInDescription}</p>
    <CircleGoogleWalletButton onConnected={() => { void refresh(); }} />
    <Link href="/connect" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">{copy.otherWallet}</Link>
  </section>;
  if (!isConnected || address?.toLowerCase() !== session.address.toLowerCase()) return <section className="space-y-3 border border-line p-6">
    <h2 className="font-display text-2xl">{copy.reconnectTitle}</h2>
    <p className="text-sm text-ink-2">{copy.reconnectDescription}</p>
    <Link href="/connect" className="inline-flex min-h-11 items-center border border-ink px-4 text-sm">{copy.reconnect}</Link>
  </section>;
  return <div className="space-y-6">
    <nav aria-label={copy.walletAndBudget} className="flex flex-wrap gap-2">
      {[["#add-money", copy.addMoney], ["#agent-budget", copy.budget], ...(!browserPaymentProfile().testnet ? [["#withdraw", copy.withdraw]] : [])].map(([href, label]) =>
        <a key={href} href={href} className="inline-flex min-h-11 items-center border border-ink/20 bg-paper-2 px-4 text-sm hover:border-ink">{label}</a>)}
    </nav>
    <ReceivingWallet key={session.address.toLowerCase()} address={session.address} />
    <SessionGrantPanel variant="wallet" />
    <details className="border-t border-line pt-3">
      <summary className="min-h-11 cursor-pointer py-3 text-sm underline underline-offset-4">{copy.keysAndRecovery}</summary>
      <div className="space-y-3 text-sm leading-relaxed text-ink-2">
        <p>{connector?.id === CIRCLE_GOOGLE_CONNECTOR_ID ? copy.googleKeys : copy.externalKeys}</p>
        <p>{copy.browserRecovery}</p>
      </div>
    </details>
  </div>;
}
