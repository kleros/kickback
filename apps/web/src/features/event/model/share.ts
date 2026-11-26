/** Where the example's numbers come from. */
export type ShareBasis = "illustration" | "estimate" | "list" | "paid";

/** The no-show split as the how-it-works example tells it. */
export interface ShareExample {
  deposits: number;
  attend: number;
  noShows: number;
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
 * Once the list is posted (`listed` attendees, at least 1), its real numbers; once paid, `back` is the real share.
 */
export function shareExample(amount: bigint, stakerCount: number, back?: bigint, listed?: number): ShareExample {
  const fromList = listed !== undefined && listed >= 1 && listed <= stakerCount;
  const real = fromList || stakerCount >= 2;
  const deposits = real ? stakerCount : 10;
  const noShows = fromList ? deposits - listed : Math.max(1, Math.round(deposits / 5));
  const attend = Math.max(1, deposits - noShows);
  // previewShare: depositAmount * stakerCount / attendees, rounded down
  const share = back ?? (amount * BigInt(deposits)) / BigInt(attend);
  const basis: ShareBasis = fromList ? (back !== undefined ? "paid" : "list") : real ? "estimate" : "illustration";
  return { deposits, attend, noShows, pool: amount * BigInt(noShows), back: share, bonus: share - amount, real, basis };
}
