"use client";

import { presenceEventAbi } from "@kickback/contracts";
import { getLogsChunked } from "@kickback/core";
import { useQuery } from "@tanstack/react-query";
import type { AbiEvent, Address } from "viem";
import { usePublicClient } from "wagmi";

import { STALE_TIME } from "@/lib/query";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { FROM_BLOCK } from "@/config/protocol";

import { organiserKey } from "./useOrganiserEvent";
import { foldRecord, type RecordLog } from "../model/record";

const NAMES = ["EventCreated", "Deposited", "Rejected", "Paid", "ListClosed", "PayoutsReleased", "Cancelled"];
const EVENTS = (presenceEventAbi as readonly { type: string; name?: string }[]).filter(
  (item) => item.type === "event" && NAMES.includes(item.name ?? ""),
) as unknown as AbiEvent[];
type Log = { eventName?: string; blockNumber: bigint | null };

/** Every money transaction of the event, from its own logs: the organiser's record. */
export function useEventRecord(contract: Address) {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  return useQuery({
    queryKey: [...organiserKey(contract), "record"],
    enabled: client !== undefined,
    staleTime: STALE_TIME.live,
    refetchInterval: 30_000,
    queryFn: async () => {
      const read = (from: number, stopAtCreation: boolean) =>
        getLogsChunked(
          {
            getLogs: ({ fromBlock, toBlock }) =>
              client!.getLogs({ address: contract, events: EVENTS, fromBlock, toBlock }),
            getBlockNumber: () => client!.getBlockNumber({ cacheTime: 0 }),
          },
          from,
          "latest",
          undefined,
          stopAtCreation
            ? { stopWhen: (found) => (found as unknown as readonly Log[]).some((l) => l.eventName === "EventCreated") }
            : undefined,
        );
      // find the creation block once, then read everything from there
      const created = ((await read(FROM_BLOCK, true)) as unknown as readonly Log[]).find(
        (l) => l.eventName === "EventCreated",
      )?.blockNumber;
      const logs = await read(created === undefined || created === null ? FROM_BLOCK : Number(created), false);
      return foldRecord(logs as unknown as RecordLog[]);
    },
  });
}
