"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import type { Address } from "viem";

import { Refusal } from "@/components/Refusal";
import { CopyButton } from "@/components/ui/CopyButton";
import { SegmentedNav } from "@/components/ui/SegmentedNav";
import { ConnectWallet } from "@/components/wallet/ConnectWallet";

import { EventRefused } from "@/lib/presence";

import { paths } from "@/config/paths";

import { PhasePill, TxLink } from "./parts";
import {
  isEventAddress,
  OrganiserEventContext,
  useOrganiserEventSource,
  type OrganiserEvent,
} from "../hooks/useOrganiserEvent";
import { shortHex } from "../model/view";

export const organiserTabs = (address: string) => [
  { href: paths.organiseEvent.getHref(address), label: "Overview" },
  { href: paths.organiseEvent.getHref(address, undefined, "guests"), label: "Guests" },
  { href: paths.organiseEvent.getHref(address, undefined, "attendance"), label: "Attendance" },
  { href: paths.organiseEvent.getHref(address, undefined, "payout"), label: "Payout" },
];

/** Whose send holds this wallet's buttons, when this page did not start it. */
const ELSEWHERE_TEXT = {
  other: "A transaction you sent from this wallet for another event",
  create: "The event you are creating from this wallet",
  this: "A transaction you sent from this wallet for this event",
  unknown: "A transaction you sent from this wallet",
} as const;

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
  const back = (
    <div className="og-head">
      <Link href={paths.organise.getHref()} className="kb-link kb-tap text-sm">
        ← Manage your events
      </Link>
    </div>
  );
  // not an event at all: a plain refusal, whatever wallet is connected (no event layout, no Connect prompt)
  const error = event.overview.error;
  const refused = !isEventAddress(address) ? "not-address" : error instanceof EventRefused ? error.reason : null;
  if (refused)
    return (
      <div className="og-page og-narrow" data-testid="organiser-refused">
        {back}
        <Refusal
          reason={refused}
          address={address}
          footer={
            // the wallet hint only for an address with no contract (a wallet); a cut link is told to check it
            refused === "no-contract" ? (
              <p>
                If this is your wallet address, your events are listed under{" "}
                <Link href={paths.organise.getHref()} className="kb-link">
                  Manage your events
                </Link>
                .
              </p>
            ) : refused === "bad-checksum" ? (
              <p>
                Open the event from{" "}
                <Link href={paths.organise.getHref()} className="kb-link">
                  Manage your events
                </Link>{" "}
                or from its Luma page.
              </p>
            ) : refused === "not-address" ? (
              <p>
                Check that you copied the whole link, or open{" "}
                <Link href={paths.organise.getHref()} className="kb-link">
                  Manage your events
                </Link>
                .
              </p>
            ) : (
              <p>
                Your events are listed under{" "}
                <Link href={paths.organise.getHref()} className="kb-link">
                  Manage your events
                </Link>
                .
              </p>
            )
          }
        />
      </div>
    );
  // a saved wallet is still reconnecting, or the owner is not known yet: nothing of the event, no Connect button
  if (event.restoring || (!data && !event.overview.isError))
    return (
      <div className="og-page og-narrow" data-testid="organiser-restoring">
        {back}
        <p className="og-note" role="status">
          Loading…
        </p>
      </div>
    );
  // the organiser page is for the organiser's wallet only: anyone else sees nothing of the event
  const locked = !event.connected || (!!data && !event.isOwner);
  if (!locked && !data)
    return (
      <div className="og-page og-narrow" data-testid="organiser-read-error">
        {back}
        <p className="og-err" role="alert" data-testid="read-error">
          The network did not answer. Reload to try again.
        </p>
      </div>
    );
  if (locked)
    return (
      <div className="og-page og-narrow" data-testid="organiser-locked">
        <div className="og-head">
          <Link href={paths.organise.getHref()} className="kb-link kb-tap text-sm">
            ← Manage your events
          </Link>
        </div>
        <section className="og-card og-locked flex flex-col gap-3">
          <h1 className="og-h2">Only the organiser can open this page</h1>
          {!event.connected ? (
            <>
              <p className="og-note">Connect this event&apos;s organiser wallet to manage it.</p>
              <div className="og-actions">
                <ConnectWallet text="Connect wallet" />
              </div>
            </>
          ) : (
            <p className="og-note" data-testid="not-owner">
              The connected wallet is not this event&apos;s organiser. Switch to the organiser&apos;s wallet, or open{" "}
              <Link href={paths.organise.getHref()} className="kb-link">
                Manage your events
              </Link>{" "}
              to see the events of the connected wallet.
            </p>
          )}
        </section>
      </div>
    );
  return (
    <OrganiserEventContext.Provider value={event}>
      <div className="og-page">
        <div className="og-head">
          <Link href={paths.organise.getHref()} className="kb-link kb-tap text-sm">
            ← Manage your events
          </Link>
          <div className="og-head-row">
            <h1 className="og-title" data-testid="event-name">
              {data?.event.eventName}
            </h1>
            {event.phase && <PhasePill phase={event.phase} event={event.overview.data?.event} />}
          </div>
          <div className="og-head-row">
            <span className="og-addr" title="The event's own contract: it holds the deposits. Not a wallet.">
              <span className="og-note mr-1.5 font-sans">Event contract</span>
              {shortHex(address)}
              <CopyButton value={address} label="Copy contract address" />
            </span>
            <Link href={paths.event.getHref(address)} className="kb-link kb-tap text-sm" target="_blank" rel="noopener">
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
        {event.isOwner && event.earlier && (
          <p className="og-note" role="status" data-testid="earlier-pending">
            A transaction you sent from this wallet is still confirming (<TxLink tx={event.earlier.hash} />
            ). The buttons are locked until it is confirmed.
          </p>
        )}
        {event.isOwner && event.elsewhere && (
          <p className="og-note" role="status" data-testid="elsewhere-pending">
            {event.elsewhere.hash ? (
              <>
                {ELSEWHERE_TEXT[event.elsewhere.where]} is still confirming (<TxLink tx={event.elsewhere.hash} />
                ). The buttons unlock when it is confirmed.
              </>
            ) : (
              "Your wallet has another request open. The buttons unlock when it is done."
            )}
          </p>
        )}
        {children}
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
