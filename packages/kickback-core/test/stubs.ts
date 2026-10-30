// Clients that answer from tables instead of a chain, for rules a real chain can't easily reach.
import {
  pad,
  toHex,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Address,
  type Hash,
  type Hex,
} from "viem";

import * as core from "../src";

/** A tx hash made from a small number. */
export const hashOf = (n: number): Hash => pad(toHex(n), { size: 32 });

export interface StubTx {
  /** no receipt yet: the tx is pending */
  pending?: boolean;
  from: Address;
  amount: bigint;
  /** block timestamp, unix seconds */
  ts: number;
}

/** A VerifyClient over `txs`: each one a successful deposit of `amount` from `from` into `receiver`, mined at `ts`. */
export function verifyClient(receiver: Address, txs: Record<Hash, StubTx>): core.VerifyClient {
  const blockOf = new Map<bigint, number>();
  const find = (hash: Hash) => {
    const t = txs[hash];
    return t ? { t, block: BigInt(Object.keys(txs).indexOf(hash) + 1) } : null;
  };
  const client = {
    getTransactionReceipt: async ({ hash }: { hash: Hash }) => {
      const f = find(hash);
      if (!f || f.t.pending) throw new TransactionReceiptNotFoundError({ hash });
      blockOf.set(f.block, f.t.ts);
      return {
        status: "success",
        to: receiver,
        blockNumber: f.block,
        gasUsed: 30_000n,
        logs: [
          {
            address: receiver,
            topics: [core.DEPOSITED_TOPIC, pad(f.t.from, { size: 32 })],
            data: toHex(f.t.amount, { size: 32 }),
            logIndex: 0,
          },
        ],
      };
    },
    getTransaction: async ({ hash }: { hash: Hash }) => {
      const f = find(hash);
      if (!f) throw new TransactionNotFoundError({ hash });
      return { hash, gas: 100_000n };
    },
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: BigInt(blockOf.get(blockNumber)!) }),
    getCode: async (): Promise<Hex | undefined> => undefined,
  };
  return client as unknown as core.VerifyClient;
}

/** A readContract client answering the kickback getters buildPayout reads from `answers`. */
export function readClient(answers: {
  stakers: Address[];
  stakerCount?: bigint;
  depositAmount: bigint;
  previewShare?: (attendees: bigint) => bigint;
}) {
  const readContract = async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
    switch (functionName) {
      case "stakers":
        return answers.stakers;
      case "status":
        return core.STATUS.Staker;
      case "stakerCount":
        return answers.stakerCount ?? BigInt(answers.stakers.length);
      case "depositAmount":
        return answers.depositAmount;
      case "previewShare": {
        const n = args![0] as bigint;
        return answers.previewShare
          ? answers.previewShare(n)
          : (answers.depositAmount * BigInt(answers.stakers.length)) / n;
      }
      default:
        throw new Error(`readClient: no answer for ${functionName}`);
    }
  };
  return { readContract } as unknown as Parameters<typeof core.buildPayout>[0]["client"];
}
