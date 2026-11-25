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
            ← Events
          </Link>
          <div className="og-head-row">
            <h1 className="og-title" data-testid="event-name">
              {data?.event.eventName ?? (event.overview.isError ? "Event not readable" : "Reading the event…")}
            </h1>
            {event.phase && <PhasePill phase={event.phase} />}
          </div>
          <div className="og-head-row">
            <span className="og-addr">
              {shortHex(address)}
              <CopyButton value={address} label="Copy contract address" />
            </span>
            <Link href={paths.event.getHref(address)} className="kb-link text-sm">
              Guest page ↗
            </Link>
          </div>
        </div>
        <div className="og-nav-scroll">
          <SegmentedNav items={tabs} current={current} label="Organiser" />
        </div>
        {event.connected ? (
          data &&
          !event.isOwner && (
            <p className="og-note" data-testid="not-owner">
              The connected wallet is not this event&apos;s organiser ({shortHex(data.event.owner)}). You can read
              everything. Only the organiser can send its actions, except matching a challenge, which anyone can do.
            </p>
          )
        ) : (
          <div className="og-actions">
            <ConnectWallet text="Connect the organiser's wallet" />
          </div>
        )}
        {event.overview.isError ? (
          <p className="og-err" role="alert" data-testid="read-error">
            {event.overview.error instanceof EventRefused
              ? "This address is not an event on this site. If it is your wallet address, open Organise and connect that wallet: your events are listed there."
              : "The network did not answer."}{" "}
            Check the address, or reload to try again.
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
