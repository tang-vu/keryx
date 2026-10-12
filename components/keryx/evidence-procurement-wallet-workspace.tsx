"use client";

import { useAccount, useSignMessage } from "wagmi";
import { EvidenceProcurementWorkspace } from "./evidence-procurement-workspace";

/** Reuse the existing connected wallet only for explicit quotation/delivery
 * message signatures. No transaction, network switch, allowance or custody. */
export function EvidenceProcurementWalletWorkspace() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  return <EvidenceProcurementWorkspace signer={address ? {
    address, signMessage: message => signMessageAsync({ account: address, message }),
  } : undefined} />;
}
