/**
 * Names from Luma exports, and the wallets already checked at the door, kept in this browser only
 * (localStorage, per event). Never sent anywhere: guest names and emails stay on the organiser's device.
 */
export interface LumaPerson {
  name: string;
  email: string;
}

export type LumaBook = Record<string, LumaPerson>;
export type CheckedBook = Record<string, number>;

const key = (contract: string, kind: "names" | "checked") => `kb:luma:${kind}:${contract.toLowerCase()}`;

function read<T>(k: string): T | null {
  try {
    const raw = window.localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(k: string, value: unknown) {
  try {
    window.localStorage.setItem(k, JSON.stringify(value));
  } catch {
    // storage blocked: the names just won't be remembered
  }
}

export const readNames = (contract: string): LumaBook => read<LumaBook>(key(contract, "names")) ?? {};
export const readChecked = (contract: string): CheckedBook => read<CheckedBook>(key(contract, "checked")) ?? {};

/** Adds the rows that carry a wallet and a name; later exports win. */
export function addNames(
  contract: string,
  rows: readonly { wallet: string | null; name: string; email: string }[],
): LumaBook {
  const book = { ...readNames(contract) };
  for (const r of rows) if (r.wallet && r.name) book[r.wallet.toLowerCase()] = { name: r.name, email: r.email };
  write(key(contract, "names"), book);
  return book;
}

/** Records that a wallet's deposit was confirmed at the door; returns the earlier time, if any. */
export function markChecked(contract: string, wallet: string, at: number): { book: CheckedBook; before?: number } {
  const book = { ...readChecked(contract) };
  const before = book[wallet.toLowerCase()];
  if (before === undefined) book[wallet.toLowerCase()] = at;
  write(key(contract, "checked"), book);
  return { book, before };
}
