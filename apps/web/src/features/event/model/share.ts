/** Where the example's numbers come from. */
export type ShareBasis = "illustration" | "estimate" | "list" | "paid";

/** The no-show split as the how-it-works example tells it. */
export interface ShareExample {
  deposits: number;
  attend: number;
  noShows: number;
  /** Guests still in a Kleros case after the payout: the contract holds one share for each. */
  held: number;
  /** The no-shows' deposits, in wei. */
  pool: bigint;
  /** What each attendee gets back, deposit included: the contract's previewShare(attend). */
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
 * Once the list is posted (`listed` attendees, at least 1), its real numbers; once paid, `back` is the real share,
 * and `openCases` guests still with Kleros are neither attendees nor no-shows: a share is held for each.
 */
export function shareExample(
  amount: bigint,
  stakerCount: number,
  back?: bigint,
  listed?: number,
  openCases = 0,
): ShareExample {
  const fromList = listed !== undefined && listed >= 1 && listed <= stakerCount;
  const held = fromList && back !== undefined ? Math.max(0, Math.min(openCases, stakerCount - listed)) : 0;
  const real = fromList || stakerCount >= 2;
  const deposits = real ? stakerCount : 10;
  const noShows = fromList ? deposits - listed - held : Math.max(1, Math.round(deposits / 5));
  const attend = Math.max(1, deposits - noShows - held);
  // previewShare: depositAmount * stakerCount / attendees, rounded down
  const share = back ?? (amount * BigInt(deposits)) / BigInt(attend);
  const basis: ShareBasis = fromList ? (back !== undefined ? "paid" : "list") : real ? "estimate" : "illustration";
  return {
    deposits,
    attend,
    noShows,
    held,
    pool: amount * BigInt(noShows),
    back: share,
    bonus: share - amount,
    real,
    basis,
  };
}
