"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import type { Address } from "viem";

import { CopyButton } from "@/components/ui/CopyButton";
import { SegmentedNav } from "@/components/ui/SegmentedNav";
import { ConnectWallet } from "@/components/wallet/ConnectWallet";

import { EventRefused } from "@/lib/presence";

import { paths } from "@/config/paths";

import { PhasePill } from "./parts";
import { OrganiserEventContext, useOrganiserEventSource, type OrganiserEvent } from "../hooks/useOrganiserEvent";
import { shortHex } from "../model/view";

export const organiserTabs = (address: string) => [
  { href: paths.organiseEvent.getHref(address), label: "Overview" },
  { href: paths.organiseEvent.getHref(address, undefined, "guests"), label: "Guests" },
  { href: paths.organiseEvent.getHref(address, undefined, "attendance"), label: "Attendance" },
  { href: paths.organiseEvent.getHref(address, undefined, "payout"), label: "Payout" },
];

export function ShellView({
  address,
  pathname,
  event,
  children,
}: {
  address: Address;
  pathname: string;
  event: OrganiserEvent;
  children: ReactNode;
}) {
  const data = event.overview.data;
  const tabs = organiserTabs(address);
  const current = tabs.find((tab) => tab.href.split("?")[0] === pathname)?.href ?? tabs[0]!.href;
  // the organiser page is for the organiser's wallet only: anyone else sees nothing of the event
  const locked = !event.restoring && (!event.connected || (!!data && !event.isOwner));
  if (locked)
    return (
      <div className="og-page og-narrow" data-testid="organiser-locked">
        <div className="og-head">
          <Link href={paths.organise.getHref()} className="kb-link text-sm">
            ← Manage your events
          </Link>
        </div>
        <section className="og-card og-locked flex flex-col gap-3">
          <h1 className="og-h2">Only the organiser can open this page</h1>
          {!event.connected ? (
            <>
              <p className="og-note">Connect the wallet that created this event to manage it.</p>
              <div className="og-actions">
                <ConnectWallet text="Connect wallet" />
              </div>
            </>
          ) : (
            <p className="og-note" data-testid="not-owner">
              The connected wallet did not create this event. Switch to the wallet that created it, or open{" "}
              <Link href={paths.organise.getHref()} className="kb-link">
                Manage your events
              </Link>{" "}
              to see the events of this wallet.
            </p>
          )}
        </section>
      </div>
    );
  return (
    <OrganiserEventContext.Provider value={event}>
      <div className="og-page">
        <div className="og-head">
          <Link href={paths.organise.getHref()} className="kb-link text-sm">
            ← Manage your events
          </Link>
          <div className="og-head-row">
            <h1 className="og-title" data-testid="event-name">
              {data?.event.eventName ?? (event.overview.isError ? "Event could not be loaded" : "Loading the event…")}
            </h1>
            {event.phase && <PhasePill phase={event.phase} />}
          </div>
          <div className="og-head-row">
            <span className="og-addr" title="The event's own contract: it holds the deposits. Not a wallet.">
              <span className="og-note mr-1.5 font-sans">Event contract</span>
              {shortHex(address)}
              <CopyButton value={address} label="Copy contract address" />
            </span>
            <Link href={paths.event.getHref(address)} className="kb-link text-sm" target="_blank" rel="noopener">
              Guest page ↗
            </Link>
          </div>
        </div>
        <div className="og-nav-scroll">
          <SegmentedNav items={tabs} current={current} label="Organiser" />
        </div>
        {event.connected && !event.onChain && (
          <div className="og-actions">
            <p className="og-note">Your wallet is on another network.</p>
            <ConnectWallet className="is-quiet" />
          </div>
        )}
        {event.overview.isError ? (
          <p className="og-err" role="alert" data-testid="read-error">
            {event.overview.error instanceof EventRefused ? (
              <>
                This address is not an event on this site. If it is your wallet address, open{" "}
                <Link href={paths.organise.getHref()} className="kb-link">
                  Manage your events
                </Link>{" "}
                and connect that wallet: your events are listed there.
              </>
            ) : (
              "The network did not answer. Reload to try again."
            )}
          </p>
        ) : (
          children
        )}
      </div>
    </OrganiserEventContext.Provider>
  );
}

/** Event head, phase in plain words, and the four tabs under one sliding pill. */
export function OrganiserShell({ address, children }: { address: Address; children: ReactNode }) {
  const event = useOrganiserEventSource(address);
  const pathname = usePathname() ?? `/organise/${address}`;
  return (
    <ShellView address={address} pathname={pathname} event={event}>
      {children}
    </ShellView>
  );
}
