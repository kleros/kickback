"use client";

import { presenceEventAbi } from "@kickback/contracts";
import { eventsOf } from "@kickback/core";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { PROTOCOL } from "@/config/protocol";

/**
 * The events the connected wallet created, from the factory, newest first, with their names. An event whose
 * ownership has since moved to another wallet is left out; a failed owner read keeps the row.
 */
export function useMyEvents() {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  const { address } = useAccount();
  return useQuery({
    queryKey: ["organise", "mine", DEFAULT_CHAIN_ID, address?.toLowerCase()],
    enabled: !!client && !!address && PROTOCOL !== null,
    queryFn: async () => {
      const contracts = (await eventsOf(client!, PROTOCOL!.factory, address!)) as Address[];
      const rows = await Promise.all(
        contracts.map(async (contract) => {
          const [name, owner] = await Promise.all([
            client!
              .readContract({ address: contract, abi: presenceEventAbi, functionName: "eventName" })
              .catch(() => null),
            client!.readContract({ address: contract, abi: presenceEventAbi, functionName: "owner" }).catch(() => null),
          ]);
          return { contract, name, owner };
        }),
      );
      return rows
        .filter((r) => !r.owner || r.owner.toLowerCase() === address!.toLowerCase())
        .map(({ contract, name }) => ({ contract, name }));
    },
  });
}
