"use client";

import Link from "next/link";

import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { GlassCard } from "@/components/ui/GlassCard";

import { shortenAddress } from "@/utils/address";

import { useChainTime } from "@/lib/web3/chain-time";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { paths } from "@/config/paths";

import { useEvent, type KickbackEvent } from "../api/useEvent";
import { unitsText } from "../model/depositState";
import type { ListedEvent } from "../model/listing";
import { eventDateText, isShowableTime } from "../model/when";

/** A row's status pill: its words and its colour ("live", "ok", "warn" or "end"). */
export type RowStatus = (event: KickbackEvent, now: number) => { text: string; tone: string };

function EventRow({
  row,
  now,
  hrefOf,
  statusOf,
}: {
  row: ListedEvent;
  now: number | undefined;
  hrefOf?: (row: ListedEvent) => string;
  statusOf?: RowStatus;
}) {
  const event = useEvent(row.contract);
  const href = hrefOf ? hrefOf(row) : paths.event.getHref(row.contract, row.from);
  const data = event.data;
  const status = data && now !== undefined && statusOf ? statusOf(data, now) : null;

  return (
    <li>
      <GlassCard
        interactive
        className="home-event"
        data-testid="home-event"
        data-state={data ? "ready" : event.isError ? "error" : "loading"}
      >
        <Link href={href} className="home-event-link">
          <span className="home-event-main">
            <span className="home-event-name" title={data?.eventName}>
              {data ? data.eventName : event.isError ? shortenAddress(row.contract) : <i className="home-skel w-40" />}
            </span>
            <span className="home-event-when">
              {data ? (
                <time
                  dateTime={
                    isShowableTime(data.eventStart) ? new Date(data.eventStart * 1000).toISOString() : undefined
                  }
                >
                  {eventDateText(data.eventStart, data.clock)}
                </time>
              ) : event.isError ? (
                "Could not load this event"
              ) : (
                <i className="home-skel w-56" />
              )}
            </span>
          </span>
          <span className="home-event-side">
            <span className="home-event-amount kb-num">
              {data ? (
                `${unitsText(data.depositAmount, data.decimals)} ${data.symbol}`
              ) : event.isError ? null : (
                <i className="home-skel w-16" />
              )}
            </span>
            <span className="home-event-meta">
              {status && (
                <span className="home-status" data-status={status.tone}>
                  {status.text}
                </span>
              )}
              {data && (
                <span className="kb-num">
                  {/* cancelled or past the deadline: the count is what guests have not taken back yet */}
                  {data.phase === 3 || (data.phase === 0 && now !== undefined && now > data.claimDeadline)
                    ? data.stakerCount === 0
                      ? "No deposits held"
                      : `${data.stakerCount} ${data.stakerCount === 1 ? "deposit" : "deposits"} not yet withdrawn`
                    : `${data.stakerCount} ${data.stakerCount === 1 ? "deposit" : "deposits"}`}
                </span>
              )}
            </span>
          </span>
        </Link>
      </GlassCard>
    </li>
  );
}

/**
 * A list of events, each row linking to `hrefOf` (the guest page by default), with the pill `statusOf` gives.
 * Renders nothing when empty.
 */
export function EventsList({
  rows,
  hrefOf,
  statusOf,
}: {
  rows: readonly ListedEvent[];
  hrefOf?: (row: ListedEvent) => string;
  statusOf?: RowStatus;
}) {
  const time = useChainTime(DEFAULT_CHAIN_ID);
  const now = time.data?.now;

  if (!rows.length) return null;
  return (
    <ul className="home-events" data-testid="home-events">
      {rows.map((row) => (
        <ErrorBoundary key={row.contract.toLowerCase()} fallback={null}>
          <EventRow row={row} now={now} hrefOf={hrefOf} statusOf={statusOf} />
        </ErrorBoundary>
      ))}
    </ul>
  );
}
