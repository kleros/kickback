import type { Address } from "viem";

export interface ListedEvent {
  contract: Address;
  /** The block deposit logs are read from, when known. */
  from?: number;
}

/** The factory's newest events, one row per contract, at most `limit`. */
export function listedEvents(featured: readonly { contract: Address; fromBlock?: number }[], limit = 6): ListedEvent[] {
  const seen = new Set<string>();
  const rows: ListedEvent[] = [];
  const add = (row: ListedEvent) => {
    const key = row.contract.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };
  for (const row of featured) add({ contract: row.contract, from: row.fromBlock || undefined });
  return rows.slice(0, limit);
}

export type EventStatus = "booking" | "started" | "overdue" | "listed" | "paid" | "cancelled";

export const STATUS_TEXT: Record<EventStatus, string> = {
  booking: "Deposits open",
  started: "Attendance due",
  overdue: "Past the deadline",
  listed: "Challenge window",
  paid: "Payouts released",
  cancelled: "Cancelled",
};

/** The row's state from the contract's phase (Open, Listed, Finalized, Cancelled) and the chain's time. */
export function eventStatus(phase: number, eventEnd: number, claimDeadline: number, now: number): EventStatus {
  if (phase === 1) return "listed";
  if (phase === 2) return "paid";
  if (phase === 3) return "cancelled";
  if (now < eventEnd) return "booking";
  return now < claimDeadline ? "started" : "overdue";
}
