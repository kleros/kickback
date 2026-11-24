"use client";

import Link from "next/link";

import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { GlassCard } from "@/components/ui/GlassCard";

import { shortenAddress } from "@/utils/address";

import { useChainTime } from "@/lib/web3/chain-time";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { paths } from "@/config/paths";

import { useEvent } from "../api/useEvent";
import { unitsText } from "../model/depositState";
import { eventStatus, STATUS_TEXT, type ListedEvent } from "../model/listing";
import { eventDateText, isShowableTime } from "../model/when";

function EventRow({ row, now }: { row: ListedEvent; now: number | undefined }) {
  const event = useEvent(row.contract);
  const href = paths.event.getHref(row.contract, row.from);
  const data = event.data;
  const status = data && now !== undefined ? eventStatus(data.phase, data.eventEnd, data.claimDeadline, now) : null;

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
                "Not available on this network"
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
              {row.mine && <span className="kb-chip">Yours</span>}
              {status && (
                <span className="home-status" data-status={status}>
                  {STATUS_TEXT[status]}
                </span>
              )}
              {data && <span className="kb-num">{data.stakerCount} booked</span>}
            </span>
          </span>
        </Link>
      </GlassCard>
    </li>
  );
}

/** The factory's newest events and the ones created from this browser. */
export function EventsList({ rows }: { rows: readonly ListedEvent[] }) {
  const time = useChainTime(DEFAULT_CHAIN_ID);
  const now = time.data?.now;

  if (!rows.length)
    return <p className="home-empty">No featured events yet. Guests open an event from its own link.</p>;
  return (
    <ul className="home-events" data-testid="home-events">
      {rows.map((row) => (
        <ErrorBoundary key={row.contract.toLowerCase()} fallback={null}>
          <EventRow row={row} now={now} />
        </ErrorBoundary>
      ))}
    </ul>
  );
}
