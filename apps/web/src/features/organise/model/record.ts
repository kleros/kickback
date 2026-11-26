import type { Address, Hash } from "viem";

/** One money movement out of the event, as the contract's Paid log records it. */
export interface Payment {
  tx: Hash;
  block: bigint;
  amount: bigint;
  to: Address;
  eth: boolean;
}

export interface WalletRecord {
  deposit?: { tx: Hash; block: bigint; amount: bigint };
  /** Turned away by the organiser (the refund itself is a Payment in the same transaction). */
  rejected?: { tx: Hash; block: bigint };
  payments: Payment[];
}

/** Every transaction that moved or settled the event's money, read from its own logs. */
export interface EventRecord {
  wallets: Map<string, WalletRecord>;
  listClosed?: { tx: Hash; block: bigint };
  released?: { tx: Hash; block: bigint; share: bigint };
  cancelled?: { tx: Hash; block: bigint };
}

export type RecordLog = {
  eventName: string;
  args: {
    staker?: Address;
    account?: Address;
    to?: Address;
    amount?: bigint;
    eth?: boolean;
    share?: bigint;
  };
  transactionHash: Hash | null;
  blockNumber: bigint | null;
};

/** Folds the event's logs, in chain order, into one record per lower-case wallet plus the event-wide steps. */
export function foldRecord(logs: readonly RecordLog[]): EventRecord {
  const record: EventRecord = { wallets: new Map() };
  const walletOf = (address: Address) => {
    const key = address.toLowerCase();
    let row = record.wallets.get(key);
    if (!row) record.wallets.set(key, (row = { payments: [] }));
    return row;
  };
  for (const log of logs) {
    if (log.blockNumber === null || !log.transactionHash) continue;
    const at = { tx: log.transactionHash, block: log.blockNumber };
    const { args } = log;
    if (log.eventName === "Deposited" && args.staker)
      walletOf(args.staker).deposit = { ...at, amount: args.amount ?? 0n };
    else if (log.eventName === "Rejected" && args.staker) walletOf(args.staker).rejected = at;
    else if (log.eventName === "Paid" && args.account)
      walletOf(args.account).payments.push({
        ...at,
        amount: args.amount ?? 0n,
        to: args.to ?? args.account,
        eth: args.eth ?? false,
      });
    else if (log.eventName === "ListClosed") record.listClosed = at;
    else if (log.eventName === "PayoutsReleased") record.released = { ...at, share: args.share ?? 0n };
    else if (log.eventName === "Cancelled") record.cancelled = at;
  }
  return record;
}

const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** The record as a CSV an organiser can keep or send: one row per wallet, then the event-wide steps. */
export function recordCsv(
  rows: readonly {
    name?: string;
    wallet: string;
    status: string;
    deposit: string;
    depositTx?: string;
    paid: string;
    paymentTxs: readonly string[];
  }[],
  steps: readonly { label: string; tx: string }[],
) {
  const lines = [
    ["Name", "Wallet", "Status", "Deposit", "Deposit transaction", "Paid out", "Payment transactions"],
    ...rows.map((r) => [
      r.name ?? "",
      r.wallet,
      r.status,
      r.deposit,
      r.depositTx ?? "",
      r.paid,
      r.paymentTxs.join(" "),
    ]),
    ...steps.map((s) => [s.label, "", "", "", "", "", s.tx]),
  ];
  return lines.map((line) => line.map(cell).join(",")).join("\n") + "\n";
}
