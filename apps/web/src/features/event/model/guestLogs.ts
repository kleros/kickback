import type { Address, Hash } from "viem";

export interface WalletDeposits {
  deposited: bigint;
  txHash?: Hash;
  block?: bigint;
  refundedBlock?: bigint;
  returned?: { amount: bigint; block: bigint };
  payoutTx?: Hash;
}

type GuestLog = {
  eventName: string;
  args: { from?: Address; wallet?: Address; to?: Address; amount?: bigint };
  transactionHash: Hash | null;
  blockNumber: bigint | null;
};

export function foldGuestLogs(logs: readonly GuestLog[]) {
  const byWallet = new Map<string, WalletDeposits>();
  for (const log of logs) {
    if (log.blockNumber === null || !log.transactionHash) continue;
    const wallet = (log.args.from ?? log.args.wallet ?? log.args.to)?.toLowerCase();
    if (!wallet) continue;
    let seen = byWallet.get(wallet);
    if (!seen && (log.eventName === "Refunded" || log.eventName === "Payout")) {
      seen = { deposited: 0n };
      byWallet.set(wallet, seen);
    }
    if (log.eventName === "Deposited") {
      if (seen) {
        seen.deposited += log.args.amount!;
        seen.txHash ??= log.transactionHash;
        seen.block ??= log.blockNumber;
        seen.returned = undefined;
      } else byWallet.set(wallet, { deposited: log.args.amount!, txHash: log.transactionHash, block: log.blockNumber });
    } else if (seen) {
      if (log.eventName === "Rejected") seen.refundedBlock = log.blockNumber;
      if (log.eventName === "Refunded") seen.returned = { amount: log.args.amount!, block: log.blockNumber };
      if (log.eventName === "Payout") seen.payoutTx = log.transactionHash;
    }
  }
  return byWallet;
}
