/** Where the example's numbers come from. */
export type ShareBasis = "illustration" | "estimate" | "list" | "paid";

/** The no-show split as the how-it-works example tells it. */
export interface ShareExample {
  deposits: number;
  attend: number;
  noShows: number;
  /** Guests with an open Kleros case: the contract holds one share for each (at the release, and after it). */
  held: number;
  /**
   * Challenges still waiting for the organiser's answer (before the release): each ends as one more share, the
   * guest joining the list or the case going to Kleros, where a share is held.
   */
  pending: number;
  /** The no-shows' deposits, in wei. */
  pool: bigint;
  /** What each attendee gets back, deposit included: the contract's share. */
  back: bigint;
  /** What each attendee gets on top of their deposit. */
  bonus: bigint;
  /** Built from the event's registered guests; false is the illustrative 10 with 8 attending. */
  real: boolean;
  /** illustration: 10 with 8 attending; estimate: one in five of the deposits stays home; list: the posted list; paid: the payout. */
  basis: ShareBasis;
}

/**
 * One in five registered guests stays home; under two registered, ten deposits with eight attending.
 * Once the list is posted (`listed` attendees, at least 1), its real numbers; once paid, `back` is the real share.
 * `openCases` guests with Kleros and `waiting` unanswered challenges are neither attendees nor no-shows: each takes
 * a share, as the contract's release counts them (attendees + open cases, after every waiting challenge has been
 * answered or accepted).
 */
export function shareExample(
  amount: bigint,
  stakerCount: number,
  back?: bigint,
  listed?: number,
  openCases = 0,
  waiting = 0,
  /** The event's capacity (0 = no limit): the illustration never shows more deposits than there are spots. */
  capacity = 0,
): ShareExample {
  const fromList = listed !== undefined && listed >= 1 && listed <= stakerCount;
  const held = fromList ? Math.max(0, Math.min(openCases, stakerCount - listed)) : 0;
  // after the release no challenge waits (the release needs none waiting)
  const pending = fromList && back === undefined ? Math.max(0, Math.min(waiting, stakerCount - listed - held)) : 0;
  const real = fromList || stakerCount >= 2;
  const deposits = real ? stakerCount : capacity > 0 ? Math.min(10, capacity) : 10;
  // a one-spot illustration has nobody to stay home: its one guest attends and gets the deposit back
  const noShows = fromList
    ? deposits - listed - pending - held
    : !real && deposits === 1
      ? 0
      : Math.max(1, Math.round(deposits / 5));
  const attend = Math.max(1, deposits - noShows - pending - held);
  // the release: depositAmount * stakerCount / (attendees + open cases), rounded down
  const share = back ?? (amount * BigInt(deposits)) / BigInt(attend + pending + held);
  const basis: ShareBasis = fromList ? (back !== undefined ? "paid" : "list") : real ? "estimate" : "illustration";
  return {
    deposits,
    attend,
    noShows,
    held,
    pending,
    pool: amount * BigInt(noShows),
    back: share,
    bonus: share - amount,
    real,
    basis,
  };
}
