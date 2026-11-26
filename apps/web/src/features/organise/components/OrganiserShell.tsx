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
  return (
    <OrganiserEventContext.Provider value={event}>
      <div className="og-page">
        <div className="og-head">
          <Link href={paths.organise.getHref()} className="kb-link text-sm">
            ← Your events
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
        {!event.connected ? (
          <div className="og-actions">
            <p className="og-note">Connect the organiser&apos;s wallet to act on this event.</p>
            <ConnectWallet text="Connect wallet" className="is-quiet" />
          </div>
        ) : (
          !event.onChain && (
            <div className="og-actions">
              <p className="og-note">Your wallet is on another network.</p>
              <ConnectWallet className="is-quiet" />
            </div>
          )
        )}
        {event.connected && data && !event.isOwner && (
          <p className="og-note" data-testid="not-owner">
            The connected wallet is not this event&apos;s organiser ({shortHex(data.event.owner)}). You can view
            everything. Only the organiser can turn guests away, confirm the list, add guests or cancel. Anyone can send
            a case to Kleros, release payouts, settle a ruling or send payouts.
          </p>
        )}
        {event.overview.isError ? (
          <p className="og-err" role="alert" data-testid="read-error">
            {event.overview.error instanceof EventRefused
              ? "This address is not an event on this site. If it is your wallet address, open Organise and connect that wallet: your events are listed there."
              : "The network did not answer. Reload to try again."}
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
