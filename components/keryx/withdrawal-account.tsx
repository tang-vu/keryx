"use client";

import Link from "next/link";
import { useAccount, useWalletClient } from "wagmi";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { WithdrawalWorkspace } from "./withdrawal-workspace";
import { WithdrawalHistoryPanel } from "./withdrawal-history-panel";
import type { WithdrawPolicy } from "@/lib/gateway/withdraw-protocol";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";
import { CreatorOwnerWithdrawalPanel } from "./creator-owner-withdrawal-panel";
import { createMessages } from "@/lib/i18n/messages";

const copy = createMessages("en");


export function WithdrawalAccount({ limits }: { limits: Omit<WithdrawPolicy, "owner" | "recipient"> | null }) {
  const { session } = useSiweAuth(), { address } = useAccount(), { data: wallet } = useWalletClient();
  if (session === undefined) return <p role="status">{copy("withdrawalAccount.checkingSignIn")}</p>;
  if (!session) return <Link href="/connect" className="underline">{copy("withdrawalAccount.signIn")}</Link>;
  const owner = session.address.toLowerCase();
  const connected = address?.toLowerCase() === owner && wallet?.account.address.toLowerCase() === owner;
  return <div key={owner} className="space-y-6">
    <WithdrawalHistoryPanel address={owner} />
    {connected && wallet ? browserPaymentProfile().testnet ? <WithdrawalWorkspace address={owner} wallet={wallet} limits={limits} /> : <CreatorOwnerWithdrawalPanel address={owner}/>
      : <div className="space-y-3"><p>{copy("withdrawalAccount.connectInstruction")}</p>
        <Link href="/connect" className="underline">{copy("withdrawalAccount.connect")}</Link></div>}
  </div>;
}
