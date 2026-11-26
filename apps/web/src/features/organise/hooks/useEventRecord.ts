"use client";

import { presenceEventAbi } from "@kickback/contracts";
import { getLogsChunked } from "@kickback/core";
import { useQuery } from "@tanstack/react-query";
import { toFunctionSelector, type AbiEvent, type AbiFunction, type Address, type Hash } from "viem";
import { usePublicClient } from "wagmi";

import { STALE_TIME } from "@/lib/query";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { FROM_BLOCK } from "@/config/protocol";

import { organiserKey } from "./useOrganiserEvent";
import { foldRecord, type RecordLog, type TxInfo } from "../model/record";

const NAMES = [
  "EventCreated",
  "Deposited",
  "Rejected",
  "Paid",
  "PaymentFailed",
  "ListClosed",
  "AttendeeAdded",
  "Challenged",
  "ChallengeMatched",
  "ChallengeResolved",
  "HeldShareSplit",
  "PayoutsReleased",
  "Cancelled",
];
/** The function each selector calls, to tell a claim (withdraw) from a send (distribute), and an answer's kind. */
const FUNCTIONS = new Map(
  (presenceEventAbi as readonly { type: string; name?: string }[])
    .filter((item) => item.type === "function")
    .map((item) => [toFunctionSelector(item as AbiFunction), item.name!] as const),
);
/** The logs whose transaction is read: who sent it, and what it called. */
const READ_TX = new Set(["Paid", "PaymentFailed", "ChallengeResolved", "PayoutsReleased"]);
/** A mined transaction never changes: each is read once per page. */
const TX_CACHE = new Map<string, TxInfo>();
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
      const all = logs as unknown as RecordLog[];
      const hashes = [
        ...new Set(
          all.filter((l) => READ_TX.has(l.eventName) && l.transactionHash).map((l) => l.transactionHash!.toLowerCase()),
        ),
      ];
      // a transaction that cannot be read keeps its payments, without "claimed" or "sent by"
      const infos = await Promise.all(
        hashes.map(async (hash) => {
          const known = TX_CACHE.get(hash);
          if (known) return [hash, known] as const;
          try {
            const t = await client!.getTransaction({ hash: hash as Hash });
            const info: TxInfo = { from: t.from, fn: FUNCTIONS.get(t.input.slice(0, 10) as `0x${string}`) };
            TX_CACHE.set(hash, info);
            return [hash, info] as const;
          } catch {
            return undefined;
          }
        }),
      );
      return foldRecord(all, new Map(infos.filter((i) => i !== undefined)));
    },
  });
}
