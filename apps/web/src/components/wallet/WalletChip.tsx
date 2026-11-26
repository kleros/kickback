"use client";

import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";

import { shortenAddress } from "@/utils/address";

import { DEFAULT_CHAIN, DEFAULT_CHAIN_ID } from "@/config/chains";

/** The connected wallet in the header; tap it to disconnect. Nothing while disconnected. */
export function WalletChip() {
  const { address, isConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  if (!isConnected || !address) return null;
  const wrongNet = chainId !== DEFAULT_CHAIN_ID;

  return (
    <MenuTrigger>
      <Button
        className="kb-wallet-chip"
        aria-label={wrongNet ? `Wallet ${address} on another network: open menu` : `Wallet ${address}: open menu`}
        data-testid="wallet-chip"
        data-wrong-net={wrongNet || undefined}
      >
        <span className="dot" aria-hidden />
        <span className="kb-mono kb-wallet-long">{shortenAddress(address)}</span>
        <span className="kb-mono kb-wallet-short">{address.slice(0, 6)}</span>
        <span className="kb-wallet-caret" aria-hidden>
          ▾
        </span>
      </Button>
      <Popover placement="bottom end" className="kb-wallet-pop">
        <p className="kb-wallet-full kb-mono">{address}</p>
        {wrongNet && <p className="og-note">Your wallet is on another network.</p>}
        <Menu className="kb-wallet-menu" aria-label="Wallet">
          {wrongNet && (
            <MenuItem
              className="kb-wallet-item"
              data-testid="switch-chain"
              onAction={() => switchChain({ chainId: DEFAULT_CHAIN_ID })}
            >
              {`Switch to ${DEFAULT_CHAIN.name}`}
            </MenuItem>
          )}
          <MenuItem className="kb-wallet-item" data-testid="disconnect" onAction={() => disconnect()}>
            Disconnect
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
