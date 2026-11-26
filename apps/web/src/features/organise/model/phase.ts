import type { EventInfo } from "@kickback/core";

export type Phase =
  | "Deposits open"
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
  if (now < event.eventStart) return "Deposits open";
  if (now < event.eventEnd) return "Live now";
  return event.attendeeCount > 0 ? "Adding names" : "Attendance due";
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
      "Walk-ins register on Luma, then deposit on the guest page. Once the event has started, you can no longer turn anyone away, so tell a walk-in to deposit only once you know there is room. Then check their deposit on the Guests tab and approve them on Luma. Scan every guest's Luma QR code at the door: only checked-in guests count as attendees.",
    tab: "guests",
    action: "Open Guests",
  },
  "Attendance due": {
    title: "Confirm who came",
    detail:
      "Export the Luma guest list (it includes check-ins and wallets) and load it here. Review who came and confirm the list before the deadline. Only wallet addresses go on the blockchain; names and emails stay in this browser.",
    tab: "attendance",
    action: "Open Attendance",
  },
  "Adding names": {
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
  "Payouts ready": {
    title: "Release payouts",
    detail:
      "The challenge window is over. Release payouts: attendees get their deposit back plus a share of the no-shows' deposits.",
    tab: "payout",
    action: "Open Payout",
  },
  "Payouts released": {
    title: "Send the payouts",
    detail: "Attendees claim their share on the guest page. You can also send it to every wallet yourself.",
    tab: "payout",
    action: "Open Payout",
  },
  Cancelled: {
    title: "Event cancelled",
    detail: "Every guest can withdraw their full deposit on the guest page.",
    tab: null,
    action: null,
    done: true,
  },
  "Past the deadline": {
    title: "Attendance was not confirmed",
    detail:
      "The deadline to confirm who came has passed. Every guest can withdraw their full deposit on the guest page.",
    tab: null,
    action: null,
    done: true,
  },
};
