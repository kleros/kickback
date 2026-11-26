import { getAddress, type Address } from "viem";

import { detectColumns, normAddress, parseCsv, type Columns } from "./text";

/** A CSV row that could not be used, with why. */
export interface SkippedRow {
  row: number;
  name: string;
  reason: "no-wallet" | "not-a-guest" | "not-checked-in" | "duplicate";
  wallet?: Address;
}

export interface AttendancePlan {
  /** Guests with a deposit who checked in: the list to post. */
  attending: Address[];
  /** Guests with a deposit who are not in `attending`: they lose their deposit unless they challenge. */
  noShows: Address[];
  skipped: SkippedRow[];
  /** The columns read from the CSV. */
  columns: Columns;
}

/**
 * The attendance list from a check-in CSV (a Luma guest export, or any CSV with a wallet column and,
 * optionally, a check-in column) and the event's current stakers. A row counts when its wallet is a
 * staker and, if the CSV has a check-in column, that cell is filled.
 */
export function attendanceFromCsv(text: string, stakers: readonly Address[], overrides: Columns = {}): AttendancePlan {
  const rows = parseCsv(text);
  const columns = detectColumns(rows[0] ? Object.keys(rows[0]) : [], overrides);
  const isStaker = new Set(stakers.map((s) => s.toLowerCase()));
  const seen = new Set<string>();
  const attending: Address[] = [];
  const skipped: SkippedRow[] = [];
  rows.forEach((r, i) => {
    const name = (columns.name && r[columns.name]) || (columns.email && r[columns.email]) || "";
    // only the wallet column when there is one (an address typed in a free-text answer proves nothing);
    // otherwise any cell holding an address
    const wallet = columns.wallet
      ? normAddress(r[columns.wallet])
      : Object.values(r).map(normAddress).find(Boolean) || null;
    if (!wallet) return skipped.push({ row: i + 2, name, reason: "no-wallet" });
    if (columns.checkedIn && !String(r[columns.checkedIn] ?? "").trim())
      return skipped.push({ row: i + 2, name, reason: "not-checked-in", wallet });
    if (!isStaker.has(wallet.toLowerCase())) return skipped.push({ row: i + 2, name, reason: "not-a-guest", wallet });
    if (seen.has(wallet.toLowerCase())) return skipped.push({ row: i + 2, name, reason: "duplicate", wallet });
    seen.add(wallet.toLowerCase());
    attending.push(wallet);
  });
  const noShows = stakers.filter((s) => !seen.has(s.toLowerCase())).map((s) => getAddress(s));
  return { attending, noShows, skipped, columns };
}

/** Splits a list into batches of `size` (one transaction each). */
export function batches<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
