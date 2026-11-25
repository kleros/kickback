"use client";

import { useAccount } from "wagmi";

import { shortenAddress } from "@/utils/address";

/** The connected wallet in the header; nothing while disconnected. */
export function WalletChip() {
  const { address, isConnected } = useAccount();
  if (!isConnected || !address) return null;

  return (
    <span className="kb-wallet-chip" title={address} data-testid="wallet-chip">
      <span className="dot" aria-hidden />
      <span className="kb-mono kb-wallet-long">{shortenAddress(address)}</span>
      <span className="kb-mono kb-wallet-short">{address.slice(0, 6)}</span>
    </span>
  );
}
