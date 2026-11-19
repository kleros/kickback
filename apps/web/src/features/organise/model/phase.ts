import type { EventInfo } from "@kickback/core";

export type Phase =
  | "Booking open"
  | "Attendance due"
  | "Adding names"
  | "Challenge window"
  | "Payouts ready"
  | "Paid out"
  | "Cancelled"
  | "Past the deadline";

/** The event's step in plain words, from the contract's phase and the chain's time. */
export function phaseOf(
  event: Pick<EventInfo, "phase" | "eventEnd" | "claimDeadline" | "challengeEndsAt" | "attendeeCount">,
  now: number,
): Phase {
  if (event.phase === 3) return "Cancelled";
  if (event.phase === 2) return "Paid out";
  if (event.phase === 1) return now <= event.challengeEndsAt ? "Challenge window" : "Payouts ready";
  if (now > event.claimDeadline) return "Past the deadline";
  if (now < event.eventEnd) return "Booking open";
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
    detail: "Guests are in as soon as they deposit. Turn away anyone who should not come: they get a full refund.",
    tab: "guests",
  },
  "Attendance due": {
    title: "Post the attendance list",
    detail: "Load the check-in CSV, review who came, and post the list before the deadline.",
    tab: "attendance",
  },
  "Adding names": {
    title: "Close the list",
    detail: "Add any missing names, then close the list. Closing starts the challenge window.",
    tab: "attendance",
  },
  "Challenge window": {
    title: "Answer challenges",
    detail: "Guests left off the list can challenge. Match a challenge you disagree with and Kleros decides.",
    tab: "payout",
  },
  "Payouts ready": {
    title: "Release payouts",
    detail: "The challenge window is over. Release the pool: attendees get their deposit back plus a share.",
    tab: "payout",
  },
  "Paid out": {
    title: "Send the payouts",
    detail: "Attendees can withdraw on the event page, or you can push their share to every wallet.",
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
