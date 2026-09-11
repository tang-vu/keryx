"use client";

import Link from "next/link";
import { useAccount, useWalletClient } from "wagmi";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { WithdrawalWorkspace } from "./withdrawal-workspace";
import { WithdrawalHistoryPanel } from "./withdrawal-history-panel";
import type { WithdrawPolicy } from "@/lib/gateway/withdraw-protocol";

export function WithdrawalAccount({ limits }: { limits: Omit<WithdrawPolicy, "owner" | "recipient"> | null }) {
  const { session } = useSiweAuth(), { address } = useAccount(), { data: wallet } = useWalletClient();
  if (session === undefined) return <p role="status">Checking sign-in…</p>;
  if (!session) return <Link href="/connect" className="underline">Sign in to manage withdrawals</Link>;
  const owner = session.address.toLowerCase();
  const connected = address?.toLowerCase() === owner && wallet?.account.address.toLowerCase() === owner;
  return <div key={owner} className="space-y-6">
    <WithdrawalHistoryPanel address={owner} />
    {connected && wallet ? <WithdrawalWorkspace address={owner} wallet={wallet} limits={limits} />
      : <div className="space-y-3"><p>Connect the wallet you signed in with to review or sign a withdrawal.</p>
        <Link href="/connect" className="underline">Connect or change account</Link></div>}
  </div>;
}
