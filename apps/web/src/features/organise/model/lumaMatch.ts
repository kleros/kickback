import { detectColumns, lumaDecision, normAddress, parseCsv, type LumaDecision } from "@kickback/core";

export interface LumaMatchRow {
  name: string;
  email: string;
  ticket: string;
  wallet: string | null;
  luma: LumaDecision;
  /**
   * "deposit": this wallet has a deposit; "turned-away": it deposited and the organiser turned it away (refunded,
   * and it can never deposit again); "refunded": it deposited and took the deposit back (a cancellation or a missed
   * deadline); "none": no deposit from it; "no-wallet": the row has no wallet.
   */
  match: "deposit" | "turned-away" | "refunded" | "none" | "no-wallet";
  /** Another registration with the same wallet is the main one (approved first, then pending, then declined;
   * CSV order on a tie): one deposit is one ticket. */
  dupOf?: string;
}

/** Luma's own verified wallet column ("Require Ethereum wallet"); a custom question about wallets does not count. */
const verifiedWalletColumn = (headers: readonly string[]) =>
  headers.find((h) => h.trim().toLowerCase() === "eth_address");

/**
 * Luma registrations against the event's deposits, by the wallet Luma verified ("Require Ethereum
 * wallet"). Booked guests first, then the rest, so the organiser can approve the matches in one go.
 */
export function matchLuma(
  text: string,
  booked: readonly string[],
  /** Every guest who deposited, by lower-case wallet, with their status (2 turned away, 3 refunded). */
  statuses?: ReadonlyMap<string, number>,
): LumaMatchRow[] {
  const rows = parseCsv(text);
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const cols = detectColumns(headers);
  const walletCol = verifiedWalletColumn(headers);
  const paid = new Set(booked.map((w) => w.toLowerCase()));
  const out = rows.map((r, i): LumaMatchRow => {
    // only the column Luma verified: an address typed in a free-text answer proves nothing
    const wallet = walletCol ? normAddress(r[walletCol]) || null : null;
    return {
      name: (cols.name && r[cols.name]) || `Row ${i + 2}`,
      email: (cols.email && r[cols.email]) || "",
      ticket: (cols.ticket && r[cols.ticket]) || "",
      wallet,
      luma: lumaDecision(cols.approval && r[cols.approval]),
      match: !wallet
        ? "no-wallet"
        : paid.has(wallet.toLowerCase())
          ? "deposit"
          : statuses?.get(wallet.toLowerCase()) === 2
            ? "turned-away"
            : statuses?.get(wallet.toLowerCase()) === 3
              ? "refunded"
              : "none",
    };
  });
  const rank = { approved: 0, pending: 1, declined: 2 } as const;
  const best = new Map<string, LumaMatchRow>();
  for (const r of out) {
    if (!r.wallet) continue;
    const k = r.wallet.toLowerCase();
    const b = best.get(k);
    if (!b || rank[r.luma] < rank[b.luma]) best.set(k, r);
  }
  for (const r of out) {
    const b = r.wallet ? best.get(r.wallet.toLowerCase()) : undefined;
    if (b && b !== r) r.dupOf = b.name;
  }
  const order = { deposit: 0, "turned-away": 1, refunded: 2, none: 3, "no-wallet": 4 } as const;
  return out.sort((a, b) => order[a.match] - order[b.match]);
}

/** Whether an export has the wallet column Luma fills when "Require Ethereum wallet" is on. */
export function hasWalletColumn(text: string): boolean {
  const rows = parseCsv(text);
  return !!verifiedWalletColumn(rows[0] ? Object.keys(rows[0]) : []);
}
