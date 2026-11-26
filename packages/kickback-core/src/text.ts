import { decimalText } from "@kickback/contracts/protocol";
import { formatUnits, getAddress, parseUnits, type Address } from "viem";

import { DECIMALS } from "./constants";

/**
 * Rows of a CSV text as objects keyed by the header row, read like csv-parse with columns,
 * skip_empty_lines, bom and relax_column_count: quoted fields may hold commas, line breaks and "";
 * the line break is the first one found outside quotes; a short row has only its first keys; a
 * repeated header keeps the last value; a stray quote throws.
 */
export function parseCsv(text: unknown): Record<string, string>[] {
  let s = String(text ?? "");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const n = s.length;
  const rows: Record<string, string>[] = [];
  let headers: string[] | null = null;
  let record: string[] = [];
  let field = "";
  let rd = "";
  let line = 1;
  let quoting = false;
  let wasQuoting = false;
  let escaping = false;
  const findRd = (i: number) => (s.startsWith("\r\n", i) ? "\r\n" : s[i] === "\n" ? "\n" : s[i] === "\r" ? "\r" : "");
  const endField = () => {
    record.push(field);
    field = "";
    wasQuoting = false;
  };
  const endRecord = () => {
    if (!headers) headers = record;
    else {
      const row: Record<string, string> = {};
      for (let k = 0; k < record.length && k < headers.length; k++) row[headers[k]!] = record[k]!;
      rows.push(row);
    }
    record = [];
  };
  for (let i = 0; i < n; i++) {
    if (!quoting && !rd) rd = findRd(i);
    const ch = s[i]!;
    if (ch === "\n" || (ch === "\r" && s[i + 1] !== "\n")) line++;
    if (escaping) {
      escaping = false;
      field += ch;
      continue;
    }
    if (quoting && ch === '"' && i + 1 < n && s[i + 1] === '"') {
      escaping = true;
      continue;
    }
    if (ch === '"') {
      if (quoting) {
        const next = s[i + 1];
        const nextRd = rd ? s.startsWith(rd, i + 1) : !!(rd = findRd(i + 1));
        if (next === undefined || next === "\0" || next === "," || nextRd) {
          quoting = false;
          wasQuoting = true;
          continue;
        }
        throw new Error(`A quote mark is out of place on line ${line}.`);
      }
      if (field.length)
        throw new Error(`A quote mark is out of place on line ${line}.`);
      quoting = true;
      continue;
    }
    if (!quoting) {
      if (rd && s.startsWith(rd, i)) {
        i += rd.length - 1;
        if (!wasQuoting && !record.length && !field.length) continue; // empty line
        endField();
        endRecord();
        continue;
      }
      if (ch === ",") {
        endField();
        continue;
      }
    }
    field += ch;
  }
  if (quoting) throw new Error(`A quoted cell is not closed (line ${line}).`);
  if (wasQuoting || record.length || field.length) {
    endField();
    endRecord();
  }
  return rows;
}

