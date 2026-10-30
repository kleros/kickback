import { depKey, pairReturns, type DepositIn, type DepositPairing, type ReturnEvent } from "@kickback/core";
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
  args: { from?: Address; wallet?: Address; to?: Address; staker?: Address; amount?: bigint; refunded?: bigint };
  transactionHash: Hash | null;
  blockNumber: bigint | null;
  logIndex?: number | null;
};

export function foldGuestLogs(logs: readonly GuestLog[], depositAmount: bigint) {
  const byWallet = new Map<string, WalletDeposits>();
  const deposits = new Map<string, DepositIn>();
  const returns: ReturnEvent[] = [];
  for (const [index, log] of logs.entries()) {
    if (log.blockNumber === null || !log.transactionHash) continue;
    const wallet = (log.args.from ?? log.args.wallet ?? log.args.to ?? log.args.staker)?.toLowerCase();
    if (!wallet) continue;
    const seen = byWallet.get(wallet) ?? { deposited: 0n };
    byWallet.set(wallet, seen);
    const position = { tx: log.transactionHash, block: Number(log.blockNumber), logIndex: log.logIndex ?? index };
    if (log.eventName === "Deposited") {
      const key = depKey(log.transactionHash, wallet);
      const prior = deposits.get(key);
      if (prior) prior.amount += log.args.amount!;
      else deposits.set(key, { ...position, from: wallet, amount: log.args.amount! });
      seen.returned = undefined;
      seen.refundedBlock = undefined;
    } else if (log.eventName === "Rejected" || log.eventName === "Refunded" || log.eventName === "StakerRegistered") {
      returns.push({
        ...position,
        type: log.eventName,
        wallet,
        amount: log.args.amount ?? log.args.refunded ?? 0n,
      });
      if (log.eventName === "Rejected") seen.refundedBlock = log.blockNumber;
      if (log.eventName === "Refunded") seen.returned = { amount: log.args.amount!, block: log.blockNumber };
    } else if (log.eventName === "Payout") seen.payoutTx = log.transactionHash;
  }
  const { byDeposit } = pairReturns([...deposits.values()], returns, { deposit: depositAmount, preferLatest: true });
  const receipts = new Map<string, DepositPairing>();
  for (const held of byDeposit.values()) {
    const seen = byWallet.get(held.from)!;
    seen.deposited += held.remaining;
    if (held.remaining < depositAmount) continue;
    const prior = receipts.get(held.from);
    if (
      held.staked ||
      !prior ||
      (!prior.staked && (held.block > prior.block || (held.block === prior.block && held.logIndex > prior.logIndex)))
    ) {
      receipts.set(held.from, held);
      seen.txHash = held.tx as Hash;
      seen.block = BigInt(held.block);
    }
  }
  return byWallet;
}
