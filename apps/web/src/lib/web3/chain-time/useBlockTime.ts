"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";

import { STALE_TIME } from "@/lib/query";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

/** A block's time (unix seconds), read once and kept: a mined block never changes. */
export function useBlockTime(block: bigint | undefined) {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  return useQuery({
    queryKey: ["block-time", DEFAULT_CHAIN_ID, block?.toString()],
    enabled: client !== undefined && block !== undefined,
    staleTime: STALE_TIME.immutable,
    queryFn: async () => Number((await client!.getBlock({ blockNumber: block! })).timestamp),
  });
}
