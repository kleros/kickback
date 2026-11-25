import { detectColumns, lumaDecision, normAddress, parseCsv, type LumaDecision } from "@kickback/core";

export interface LumaMatchRow {
  name: string;
  email: string;
  ticket: string;
  wallet: string | null;
  luma: LumaDecision;
  /** "deposit": this wallet booked; "none": no deposit from it; "no-wallet": the row has no wallet. */
  match: "deposit" | "none" | "no-wallet";
  /** Another registration with the same wallet came first: one deposit is one ticket. */
  dupOf?: string;
}

/**
 * Luma registrations against the event's deposits, by the wallet Luma verified ("Require Ethereum
 * wallet"). Booked guests first, then the rest, so the organiser can approve the matches in one go.
 */
export function matchLuma(text: string, booked: readonly string[]): LumaMatchRow[] {
  const rows = parseCsv(text);
  const cols = detectColumns(rows[0] ? Object.keys(rows[0]) : []);
  const paid = new Set(booked.map((w) => w.toLowerCase()));
  const out = rows.map((r, i): LumaMatchRow => {
    const wallet =
      (cols.wallet && normAddress(r[cols.wallet])) || Object.values(r).map(normAddress).find(Boolean) || null;
    return {
      name: (cols.name && r[cols.name]) || `Row ${i + 2}`,
      email: (cols.email && r[cols.email]) || "",
      ticket: (cols.ticket && r[cols.ticket]) || "",
      wallet,
      luma: lumaDecision(cols.approval && r[cols.approval]),
      match: !wallet ? "no-wallet" : paid.has(wallet.toLowerCase()) ? "deposit" : "none",
    };
  });
  const first = new Map<string, string>();
  for (const r of out) {
    if (!r.wallet) continue;
    const k = r.wallet.toLowerCase();
    const seen = first.get(k);
    if (seen === undefined) first.set(k, r.name);
    else r.dupOf = seen;
  }
  const order = { deposit: 0, none: 1, "no-wallet": 2 } as const;
  return out.sort((a, b) => order[a.match] - order[b.match]);
}
