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
