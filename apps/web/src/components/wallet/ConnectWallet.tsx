"use client";

import { useAppKit, useAppKitState } from "@reown/appkit/react";
import { useAccount, useSwitchChain } from "wagmi";

import { GradientButton } from "@/components/ui/GradientButton";

import { DEFAULT_CHAIN, DEFAULT_CHAIN_ID } from "@/config/chains";

/** Connect, or switch to the app's chain: whichever the wallet needs next. The header shows the address. */
export function ConnectWallet({ text = "Connect" }: { text?: string }) {
  const { address, isConnected, chainId } = useAccount();
  const { open } = useAppKit();
  const { open: isOpen } = useAppKitState();
  const { switchChain, isPending } = useSwitchChain();

  if (isConnected && address) {
    if (chainId !== DEFAULT_CHAIN_ID)
      return (
        <GradientButton
          isPending={isPending}
          glyph={isPending ? "ring" : undefined}
          onPress={() => switchChain({ chainId: DEFAULT_CHAIN_ID })}
        >
          {`Switch to ${DEFAULT_CHAIN.name}`}
        </GradientButton>
      );
    return null;
  }

  return (
    <GradientButton isDisabled={isOpen} onPress={() => open({ view: "Connect" })}>
      {text}
    </GradientButton>
  );
}
