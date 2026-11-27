"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import type { Address } from "viem";
import { useAccount } from "wagmi";

import { ConnectWallet } from "@/components/wallet/ConnectWallet";

import { shortenAddress } from "@/utils/address";

import { useRestoringWallet } from "@/lib/web3/useRestoringWallet";

import { DEFAULT_CHAIN } from "@/config/chains";
import { paths } from "@/config/paths";

import { useMyEvents } from "../hooks/useMyEvents";

/** Every event the connected wallet created, read from the factory: works on any device. */
export function WalletEvents({
  renderEvents,
}: {
  /** The route's list of the events (name, date, deposit, phase), composed from the event feature. */
  renderEvents?: (events: readonly { contract: Address; name: string | null }[]) => ReactNode;
}) {
  const { address } = useAccount();
  const mine = useMyEvents();
  const restoring = useRestoringWallet();
  // no Connect button flashing while a saved wallet reconnects on load; a press keeps the button and its spinner
  if (restoring) return null;
  const events = mine.data ?? [];
  let body: ReactNode;
  if (!address)
    body = (
      <>
        <p className="og-lede">Connect the wallet you created your events with to see them here.</p>
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
    body = <p className="og-note">This wallet does not organise any events on {DEFAULT_CHAIN.name}.</p>;
  else if (renderEvents) body = renderEvents(events);
  else
    body = (
      <ul className="og-events">
        {events.map((row) => (
          <li key={row.contract} className="og-event-row">
            <span title={row.name || row.contract}>{row.name || shortenAddress(row.contract)}</span>
            <Link className="kb-link kb-tap" href={paths.organiseEvent.getHref(row.contract)}>
              Open
            </Link>
          </li>
        ))}
      </ul>
    );
  return (
    <section className="flex flex-col gap-2" data-testid="wallet-events" aria-label="Your events">
      {body}
    </section>
  );
}
