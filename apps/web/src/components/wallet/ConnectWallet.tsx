"use client";

import { useState } from "react";

import { useAppKit, useAppKitState } from "@reown/appkit/react";
import { getConnectorClient } from "@wagmi/core";
import { addChain } from "viem/actions";
import { useAccount, useSwitchChain } from "wagmi";

import { GradientButton } from "@/components/ui/GradientButton";

import { isUnknownChain, switchErrorText } from "@/lib/web3/chainErrors";
import { connectWallet } from "@/lib/web3/connect";
import { wagmiConfig } from "@/lib/web3/wagmi";

import { DEFAULT_CHAIN, DEFAULT_CHAIN_ID } from "@/config/chains";

/** Connect, or switch to the app's chain: whichever the wallet needs next. The header shows the address. */
export function ConnectWallet({ text = "Connect wallet", className }: { text?: string; className?: string }) {
  const { address, isConnected, chainId, status } = useAccount();
  const { open } = useAppKit();
  const { open: isOpen } = useAppKitState();
  const { switchChain, switchChainAsync, isPending, error, reset } = useSwitchChain();
  const [addFailed, setAddFailed] = useState(false);

  if (isConnected && address) {
    if (chainId !== DEFAULT_CHAIN_ID) {
      // a WalletConnect wallet that does not know the chain: add it, then switch (injected wallets do this themselves)
      const unknown = !!error && isUnknownChain(error);
      return (
        <>
          <GradientButton
            className={className}
            isPending={isPending}
            glyph={isPending ? "ring" : undefined}
            onPress={() => {
              setAddFailed(false);
              if (unknown) {
                void getConnectorClient(wagmiConfig)
                  .then((client) => addChain(client, { chain: DEFAULT_CHAIN }))
                  .then(() => switchChainAsync({ chainId: DEFAULT_CHAIN_ID }))
                  .then(() => reset())
                  .catch(() => setAddFailed(true));
                return;
              }
              reset();
              switchChain({ chainId: DEFAULT_CHAIN_ID });
            }}
          >
            {unknown ? `Add ${DEFAULT_CHAIN.name} to your wallet` : `Switch to ${DEFAULT_CHAIN.name}`}
          </GradientButton>
          {(addFailed || (error && !unknown)) && (
            <p className="og-err" role="alert">
              {addFailed
                ? `Your wallet did not add ${DEFAULT_CHAIN.name}. Try again.`
                : switchErrorText(error, DEFAULT_CHAIN.name)}
            </p>
          )}
        </>
      );
    }
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
