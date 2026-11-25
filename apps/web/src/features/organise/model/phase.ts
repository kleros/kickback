import type { EventInfo } from "@kickback/core";

export type Phase =
  | "Booking open"
  | "Live now"
  | "Attendance due"
  | "Adding names"
  | "Challenge window"
  | "Payouts ready"
  | "Payouts released"
  | "Cancelled"
  | "Past the deadline";

/** The event's step in plain words, from the contract's phase and the chain's time. */
export function phaseOf(
  event: Pick<EventInfo, "phase" | "eventStart" | "eventEnd" | "claimDeadline" | "challengeEndsAt" | "attendeeCount">,
  now: number,
): Phase {
  if (event.phase === 3) return "Cancelled";
  if (event.phase === 2) return "Payouts released";
  if (event.phase === 1) return now <= event.challengeEndsAt ? "Challenge window" : "Payouts ready";
  if (now > event.claimDeadline) return "Past the deadline";
  if (now < event.eventStart) return "Booking open";
  if (now < event.eventEnd) return "Live now";
  return event.attendeeCount > 0 ? "Adding names" : "Attendance due";
}

export interface NextStep {
  title: string;
  detail: string;
  /** The tab that does it. */
  tab: "guests" | "attendance" | "payout" | null;
}

export const NEXT_STEP: Record<Phase, NextStep> = {
  "Booking open": {
    title: "Check who booked",
    detail: "Set up Luma once, then approve each request that has a deposit.",
    tab: "guests",
  },
  "Live now": {
    title: "Check a guest",
    detail:
      "Walk-ins register on Luma and deposit, then you check them here and approve them on Luma. Scan every guest's Luma QR at the door: only checked-in guests count as came.",
    tab: "guests",
  },
  "Attendance due": {
    title: "Confirm who came",
    detail:
      "Export the Luma guest list (it has check-ins and wallets) and load it here. Review who came and confirm it before the deadline. It is recorded on the blockchain, not published anywhere else.",
    tab: "attendance",
  },
  "Adding names": {
    title: "Close the list",
    detail: "Add anyone missing, then close the list. Closing starts the 1-day challenge window.",
    tab: "attendance",
  },
  "Challenge window": {
    title: "Answer challenges",
    detail:
      "Guests left off the list can challenge. You have 1 day to add them, or send the challenge to Kleros if they did not come.",
    tab: "payout",
  },
  "Payouts ready": {
    title: "Release payouts",
    detail: "The challenge window is over. Release the pool: attendees get their deposit back plus a share.",
    tab: "payout",
  },
  "Payouts released": {
    title: "Send the payouts",
    detail: "Attendees claim their share on the event page. You can also send it to every wallet yourself.",
    tab: "payout",
  },
  Cancelled: {
    title: "Event cancelled",
    detail: "Every guest can withdraw their full deposit on the event page.",
    tab: null,
  },
  "Past the deadline": {
    title: "No list was posted",
    detail: "The deadline for the attendance list has passed. Guests can withdraw their full deposit.",
    tab: null,
  },
};
