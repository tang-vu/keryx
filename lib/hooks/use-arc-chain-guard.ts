"use client";

/**
 * useArcChainGuard — returns whether the connected wallet is on the independently
 * compiled deployment network and a function to switch to it.
 *
 * Used to gate SIWE sign-in and grant/fund flows: both require the wallet to
 * be on that chain or payment transactions would land on the wrong network.
 *
 * wagmi's useSwitchChain falls back to wallet_addEthereumChain (EIP-3085) when
 * the wallet doesn't know the chain yet — the selected arcChain definition in
 * lib/chains.ts supplies the RPC + explorer metadata for that prompt.
 */

import { useChainId, useSwitchChain } from "wagmi";
import { arcChain } from "@/lib/chains";

export interface ArcChainGuard {
  isOnArc: boolean;
  isSwitching: boolean;
  switchToArc: () => void;
}

export function useArcChainGuard(): ArcChainGuard {
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();

  const isOnArc = chainId === arcChain.id;

  const switchToArc = () => {
    switchChain({ chainId: arcChain.id });
  };

  return { isOnArc, isSwitching: isPending, switchToArc };
}
