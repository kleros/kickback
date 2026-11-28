/**
 * Names from Luma exports, and the wallets already checked at the door, kept in this browser only
 * (localStorage, per event and per organiser wallet), shown only while the organiser's wallet is connected. A wallet
 * that later becomes the organiser of the same event (a handover) starts with nothing and loads its own export. Never sent anywhere: guest names and emails stay on the organiser's device.
 */
export interface LumaPerson {
  name: string;
  email: string;
  /** The request's status on Luma in the latest export that had it. */
  luma?: "approved" | "pending" | "declined";
}

export type LumaBook = Record<string, LumaPerson>;
export type CheckedBook = Record<string, number>;

type OwnedKind = "names" | "export" | "checkin" | "ticks";

/** The door checks are kept per event, whoever the organiser is: they guard against approving a guest twice. */
const checkedKey = (contract: string) => `kb:luma:checked:${contract.toLowerCase()}`;
/** Names, exports and ticks belong to the organiser wallet that loaded them. */
const ownedKey = (contract: string, kind: OwnedKind, owner: string) =>
  `kb:luma:${kind}:${contract.toLowerCase()}:${owner.toLowerCase()}`;
/** Where data was kept before it was kept per wallet (per event only). */
const legacyKey = (contract: string, kind: OwnedKind) => `kb:luma:${kind}:${contract.toLowerCase()}`;

/**
 * The key for the organiser's data; data saved under the older per-event key moves to this wallet on first read (the
 * connected wallet is the event's organiser, so it is almost always the wallet that loaded it).
 */
function key(contract: string, kind: OwnedKind, owner: string): string {
  const k = ownedKey(contract, kind, owner);
  try {
    const ls = window.localStorage;
    if (ls.getItem(k) === null) {
      const old = ls.getItem(legacyKey(contract, kind));
      if (old !== null) {
        ls.setItem(k, old);
        ls.removeItem(legacyKey(contract, kind));
      }
    }
  } catch {
    // storage blocked: nothing to move
  }
  return k;
}

function read<T>(k: string): T | null {
  try {
    const raw = window.localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function remove(k: string) {
  try {
    window.localStorage.removeItem(k);
  } catch {
    // storage blocked: nothing was kept
  }
}

function write(k: string, value: unknown) {
  try {
    window.localStorage.setItem(k, JSON.stringify(value));
  } catch {
    // storage blocked: the names just won't be remembered
  }
}

export const readNames = (contract: string, owner: string): LumaBook =>
  read<LumaBook>(key(contract, "names", owner)) ?? {};
export const readChecked = (contract: string): CheckedBook => read<CheckedBook>(checkedKey(contract)) ?? {};

/** Adds the rows that carry a wallet and a name; later exports win. */
export function addNames(
  contract: string,
  owner: string,
  rows: readonly { wallet: string | null; name: string; email: string; luma?: LumaPerson["luma"] }[],
): LumaBook {
  const book = { ...readNames(contract, owner) };
  const approved = new Set(rows.filter((r) => r.wallet && r.luma === "approved").map((r) => r.wallet!.toLowerCase()));
  for (const r of rows)
    if (r.wallet && r.name) {
      const k = r.wallet.toLowerCase();
      // one approved request on a wallet is enough: a duplicate pending row does not hide it
      const luma = approved.has(k) ? "approved" : r.luma;
      if (approved.has(k) && r.luma !== "approved" && book[k]?.luma === "approved") continue;
      book[k] = { name: r.name, email: r.email, ...(luma ? { luma } : {}) };
    }
  write(key(contract, "names", owner), book);
  return book;
}

/** Records that a wallet's deposit was confirmed at the door; returns the earlier time, if any. */
export function markChecked(contract: string, wallet: string, at: number): { book: CheckedBook; before?: number } {
  const book = { ...readChecked(contract) };
  const before = book[wallet.toLowerCase()];
  if (before === undefined) book[wallet.toLowerCase()] = at;
  write(checkedKey(contract), book);
  return { book, before };
}

/** The last Luma export loaded for this event (its raw text), so the match list comes back after a reload. */
export interface SavedExport {
  name: string;
  text: string;
  /** Date.now() when it was loaded. */
  at: number;
}

export const readExport = (contract: string, owner: string): SavedExport | null =>
  read<SavedExport>(key(contract, "export", owner));

export function writeExport(contract: string, owner: string, file: SavedExport) {
  write(key(contract, "export", owner), file);
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

export const readCheckin = (contract: string, owner: string): SavedCheckin | null =>
  read<SavedCheckin>(key(contract, "checkin", owner));

export function writeCheckin(contract: string, owner: string, value: SavedCheckin) {
  write(key(contract, "checkin", owner), value);
}

/**
 * The organiser's ticks on the Attendance tab (lower-case wallets), kept on their own: ticks made by hand with no
 * export loaded are remembered too, and never look like a loaded file.
 */
export const readTicks = (contract: string, owner: string): string[] | null => {
  const t = read<unknown>(key(contract, "ticks", owner));
  return Array.isArray(t) ? t.filter((w): w is string => typeof w === "string") : null;
};

export function writeTicks(contract: string, owner: string, ticks: readonly string[] | null) {
  if (ticks) write(key(contract, "ticks", owner), ticks);
  else remove(key(contract, "ticks", owner));
}

/** Forgets the saved check-in export and its ticks (names already added to the guest list stay). */
export function forgetCheckin(contract: string, owner: string) {
  remove(key(contract, "checkin", owner));
  remove(key(contract, "ticks", owner));
  window.dispatchEvent(new Event("kb-luma"));
}

/** Forgets the saved exports and the names they gave; the door checks stay, so nobody is approved twice. */
export function forgetLuma(contract: string, owner: string) {
  for (const kind of ["export", "checkin", "ticks", "names"] as const) remove(key(contract, kind, owner));
  window.dispatchEvent(new Event("kb-luma"));
}
