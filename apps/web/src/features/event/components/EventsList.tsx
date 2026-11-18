"use client";

import Link from "next/link";

import { GlassCard } from "@/components/ui/GlassCard";

import { shortenAddress } from "@/utils/address";

import { useChainTime } from "@/lib/web3/chain-time";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { paths } from "@/config/paths";

import { useEvent } from "../api/useEvent";
import { ethText } from "../model/depositState";
import { eventStatus, STATUS_TEXT, type ListedEvent } from "../model/listing";
import { eventDateText } from "../model/when";

function EventRow({ row, now }: { row: ListedEvent; now: number | undefined }) {
  const event = useEvent(row.contract);
  const href = paths.event.getHref(row.contract, row.from);
  const data = event.data;
  const status = data && now !== undefined ? eventStatus(data.phase, data.eventStart, data.claimDeadline, now) : null;

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
                <time dateTime={new Date(data.eventStart * 1000).toISOString()}>
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
              {data ? `${ethText(data.depositAmount)} ETH` : event.isError ? null : <i className="home-skel w-16" />}
            </span>
            <span className="home-event-meta">
              {row.mine && <span className="kb-chip">Yours</span>}
              {status && (
                <span className="home-status" data-status={status}>
                  {STATUS_TEXT[status]}
                </span>
              )}
              {data && <span className="kb-num">{data.stakerCount} registered</span>}
            </span>
          </span>
        </Link>
      </GlassCard>
    </li>
  );
}

/** The chain's featured events and the ones created from this browser; there is no on-chain index of all events. */
export function EventsList({ rows }: { rows: readonly ListedEvent[] }) {
  const time = useChainTime(DEFAULT_CHAIN_ID);
  const now = time.data?.now;

  if (!rows.length) return <p className="home-empty">No events on this network yet.</p>;
  return (
    <ul className="home-events" data-testid="home-events">
      {rows.map((row) => (
        <EventRow key={row.contract.toLowerCase()} row={row} now={now} />
      ))}
    </ul>
  );
}
