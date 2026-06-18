"use client";

/**
 * useArcChainGuard — returns whether the connected wallet is on Arc Testnet
 * (chainId 5042002) and a function to switch to it.
 *
 * Used to gate SIWE sign-in and grant/fund flows: both require the wallet to
 * be on Arc Testnet or payment txs would land on the wrong chain and fail.
 *
 * wagmi's useSwitchChain falls back to wallet_addEthereumChain (EIP-3085) when
 * the wallet doesn't know the chain yet — the arcTestnet defineChain in
 * lib/chains.ts supplies the RPC + explorer metadata for that prompt.
 */

import { useChainId, useSwitchChain } from "wagmi";
import { arcTestnet } from "@/lib/chains";

export interface ArcChainGuard {
  isOnArc: boolean;
  isSwitching: boolean;
  switchToArc: () => void;
}

export function useArcChainGuard(): ArcChainGuard {
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();

  const isOnArc = chainId === arcTestnet.id;

  const switchToArc = () => {
    switchChain({ chainId: arcTestnet.id });
  };

  return { isOnArc, isSwitching: isPending, switchToArc };
}