// A cell starting with = + - @ (or a tab / CR) runs as a formula when the CSV is opened in a spreadsheet.
const FORMULA_START = /^[=+\-@\t\r]/;
/** One CSV cell: formula-safe (a leading '), quoted when it must be. */
export const csvCell = (v: unknown): string => {
  let s = v === undefined || v === null ? "" : String(v);
  if (FORMULA_START.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Undoes csvCell's leading ' when reading our own CSVs back. */
export const uncell = (v: unknown): string =>
  /^'[=+\-@\t\r]/.test(String(v ?? "")) ? String(v).slice(1) : String(v ?? "");

/** A CSV text: the header row, then one line per row, safe cells. */
export function toCsv(rows: readonly object[], headers?: readonly string[]): string {
  const cols = headers ?? (rows[0] ? Object.keys(rows[0]) : []);
  const cell = (r: object, c: string) => csvCell((r as Record<string, unknown>)[c]);
  return [cols.map(csvCell).join(","), ...rows.map((r) => cols.map((c) => cell(r, c)).join(","))].join("\n") + "\n";
}

export interface Columns {
  name?: string;
  email?: string;
  ticket?: string;
  approval?: string;
  checkedIn?: string;
  tx?: string;
  wallet?: string;
}

/**
 * The columns of a Luma guest export: snake_case for built-in fields, the question text for custom
 * questions, matched by keywords; `overrides` (config.columns) wins.
 */
export function detectColumns(headers: readonly string[], overrides: Columns = {}): Columns {
  // the first pattern that matches any header wins
  const find = (...patterns: RegExp[]) => {
    for (const p of patterns) {
      const h = headers.find((x) => p.test(x.toLowerCase().trim()));
      if (h) return h;
    }
    return undefined;
  };
  const cols: Columns = {
    name: find(/^name$/, /full name/),
    email: find(/^email$/, /e-?mail/),
    ticket: find(/^ticket_name$/, /ticket/),
    approval: find(/approval_status/, /^status$/),
    checkedIn: find(/checked_in_at/, /check.?in/),
    tx: find(/\btx\b/, /transaction/, /tx.?(hash|link)/, /deposit.*(link|hash)/, /etherscan|arbiscan|basescan/),
    wallet: find(/^eth_address$/, /eth.?address/, /wallet/),
  };
  return { ...cols, ...overrides };
}

// A hash or address ends where its hex ends or a next "0x" starts: 65 digits are no hash, a hash is no address.
export const TX_HASH_RE = /0x[a-fA-F0-9]{64}(?!(?!0x)[a-fA-F0-9])/;

export function extractTxHash(value: unknown): string | null {
  const m = String(value ?? "").match(TX_HASH_RE);
  return m ? m[0].toLowerCase() : null;
}
/** Every tx hash in an answer, in order, without repeats. */
export const extractTxHashes = (value: unknown): string[] => [
  ...new Set((String(value ?? "").match(new RegExp(TX_HASH_RE.source, "g")) ?? []).map((h) => h.toLowerCase())),
];

/** The first 0x address in a text, checksummed, or null. */
export function normAddress(value: unknown): Address | null {
  const m = String(value ?? "").match(/0x[a-fA-F0-9]{40}(?!(?!0x)[a-fA-F0-9])/);
  if (!m) return null;
  try {
    return getAddress(m[0].toLowerCase());
  } catch {
    return null;
  }
}

/**
 * True for a 0x address whose EIP-55 checksum holds: all lower or all upper case carries none, mixed
 * case must match it (ethers' isAddress; viem's strict check also refuses all upper case).
 */
export function isAddressStrict(value: unknown): value is Address {
  const s = String(value ?? "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(s)) return false;
  const hex = s.slice(2);
  return hex === hex.toLowerCase() || hex === hex.toUpperCase() || getAddress(s.toLowerCase()) === s;
}
/** The checksummed address; throws on a malformed one or a broken checksum (ethers' getAddress). */
export function checkedAddress(value: unknown): Address {
  if (!isAddressStrict(value)) throw new Error(`"${String(value ?? "")}" is not a valid address (bad checksum?)`);
  return getAddress(value.toLowerCase());
}

/** An exact amount with at least one decimal place, unless the token has zero decimals. */
export const fmt = (units: bigint, decimals = DECIMALS): string => {
  const s = formatUnits(units, decimals);
  return decimals === 0 || s.includes(".") ? s : `${s}.0`;
};

/**
 * An ETH amount for people to read: exact when it fits in `digits` decimals ("0.01 ETH"), otherwise
 * rounded down and marked with "≈" ("≈0.013333 ETH"). Dust is shown in full.
 */
/** An amount for reading: at most `digits` decimals, marked "≈" when cut (an even split of a pool rarely ends). */
export function readableUnits(units: bigint, decimals: number, digits = 6): string {
  const exact = decimalText(units, decimals);
  const [whole = "0", dec = ""] = exact.split(".");
  if (dec.length <= digits) return exact;
  const short = dec.slice(0, digits).replace(/0+$/, "");
  return short || whole !== "0" ? `≈${whole}${short ? "." + short : ""}` : exact;
}

export function fmtEth(units: bigint, digits = 6): string {
  const exact = fmt(units);
  const [whole = "0", dec = ""] = exact.split(".");
  if (dec.length <= digits) return `${exact} ETH`;
  const short = dec.slice(0, digits).replace(/0+$/, "");
  return short || whole !== "0" ? `≈${whole}${short ? "." + short : ""} ETH` : `${exact} ETH`;
}

/** An ETH amount in wei; throws on an empty, malformed or over-precise text (viem's parseEther reads "" as 0). */
export function parseEthStrict(text: string): bigint {
  const m = /^(-?)(\d*)\.?(\d*)$/.exec(text);
  if (!m || (!m[2] && !m[3])) throw new Error(`invalid ETH amount "${text}"`);
  const frac = m[3]!;
  if (frac.length > DECIMALS && /[1-9]/.test(frac.slice(DECIMALS))) throw new Error(`too many decimals in "${text}"`);
  return parseUnits(`${m[1]}${m[2] || "0"}.${frac.slice(0, DECIMALS) || "0"}`, DECIMALS);
}

export type LumaDecision = "declined" | "approved" | "pending";
/** How the organiser decided on a guest in Luma. */
export function lumaDecision(approval: unknown): LumaDecision {
  const a = String(approval ?? "")
    .toLowerCase()
    .trim();
  if (/declin|reject/.test(a)) return "declined";
  // exact words only: "pending_approval" must not count as approved
  if (/^(approved|going|accepted)$/.test(a)) return "approved";
  return "pending";
}

/** A Luma event page link, as the guest page accepts it for "Back to Luma" and the share link. */
export const LUMA_URL = /^https:\/\/(?:www\.)?(?:lu\.ma|luma\.com)\/[A-Za-z0-9._~\-/?=&]+$/;
