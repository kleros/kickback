"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useBlockNumber, usePublicClient } from "wagmi";

import { STALE_TIME } from "@/lib/query";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { chainTimeKey, readChainTime } from "./chainTime";

/**
 * The latest block's time, re-read on every new block. A block's timestamp never changes, so each
 * block is cached for good and the previous one stays on screen while the next loads.
 */
export function useChainTime(chainId: number = DEFAULT_CHAIN_ID) {
  const client = usePublicClient({ chainId });
  const { data: blockNumber } = useBlockNumber({ chainId, watch: true });

  return useQuery({
    queryKey: [...chainTimeKey(chainId), blockNumber?.toString() ?? "latest"],
    queryFn: () => readChainTime(client!, blockNumber),
    enabled: client !== undefined,
    staleTime: STALE_TIME.immutable,
    placeholderData: keepPreviousData,
  });
}
