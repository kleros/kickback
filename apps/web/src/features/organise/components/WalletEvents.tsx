"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useAccount } from "wagmi";

import { ConnectWallet } from "@/components/wallet/ConnectWallet";

import { shortenAddress } from "@/utils/address";

import { DEFAULT_CHAIN } from "@/config/chains";
import { paths } from "@/config/paths";

import { useMyEvents } from "../hooks/useMyEvents";

/** Every event the connected wallet created, read from the factory: works on any device. */
export function WalletEvents() {
  const { address, status } = useAccount();
  const mine = useMyEvents();
  // no Connect button flashing while the wallet reconnects on load
  if (status === "connecting" || status === "reconnecting") return null;
  const events = mine.data ?? [];
  let body: ReactNode;
  if (!address)
    body = (
      <>
        <p className="og-note">Connect the wallet you created your events with to see them here.</p>
        <div className="og-actions">
          <ConnectWallet text="Connect wallet" />
        </div>
      </>
    );
  else if (mine.isError)
    body = (
      <p className="og-err" role="alert">
        Your events could not be loaded. Reload the page to try again.
      </p>
    );
  else if (mine.isLoading)
    body = (
      <p className="og-note" aria-live="polite">
        Loading your events…
      </p>
    );
  // query disabled (no protocol on this chain): nothing to list
  else if (!mine.data) return null;
  else if (!events.length)
    body = <p className="og-note">This wallet has not created any events on {DEFAULT_CHAIN.name}.</p>;
  else
    body = (
      <ul className="og-events">
        {events.map((row) => (
          <li key={row.contract} className="og-event-row">
            <span>{row.name || shortenAddress(row.contract)}</span>
            <Link className="kb-link" href={paths.organiseEvent.getHref(row.contract)}>
              Open
            </Link>
          </li>
        ))}
      </ul>
    );
  return (
    <section className="flex flex-col gap-2" data-testid="wallet-events">
      <h2 className="og-h2">Your events</h2>
      {body}
    </section>
  );
}
