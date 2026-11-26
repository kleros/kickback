"use client";

import Link from "next/link";

import { useAccount } from "wagmi";

import { EventsList, listedEvents, type RowStatus } from "@/features/event";
import { PHASE_TONE, phaseOf, useMyEvents } from "@/features/organise";

import { paths } from "@/config/paths";

/**
 * No public or featured events: Kickback is a tool, not a listing, and guests arrive from Luma.
 * A connected wallet sees the events it created, as its own record.
 */
// each row opens the organiser page: its pill follows that page's phase pill. The row does not read each
// challenge, so a late challenge counts as waiting until its latest possible answer time: the pill may show
// "Challenges pending" a little longer than the organiser page, never "Payouts ready" too early
const organiserStatus: RowStatus = (event, now) => {
  const mayWait =
    event.phase === 1 &&
    event.waitingChallenges > 0 &&
    now > event.challengeEndsAt &&
    now <= event.challengeEndsAt + event.matchPeriod;
  const phase = phaseOf(event, now, mayWait ? 1 : 0);
  return { text: phase, tone: PHASE_TONE[phase] };
};

export function HomeEvents() {
  const { address } = useAccount();
  const mine = useMyEvents();
  const rows = address ? listedEvents((mine.data ?? []).map((row) => ({ contract: row.contract }))) : [];
  return (
    <>
      <p className="home-empty">No featured events yet. Guests find each event on Luma.</p>
      {rows.length > 0 && (
        <>
          <h3 className="home-eyebrow home-mine">Events you created</h3>
          <EventsList
            rows={rows}
            hrefOf={(row) => paths.organiseEvent.getHref(row.contract)}
            statusOf={organiserStatus}
          />
          {(mine.data?.length ?? 0) > rows.length && (
            <Link href={paths.organise.getHref()} className="kb-link text-sm">
              See all in Manage your events
            </Link>
          )}
        </>
      )}
    </>
  );
}
