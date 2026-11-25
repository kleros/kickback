"use client";

import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { useAccount, useDisconnect } from "wagmi";

import { shortenAddress } from "@/utils/address";

/** The connected wallet in the header; tap it to disconnect. Nothing while disconnected. */
export function WalletChip() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  if (!isConnected || !address) return null;

  return (
    <MenuTrigger>
      <Button className="kb-wallet-chip" aria-label={`Wallet ${address}: open menu`} data-testid="wallet-chip">
        <span className="dot" aria-hidden />
        <span className="kb-mono kb-wallet-long">{shortenAddress(address)}</span>
        <span className="kb-mono kb-wallet-short">{address.slice(0, 6)}</span>
        <span className="kb-wallet-caret" aria-hidden>
          ▾
        </span>
      </Button>
      <Popover placement="bottom end" className="kb-wallet-pop">
        <p className="kb-wallet-full kb-mono">{address}</p>
        <Menu className="kb-wallet-menu" aria-label="Wallet">
          <MenuItem className="kb-wallet-item" data-testid="disconnect" onAction={() => disconnect()}>
            Disconnect
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
