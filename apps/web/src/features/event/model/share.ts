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
}

/** One in five registered guests stays home; under two registered, ten deposits with eight attending. */
export function shareExample(amount: bigint, stakerCount: number, back?: bigint): ShareExample {
  const real = stakerCount >= 2;
  const deposits = real ? stakerCount : 10;
  const noShows = Math.max(1, Math.round(deposits / 5));
  const attend = deposits - noShows;
  // previewShare: depositAmount * stakerCount / attendees, rounded down
  const share = back ?? (amount * BigInt(deposits)) / BigInt(attend);
  return { deposits, attend, noShows, pool: amount * BigInt(noShows), back: share, bonus: share - amount, real };
}
