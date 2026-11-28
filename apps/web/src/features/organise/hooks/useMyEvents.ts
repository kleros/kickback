"use client";

import { presenceEventAbi } from "@kickback/contracts";
import { eventsOwnedBy } from "@kickback/core";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { FROM_BLOCK, PROTOCOL } from "@/config/protocol";

/**
 * The events the connected wallet organises now, newest first, with their names: the ones it created and
 * the ones handed to it (see eventsOwnedBy). An event it handed on is left out; a failed owner read keeps the row.
 */
export function useMyEvents() {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  const { address } = useAccount();
  return useQuery({
    queryKey: ["organise", "mine", DEFAULT_CHAIN_ID, address?.toLowerCase()],
    enabled: !!client && !!address && PROTOCOL !== null,
    queryFn: async () => {
      const contracts = await eventsOwnedBy(client!, PROTOCOL!.factory, address!, FROM_BLOCK);
      return Promise.all(
        contracts.map(async (contract) => ({
          contract,
          name: await client!
            .readContract({ address: contract, abi: presenceEventAbi, functionName: "eventName" })
            .catch(() => null),
        })),
      );
    },
  });
}
