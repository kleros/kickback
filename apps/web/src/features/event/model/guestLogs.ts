import type { Address, Hash } from "viem";

export interface WalletDeposits {
  /** The latest deposit's transaction and block. */
  txHash?: Hash;
  block?: bigint;
  /** The organiser turned the wallet away (Rejected): the deposit went back in full. */
  refundedBlock?: bigint;
  /** The latest payment out of the event to this wallet (Paid). */
  paid?: { amount: bigint; block: bigint; tx: Hash; eth: boolean };
}

type GuestLog = {
  eventName: string;
  args: { staker?: Address; account?: Address; amount?: bigint; refunded?: bigint; eth?: boolean };
  transactionHash: Hash | null;
  blockNumber: bigint | null;
};

/** Deposited, Rejected and Paid logs, in chain order, folded per lower-case wallet. */
export function foldGuestLogs(logs: readonly GuestLog[]) {
  const byWallet = new Map<string, WalletDeposits>();
  for (const log of logs) {
    if (log.blockNumber === null || !log.transactionHash) continue;
    const wallet = (log.args.staker ?? log.args.account)?.toLowerCase();
    if (!wallet) continue;
    const seen = byWallet.get(wallet) ?? {};
    byWallet.set(wallet, seen);
    if (log.eventName === "Deposited") {
      seen.txHash = log.transactionHash;
      seen.block = log.blockNumber;
      seen.refundedBlock = undefined;
    } else if (log.eventName === "Rejected") seen.refundedBlock = log.blockNumber;
    else if (log.eventName === "Paid")
      seen.paid = {
        amount: log.args.amount ?? 0n,
        block: log.blockNumber,
        tx: log.transactionHash,
        eth: log.args.eth ?? false,
      };
  }
  return byWallet;
}
