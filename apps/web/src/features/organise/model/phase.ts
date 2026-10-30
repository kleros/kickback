import { eventClock, renderCase, type EventInfo } from "@kickback/core";

import { gate, type Gate } from "./shared";

export type Phase =
  | "Deposits open"
  | "Waiting for the event"
  | "Attendance due"
  | "List posted"
  | "Payouts ready"
  | "Paid out"
  | "Cancelled"
  | "Past the deadline";

export interface OverviewFacts {
  deposits: number;
  registered: number;
  attendees: number;
  openChallenges: number;
  challengeEndsAt: number;
  spare: bigint;
  release: Gate;
}

export function eventDeadline(at: number, clock: { offset: number; zone: string }) {
  return {
    at,
    text: `${new Date((at + clock.offset * 60) * 1000).toISOString().slice(0, 16).replace("T", " ")} ${clock.zone}`,
  };
}

export function overviewModel(event: EventInfo, now: number, facts: OverviewFacts) {
  const clock = eventClock(renderCase(event.metaEvidenceTemplate, event.owner, event.contract), event.eventStart) ?? {
    offset: 0,
    zone: "UTC",
  };
  const deadlines = {
    depositsClose: eventDeadline(event.eventStart, clock),
    attendanceDue: eventDeadline(event.claimDeadline, clock),
    challengeEnds: facts.challengeEndsAt ? eventDeadline(facts.challengeEndsAt, clock) : null,
  };
  let phase: Phase;
  if (event.phase === 3) phase = "Cancelled";
  else if (event.phase === 2) phase = "Paid out";
  else if (event.phase === 1) phase = facts.release.enabled ? "Payouts ready" : "List posted";
  else if (event.phase !== 0) throw new Error("Unknown event phase. Refresh before continuing.");
  else if (now > event.claimDeadline) phase = "Past the deadline";
  else if (now >= event.eventStart) phase = "Attendance due";
  else phase = facts.deposits > facts.registered ? "Deposits open" : "Waiting for the event";
  const base = `/organise/${event.contract}`;
  const steps: Record<
    Phase,
    { title: string; detail: string; actionRoute: string | null; lockedReason: string | null }
  > = {
    "Deposits open": {
      title: "Check the guests",
      detail: "Check the Luma list and register approved deposits.",
      actionRoute: `${base}/guests`,
      lockedReason: null,
    },
    "Waiting for the event": {
      title: "Wait for the event",
      detail: "Deposits stay open until the event starts.",
      actionRoute: `${base}/attendance`,
      lockedReason: `Posting unlocks ${deadlines.depositsClose.text}.`,
    },
    "Attendance due": {
      title: "Post the attendance list",
      detail: "Build the list from the check-in CSV and door list, then post it.",
      actionRoute: `${base}/attendance`,
      lockedReason: null,
    },
    "List posted": {
      title: "Wait to release payouts",
      detail: "Guests left off can still challenge during the window.",
      actionRoute: `${base}/payout`,
      lockedReason: facts.release.lockedReason,
    },
    "Payouts ready": {
      title: "Release payouts",
      detail: "Attendees get their deposit back plus their share of the pool.",
      actionRoute: `${base}/payout`,
      lockedReason: null,
    },
    "Paid out": {
      title: facts.spare > 0n ? "Check the leftovers" : "Payouts released",
      detail: facts.spare > 0n ? "Return guests' stray money before collecting leftovers." : "Nothing left to collect.",
      actionRoute: facts.spare > 0n ? `${base}/payout` : null,
      lockedReason: null,
    },
    Cancelled: {
      title: "Check remaining deposits",
      detail: "Registered stakers were refunded. Return any unregistered deposits separately.",
      actionRoute: `${base}/guests`,
      lockedReason: null,
    },
    "Past the deadline": {
      title: "Guests can withdraw",
      detail: "No attendance list was posted before the deadline.",
      actionRoute: null,
      lockedReason: "The deadline for posting attendance has passed.",
    },
  };
  return {
    phase,
    nextStep: steps[phase],
    counts: {
      deposits: facts.deposits,
      registered: facts.registered,
      attendees: event.phase === 0 || event.phase === 3 ? null : facts.attendees,
      openChallenges: facts.openChallenges,
    },
    clock,
    deadlines,
  };
}

export const unreadRelease = () => gate("Check the payout dry run first.");
