export interface PayoutExample {
  deposit: bigint;
  booked: number;
  came: number;
  pool: bigint;
  /** What each guest who came receives: the contract's previewShare. */
  share: bigint;
}

/** The pool and the per-attendee share, by the contract's rule: deposit × stakers ÷ attendees, rounded down. */
export function payoutExample(deposit: bigint, booked: number, came: number): PayoutExample {
  const pool = deposit * BigInt(booked);
  return { deposit, booked, came, pool, share: came > 0 ? pool / BigInt(came) : 0n };
}
