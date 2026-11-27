import type { EventInfo } from "@kickback/core";

export type Phase =
  | "Deposits open"
  | "Live now"
  | "Attendance due"
  | "List not closed"
  | "Challenge window"
  | "Challenges pending"
  | "Payouts ready"
  | "Payouts released"
  | "Cancelled"
  | "Past the deadline"
  | "Ended";

/**
 * The event's step in plain words, from the contract's phase and the chain's time. `stillWaiting` counts the
 * challenges still inside their answer time: releasing payouts waits for them.
 */
export function phaseOf(
  event: Pick<
    EventInfo,
    "phase" | "eventStart" | "eventEnd" | "claimDeadline" | "challengeEndsAt" | "attendeeCount" | "stakerCount"
  >,
  now: number,
  stillWaiting = 0,
): Phase {
  if (event.phase === 3) return "Cancelled";
  if (event.phase === 2) return "Payouts released";
  if (event.phase === 1)
    return now <= event.challengeEndsAt
      ? "Challenge window"
      : stillWaiting > 0
        ? "Challenges pending"
        : "Payouts ready";
  if (now > event.claimDeadline) return "Past the deadline";
  // nobody holds a deposit once it ended (none made, or all turned away): nothing to confirm. After the deadline
  // a refund also lowers stakerCount, so an empty event there stays "Past the deadline" (Overview tells which)
  if (now >= event.eventEnd && event.stakerCount === 0) return "Ended";
  if (now < event.eventStart) return "Deposits open";
  if (now < event.eventEnd) return "Live now";
  return event.attendeeCount > 0 ? "List not closed" : "Attendance due";
}

/** Every spot has a deposit (capacity 0 is no limit). */
export const isFull = (e: Pick<EventInfo, "capacity" | "stakerCount">) => e.capacity > 0 && e.stakerCount >= e.capacity;

/** The phase as the pill says it: an open event that is full says so. */
export function phaseLabel(phase: Phase, event: Pick<EventInfo, "capacity" | "stakerCount">): string {
  if (phase === "Ended") return "Ended · no deposits";
  return (phase === "Deposits open" || phase === "Live now") && isFull(event) ? `${phase} · full` : phase;
}

export interface NextStep {
  title: string;
  detail: string;
  /** The tab that does it. */
  tab: "guests" | "attendance" | "payout" | null;
  /** The button label, verb first; null when there is nothing to open. */
  action: string | null;
  /** The event is finished: the card shows a status, not a next step. */
  done?: boolean;
}

export const NEXT_STEP: Record<Phase, NextStep> = {
  "Deposits open": {
    title: "Check who deposited",
    detail: "Set up Luma once, then approve each request that has a deposit.",
    tab: "guests",
    action: "Open Guests",
  },
  "Live now": {
    title: "Check a guest",
    detail:
      "Walk-ins register on Luma, then deposit on the guest page. Once the event has started, you can no longer turn anyone away, so tell a walk-in to deposit only once you know there is room. Then check their deposit on the Guests tab and approve them on Luma. Check every guest in on Luma at the door: only checked-in guests count as attendees.",
    tab: "guests",
    action: "Open Guests",
  },
  "Attendance due": {
    title: "Confirm who came",
    detail:
      "Export the Luma guest list (it includes check-ins and wallets) and load it on the Attendance tab. Review who came and confirm the list before the deadline. Only wallet addresses go on the blockchain; names and emails stay in this browser.",
    tab: "attendance",
    action: "Open Attendance",
  },
  "List not closed": {
    title: "Close the list",
    detail: "Add anyone missing, then close the list. Closing starts the 1-day challenge window.",
    tab: "attendance",
    action: "Open Attendance",
  },
  "Challenge window": {
    title: "Answer challenges",
    detail:
      "Guests left off the list can challenge until the window closes. Add anyone who came. If a guest did not come, send their case to Kleros within 1 day of their challenge, or they will be added.",
    tab: "payout",
    action: "Open Payout",
  },
  "Challenges pending": {
    title: "Answer challenges",
    detail:
      "The challenge window is over, but a challenge is still waiting for an answer. If a guest did not come, send their case to Kleros. If they came, do nothing: they will be added when payouts are released.",
    tab: "payout",
    action: "Open Payout",
  },
  "Payouts ready": {
    title: "Release payouts",
    detail:
      "The challenge window is over. Release payouts: attendees get their deposit back plus a share of the no-shows' deposits.",
    tab: "payout",
    action: "Open Payout",
  },
  "Payouts released": {
    title: "Send the payouts",
    detail:
      "Each attendee can claim their share on the guest page, or you can send every attendee their share yourself.",
    tab: "payout",
    action: "Open Payout",
  },
  Cancelled: {
    title: "Event cancelled",
    detail:
      "Every guest can withdraw their full deposit on the guest page, or you can send the refunds on the Payout tab.",
    tab: null,
    action: null,
    done: true,
  },
  Ended: {
    title: "Event ended",
    detail: "No guest had a deposit when the event ended, so there is nothing to confirm or pay out.",
    tab: null,
    action: null,
    done: true,
  },
  "Past the deadline": {
    title: "Attendance was not confirmed",
    detail:
      "The deadline to confirm who came has passed. Every guest can withdraw their full deposit on the guest page, or you can send the refunds on the Payout tab.",
    tab: null,
    action: null,
    done: true,
  },
};
