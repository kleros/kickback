import { PAYOUT_COLUMNS, toCsv, type BuildPayoutResult, type EventInfo } from "@kickback/core";

import { gate } from "./shared";

export function attendanceGates(
  event: Pick<EventInfo, "phase" | "eventStart" | "claimDeadline">,
  now: number,
  challengeEndsAt: number,
  plan?: BuildPayoutResult,
  confirmation = "",
  noShowConfirmation = "",
  isOwner = true,
) {
  return {
    post: gate(
      !isOwner
        ? "Connect the organiser's wallet."
        : event.phase !== 0
          ? "The attendance list is already posted or the event is closed."
          : now < event.eventStart
            ? "Locked until the event starts."
            : now > event.claimDeadline
              ? "The attendance deadline has passed."
              : !plan
                ? "Build the attendance list first."
                : !plan.attendees.length
                  ? "At least one registered guest must attend."
                  : plan.unknown.length && noShowConfirmation !== "NOSHOW"
                    ? "Type NOSHOW to count unmatched stakers as no-shows."
                    : confirmation !== "POST"
                      ? "Type POST to publish this list."
                      : null,
    ),
    add: gate(
      !isOwner
        ? "Connect the organiser's wallet."
        : event.phase !== 1
          ? "Post the attendance list first."
          : now > challengeEndsAt
            ? "The challenge window has closed; the list cannot be changed."
            : null,
    ),
  };
}

export function attendanceModel(plan: BuildPayoutResult, previewShare: bigint) {
  if (previewShare !== plan.share) throw new Error("The share changed; rebuild the attendance list before posting.");
  return {
    plan,
    attendees: plan.attendees.length,
    registered: plan.stakers.length,
    noShows: plan.noShows.length,
    unmatchedStakers: plan.unknown,
    missingRegistrations: plan.missing,
    share: previewShare,
    downloads: {
      csv: toCsv(plan.payoutRows, PAYOUT_COLUMNS),
      summary: plan.summaryMarkdown,
      plan: JSON.stringify(plan.plan, null, 2),
    },
  };
}
