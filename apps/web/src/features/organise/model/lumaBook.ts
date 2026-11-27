/**
 * Names from Luma exports, and the wallets already checked at the door, kept in this browser only
 * (localStorage, per event), shown only while the organiser's wallet is connected. Never sent anywhere: guest names and emails stay on the organiser's device.
 */
export interface LumaPerson {
  name: string;
  email: string;
  /** The request's status on Luma in the latest export that had it. */
  luma?: "approved" | "pending" | "declined";
}

export type LumaBook = Record<string, LumaPerson>;
export type CheckedBook = Record<string, number>;

const key = (contract: string, kind: "names" | "checked" | "export" | "checkin") =>
  `kb:luma:${kind}:${contract.toLowerCase()}`;

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
  rows: readonly { wallet: string | null; name: string; email: string; luma?: LumaPerson["luma"] }[],
): LumaBook {
  const book = { ...readNames(contract) };
  const approved = new Set(rows.filter((r) => r.wallet && r.luma === "approved").map((r) => r.wallet!.toLowerCase()));
  for (const r of rows)
    if (r.wallet && r.name) {
      const k = r.wallet.toLowerCase();
      // one approved request on a wallet is enough: a duplicate pending row does not hide it
      const luma = approved.has(k) ? "approved" : r.luma;
      if (approved.has(k) && r.luma !== "approved" && book[k]?.luma === "approved") continue;
      book[k] = { name: r.name, email: r.email, ...(luma ? { luma } : {}) };
    }
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

/** The last Luma export loaded for this event (its raw text), so the match list comes back after a reload. */
export interface SavedExport {
  name: string;
  text: string;
  /** Date.now() when it was loaded. */
  at: number;
}

export const readExport = (contract: string): SavedExport | null => read<SavedExport>(key(contract, "export"));

export function writeExport(contract: string, file: SavedExport) {
  write(key(contract, "export"), file);
}

/** The last Luma check-in export loaded on the Attendance tab, and the organiser's ticks on it. */
export interface SavedCheckin {
  name: string;
  text: string;
  /** Date.now() when it was loaded. */
  at: number;
  /** The wallets ticked as came (lower case), once the organiser changed a tick. */
  picked?: string[];
}

export const readCheckin = (contract: string): SavedCheckin | null => read<SavedCheckin>(key(contract, "checkin"));

export function writeCheckin(contract: string, value: SavedCheckin) {
  write(key(contract, "checkin"), value);
}

/** Forgets the saved check-in export and its ticks (names already added to the guest list stay). */
export function forgetCheckin(contract: string) {
  try {
    window.localStorage.removeItem(key(contract, "checkin"));
  } catch {
    // storage blocked: nothing was kept
  }
  window.dispatchEvent(new Event("kb-luma"));
}

/** Forgets the saved exports and the names they gave; the door checks stay, so nobody is approved twice. */
export function forgetLuma(contract: string) {
  try {
    window.localStorage.removeItem(key(contract, "export"));
    window.localStorage.removeItem(key(contract, "checkin"));
    window.localStorage.removeItem(key(contract, "names"));
  } catch {
    // storage blocked: nothing was kept
  }
  window.dispatchEvent(new Event("kb-luma"));
}
