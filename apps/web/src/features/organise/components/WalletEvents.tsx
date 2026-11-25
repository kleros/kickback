"use client";

import Link from "next/link";

import { shortenAddress } from "@/utils/address";

import { paths } from "@/config/paths";

import { useMyEvents } from "../hooks/useMyEvents";

/** Every event the connected wallet created, read from the factory: works on any device. */
export function WalletEvents() {
  const mine = useMyEvents();
  const events = mine.data ? [...mine.data].reverse() : [];
  if (!events.length) return null;
  return (
    <section className="flex flex-col gap-2" data-testid="wallet-events">
      <h2 className="og-h2">Your events</h2>
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
    </section>
  );
}
