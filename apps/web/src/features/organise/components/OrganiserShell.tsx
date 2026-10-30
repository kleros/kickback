"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import type { Address } from "viem";

import { CopyButton } from "@/components/ui/CopyButton";
import { SegmentedNav } from "@/components/ui/SegmentedNav";
import { ConnectWallet } from "@/components/wallet/ConnectWallet";

import { paths } from "@/config/paths";

import { PhasePill } from "./parts";
import { OrganiserEventContext, useOrganiserEventSource, type OrganiserEvent } from "../hooks/useOrganiserEvent";
import { shortHex } from "../model/view";

/** The tabs keep `?from=`, the block deposits are read from, so no tab searches for the deploy again. */
export const organiserTabs = (address: string, from?: string) => [
  { href: paths.organiseEvent.getHref(address, from), label: "Overview" },
  { href: paths.organiseEvent.getHref(address, from, "guests"), label: "Guests" },
  { href: paths.organiseEvent.getHref(address, from, "attendance"), label: "Attendance" },
  { href: paths.organiseEvent.getHref(address, from, "payout"), label: "Payout" },
];

export function ShellView({
  address,
  pathname,
  from,
  event,
  children,
}: {
  address: Address;
  pathname: string;
  from?: string;
  event: OrganiserEvent;
  children: ReactNode;
}) {
  const data = event.overview.data;
  const tabs = organiserTabs(address, from);
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
            {data && <PhasePill phase={data.phase} />}
          </div>
          <div className="og-head-row">
            <span className="og-addr">
              {shortHex(address)}
              <CopyButton value={address} label="Copy contract address" />
            </span>
          </div>
        </div>
        <div className="og-nav-scroll">
          <SegmentedNav items={tabs} current={current} label="Organiser" />
        </div>
        {event.connected ? null : (
          <div className="og-actions">
            <ConnectWallet text="Connect the organiser's wallet" />
          </div>
        )}
        {event.overview.isError ? (
          <p className="og-err" role="alert" data-testid="read-error">
            {event.overview.error?.message ?? "The network did not answer."} Check the address, or reload to try again.
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
  const from = useSearchParams()?.get("from") ?? undefined;
  const event = useOrganiserEventSource(address, from);
  const pathname = usePathname() ?? `/organise/${address}`;
  return (
    <ShellView address={address} pathname={pathname} from={from} event={event}>
      {children}
    </ShellView>
  );
}
