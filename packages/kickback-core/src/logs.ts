import type { Hex } from "viem";

import { DEFAULT_LOG_CHUNK } from "./constants";
import { shortMessage } from "./kickbackError";

/** Code of a contract, not of a plain wallet (an EIP-7702 delegated wallet is still a plain wallet). */
export const isContractCode = (code: Hex | undefined | null): boolean =>
  !!code && code !== "0x" && !/^0xef0100[0-9a-f]{40}$/i.test(code);

export interface BlockRange {
  fromBlock: bigint;
  toBlock: bigint;
}
export interface LogsReader<L> {
  getLogs: (range: BlockRange) => Promise<readonly L[]>;
  getBlockNumber?: () => Promise<bigint>;
}
export interface ChunkOptions {
  retries?: number;
  delayMs?: number;
  minStep?: number;
}

/**
 * eth_getLogs over a block range in chunks of `step` blocks, so public RPCs that cap the range still
 * answer. A failing chunk is retried `retries` times with growing pauses, then split in halves down to
 * `minStep` blocks; only then does the scan stop, with a message saying what to change.
 */
export async function getLogsChunked<L>(
  reader: LogsReader<L>,
  fromBlock: number | bigint,
  toBlock: number | bigint | "latest" = "latest",
  step: number = DEFAULT_LOG_CHUNK,
  { retries = 3, delayMs = 1000, minStep = 100 }: ChunkOptions = {},
): Promise<L[]> {
  if (!Number.isInteger(step) || step < 1)
    throw new Error(`getLogsChunked: the chunk size must be a whole number of blocks, 1 or more (got ${step})`);
  if (toBlock === "latest" && !reader.getBlockNumber)
    throw new Error('getLogsChunked: toBlock "latest" needs getBlockNumber');
  const latest = toBlock === "latest" ? Number(await reader.getBlockNumber!()) : Number(toBlock);
  const out: L[] = [];
  const range = async (from: number, to: number): Promise<void> => {
    let err: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, delayMs * 2 ** (attempt - 1)));
      try {
        out.push(...(await reader.getLogs({ fromBlock: BigInt(from), toBlock: BigInt(to) })));
        return;
      } catch (e) {
        err = e;
      }
    }
    if (to - from + 1 > minStep) {
      const mid = from + Math.floor((to - from + 1) / 2);
      await range(from, mid - 1);
      return range(mid, to);
    }
    throw new Error(
      `Could not read the contract's history for blocks ${from}–${to} from the RPC after ${retries + 1} tries ` +
        `(${shortMessage(err)}). Try again in a few minutes, or use another RPC.`,
    );
  };
  for (let start = Number(fromBlock); start <= latest; start += step)
    await range(start, Math.min(start + step - 1, latest));
  return out;
}
