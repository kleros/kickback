"use client";

import { useAppKit, useAppKitState } from "@reown/appkit/react";
import { useAccount, useSwitchChain } from "wagmi";

import { GradientButton } from "@/components/ui/GradientButton";

import { connectWallet } from "@/lib/web3/connect";

import { DEFAULT_CHAIN, DEFAULT_CHAIN_ID } from "@/config/chains";

/** Connect, or switch to the app's chain: whichever the wallet needs next. The header shows the address. */
export function ConnectWallet({ text = "Connect", className }: { text?: string; className?: string }) {
  const { address, isConnected, chainId, status } = useAccount();
  const { open } = useAppKit();
  const { open: isOpen } = useAppKitState();
  const { switchChain, isPending } = useSwitchChain();

  if (isConnected && address) {
    if (chainId !== DEFAULT_CHAIN_ID)
      return (
        <GradientButton
          className={className}
          isPending={isPending}
          glyph={isPending ? "ring" : undefined}
          onPress={() => switchChain({ chainId: DEFAULT_CHAIN_ID })}
        >
          {`Switch to ${DEFAULT_CHAIN.name}`}
        </GradientButton>
      );
    return null;
  }

  const connecting = status === "connecting";
  return (
    <GradientButton
      className={className}
      isDisabled={isOpen || connecting || status === "reconnecting"}
      isPending={connecting}
      glyph={connecting ? "ring" : undefined}
      onPress={() => void connectWallet(() => open({ view: "Connect" }))}
    >
      {text}
    </GradientButton>
  );
}
