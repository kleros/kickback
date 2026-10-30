"use client";

import type { NetworkInput } from "@kickback/core";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";

import { useChainTime } from "@/lib/web3/chain-time";

import { overviewModel } from "../model/phase";
import { organiserKey, sameEventPlaceholder, type EventScope } from "../model/shared";
import { openEvent } from "../operations/read";

export function useEventOverview(scope: EventScope, network: NetworkInput = { chainId: scope.chainId }) {
  const client = usePublicClient({ chainId: scope.chainId });
  const time = useChainTime(scope.chainId);
  return useQuery({
    queryKey: [...organiserKey(scope), "overview", scope.deployBlock, network, time.data?.blockNumber.toString()],
    queryFn: async () => {
      const data = await openEvent(client!, scope, network);
      return {
        ...overviewModel(data.event, data.now, data),
        event: data.event,
        cfg: data.cfg,
        blockNumber: data.blockNumber,
        deployBlock: data.deployBlock,
        verifiedKleros: data.verifiedKleros,
      };
    },
    enabled: !!client,
    retry: false,
    placeholderData: sameEventPlaceholder(scope),
  });
}
