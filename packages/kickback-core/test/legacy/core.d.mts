// core.mjs beside this file is kickback-legacy/scripts/core.mjs at legacy commit 10d6426 (prettier-formatted), the oracle
// the chain tests compare the port with. Only what they call is typed.
/* eslint-disable @typescript-eslint/no-explicit-any */
export declare function readEvent(
  prov: unknown,
  address: string,
  abi: unknown,
  opts?: { runtime?: unknown },
): Promise<any>;
export declare function normalizeConfig(cfg: unknown, file?: string): any;
export declare function contractConfig(ev: unknown, network: unknown, deployBlock: number): any;
export declare function checkGuests(args: {
  prov: unknown;
  cfg: unknown;
  abi: unknown;
  rows: Record<string, string>[];
  scanFrom?: number;
}): Promise<any>;
export declare function buildPayout(args: {
  prov: unknown;
  cfg: unknown;
  abi: unknown;
  checkins: Record<string, string>[] | null;
  verified?: unknown[];
  claims?: unknown[];
  extra?: Record<string, string>[];
  extraName?: string;
  title?: string;
}): Promise<any>;
export declare function parseCsv(text: string): Record<string, string>[];
export declare function toCsv(rows: readonly object[], headers?: readonly string[]): string;
export declare const CHECK_COLUMNS: Record<string, readonly string[]>;
export declare const PAYOUT_COLUMNS: readonly string[];
