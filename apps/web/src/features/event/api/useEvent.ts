"use client";

import { presenceEventAbi } from "@kickback/contracts";
import { getLogsChunked } from "@kickback/core";
import { useQuery } from "@tanstack/react-query";
import { getAbiItem, type Address } from "viem";
import { usePublicClient } from "wagmi";

import { eventKey, loadEvent, EventRefused, type KickbackEvent } from "@/lib/presence";
import { STALE_TIME } from "@/lib/query";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { FROM_BLOCK, PROTOCOL } from "@/config/protocol";

import { foldGuestLogs, type WalletDeposits } from "../model/guestLogs";

export { eventKey, loadEvent, EventRefused, type KickbackEvent, type RefusalReason } from "@/lib/presence";

/** The event at `contract`, read on-chain and checked against this site's factory. */
export function useEvent(contract: string) {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });

  return useQuery<KickbackEvent, Error>({
    queryKey: eventKey(contract),
    enabled: client !== undefined,
    staleTime: STALE_TIME.live,
    refetchInterval: 10_000,
    retry: (count, error) => !(error instanceof EventRefused) && count < 2,
    queryFn: () => loadEvent(client!, contract),
  });
}

/**
 * The block `contract` was created in (its own EventCreated log): where its logs start. `hint` (the link's
 * `from` block) is tried first and trusted only when the log is found from it.
 */
export function useCreatedBlock(contract: Address | undefined, hint?: number) {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  const useHint = hint !== undefined && Number.isInteger(hint) && hint >= FROM_BLOCK;
  return useQuery({
    queryKey: ["created-block", DEFAULT_CHAIN_ID, contract?.toLowerCase(), useHint ? hint : undefined],
    enabled: client !== undefined && contract !== undefined && PROTOCOL !== null,
    staleTime: STALE_TIME.immutable,
    retry: 1,
    queryFn: async () => {
      const created = getAbiItem({ abi: presenceEventAbi, name: "EventCreated" });
      const scan = (from: number) =>
        getLogsChunked(
          {
            getLogs: ({ fromBlock, toBlock }) =>
              client!.getLogs({
                address: contract!,
                event: created,
                fromBlock,
                toBlock,
              }),
            getBlockNumber: () => client!.getBlockNumber({ cacheTime: 0 }),
          },
          from,
          "latest",
          undefined,
          { stopWhen: (found) => found.length > 0 },
        );
      let logs = useHint ? await scan(hint!) : [];
      if (!logs.length) logs = await scan(FROM_BLOCK);
      return logs[0]?.blockNumber === undefined || logs[0].blockNumber === null
        ? FROM_BLOCK
        : Number(logs[0].blockNumber);
    },
  });
}

export interface EventDeposits {
  /** Wallets with a deposit. */
  guests: number;
  /** Lower-case wallet → its deposits. */
  byWallet: Map<string, WalletDeposits>;
  /** HeldShareSplit amounts added together: what a lost Kleros case's held share added to every attendee's share. */
  heldSplit: bigint;
  /** How many held shares were split (logs with a non-zero amount). */
  heldSplitCount: number;
}

const DEPOSITED = getAbiItem({ abi: presenceEventAbi, name: "Deposited" });
const REJECTED = getAbiItem({ abi: presenceEventAbi, name: "Rejected" });
const PAID = getAbiItem({ abi: presenceEventAbi, name: "Paid" });
const HELD_SPLIT = getAbiItem({ abi: presenceEventAbi, name: "HeldShareSplit" });

export const depositsKey = (contract: string) => ["event-deposits", DEFAULT_CHAIN_ID, contract.toLowerCase()] as const;

/** Deposit, turn-away and payment logs, from `fromBlock` (the event's creation, or the factory's deploy). */
export function useEventDeposits(contract: Address | undefined, fromBlock: number | undefined) {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });

  return useQuery<EventDeposits>({
    queryKey: [...depositsKey(contract ?? ""), fromBlock],
    enabled: client !== undefined && contract !== undefined && fromBlock !== undefined,
    staleTime: STALE_TIME.live,
    refetchInterval: 30_000,
    queryFn: async () => {
      const logs = await getLogsChunked(
        {
          getLogs: ({ fromBlock: a, toBlock: b }) =>
            client!.getLogs({
              address: contract!,
              events: [DEPOSITED, REJECTED, PAID, HELD_SPLIT],
              fromBlock: a,
              toBlock: b,
            }),
          getBlockNumber: () => client!.getBlockNumber({ cacheTime: 0 }),
        },
        fromBlock!,
      );
      const byWallet = foldGuestLogs(logs.filter((log) => log.eventName !== "HeldShareSplit"));
      const heldSplit = logs.reduce(
        (sum, log) => (log.eventName === "HeldShareSplit" ? sum + (log.args.each ?? 0n) : sum),
        0n,
      );
      return {
        guests: new Set(
          logs.filter((log) => log.eventName === "Deposited").map((log) => log.args.staker?.toLowerCase()),
        ).size,
        byWallet,
        heldSplit,
        // each split counts once, unless its amount rounded down to nothing
        heldSplitCount: logs.filter((log) => log.eventName === "HeldShareSplit" && (log.args.each ?? 0n) > 0n).length,
      };
    },
  });
}

/** Unix seconds of a block; blocks never change, so each is read once. */
export function useBlockTime(block: bigint | undefined) {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  return useQuery({
    queryKey: ["block-time", DEFAULT_CHAIN_ID, block?.toString()],
    enabled: client !== undefined && block !== undefined,
    staleTime: STALE_TIME.immutable,
    queryFn: async () => Number((await client!.getBlock({ blockNumber: block! })).timestamp),
  });
}

const RELEASED = getAbiItem({ abi: presenceEventAbi, name: "PayoutsReleased" });

/** The block of the event's PayoutsReleased log (once released), read from the event's creation; null when none. */
export function useReleasedBlock(contract: Address | undefined, fromBlock: number | undefined, enabled: boolean) {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  return useQuery({
    queryKey: ["released-block", DEFAULT_CHAIN_ID, contract?.toLowerCase(), fromBlock],
    enabled: enabled && client !== undefined && contract !== undefined && fromBlock !== undefined,
    staleTime: STALE_TIME.immutable,
    retry: 1,
    queryFn: async () => {
      const logs = await getLogsChunked(
        {
          getLogs: ({ fromBlock: a, toBlock: b }) =>
            client!.getLogs({ address: contract!, event: RELEASED, fromBlock: a, toBlock: b }),
          getBlockNumber: () => client!.getBlockNumber({ cacheTime: 0 }),
        },
        fromBlock!,
        "latest",
        undefined,
        { stopWhen: (found) => found.length > 0 },
      );
      return logs[0]?.blockNumber ?? null;
    },
  });
}
