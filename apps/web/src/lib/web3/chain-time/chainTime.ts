import type { PublicClient } from "viem";

/** The app's "now": the latest block's timestamp, in unix seconds. Contract deadlines compare against this. */
export interface ChainTime {
  blockNumber: bigint;
  /** Unix seconds. */
  now: number;
}

export const chainTimeKey = (chainId: number) => ["chain-time", chainId] as const;

export const chainTimeOf = (block: { number: bigint | null; timestamp: bigint }): ChainTime => {
  if (block.number === null) throw new Error("A pending block has no settled time.");
  return { blockNumber: block.number, now: Number(block.timestamp) };
};

/** Whether `at` (unix seconds) has passed on the chain, matching the contract's `block.timestamp >= at`. */
export const hasReached = (chainTime: ChainTime, at: number | bigint): boolean => chainTime.now >= Number(at);

/** Seconds left until `at` on the chain's clock, never negative. */
export const secondsUntil = (chainTime: ChainTime, at: number | bigint): number =>
  Math.max(0, Number(at) - chainTime.now);

/** Reads block `blockNumber`, or the latest when omitted. */
export async function readChainTime(client: Pick<PublicClient, "getBlock">, blockNumber?: bigint): Promise<ChainTime> {
  const block = await (blockNumber === undefined ? client.getBlock() : client.getBlock({ blockNumber }));
  return chainTimeOf(block);
}
