"use client";

import { presenceEventAbi } from "@kickback/contracts";
import { getLogsChunked, KickbackError, latestEvents, readEvent, type EventInfo } from "@kickback/core";
import { useQuery } from "@tanstack/react-query";
import { getAbiItem, type Address } from "viem";
import { usePublicClient } from "wagmi";

import { STALE_TIME } from "@/lib/query";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { FROM_BLOCK, PROTOCOL } from "@/config/protocol";

import { foldGuestLogs, type WalletDeposits } from "../model/guestLogs";
import type { EventClock } from "../model/when";

export type RefusalReason = "not-address" | "no-contract" | "not-kickback" | "look-alike";

export interface KickbackEvent extends EventInfo {
  /** The event's name, as the contract stores it. */
  eventName: string;
  /** Dates are shown on the visitor's own clock: the contract stores no time zone. */
  clock: EventClock | null;
  /** The registration page, when the event's link is a Luma page. */
  lumaUrl?: string;
}

export class EventRefused extends Error {
  constructor(
    readonly reason: RefusalReason,
    readonly address: string,
  ) {
    super(reason);
  }
}

const LUMA_RE = /^https:\/\/(?:www\.)?(?:lu\.ma|luma\.com)\/[A-Za-z0-9._~\-/?=&]+$/;

const refusalOf = (error: unknown): RefusalReason | undefined => {
  if (!(error instanceof KickbackError)) return undefined;
  if (error.code === "NO_KICKBACK_CONTRACT") return "no-contract";
  if (error.code === "UNKNOWN_CODE") return "look-alike";
  if (error.code === "NOT_KICKBACK") return "not-kickback";
  return undefined;
};

export const eventKey = (contract: string) => ["event", DEFAULT_CHAIN_ID, contract.toLowerCase()] as const;

/** Reads and checks an event: it must be a clone this site's factory created (isEvent), or EventRefused is thrown. */
export async function loadEvent(
  client: Parameters<typeof readEvent>[0],
  contract: string,
  protocol = PROTOCOL,
): Promise<KickbackEvent> {
  let info: EventInfo;
  try {
    if (!protocol) throw new KickbackError("No factory on this network yet.", "NO_KICKBACK_CONTRACT");
    info = await readEvent(client, contract, protocol);
  } catch (error) {
    const reason = refusalOf(error);
    if (reason) throw new EventRefused(/^0x[0-9a-fA-F]{40}$/.test(contract) ? reason : "not-address", contract);
    throw error;
  }
  return {
    ...info,
    eventName: info.name,
    clock: null,
    lumaUrl: LUMA_RE.test(info.url) ? info.url : undefined,
  };
}

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

/** The factory's newest events, for the home page. */
export function useLatestEvents(limit = 6) {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  return useQuery({
    queryKey: ["latest-events", DEFAULT_CHAIN_ID, PROTOCOL?.factory, limit],
    enabled: client !== undefined && PROTOCOL !== null,
    staleTime: STALE_TIME.live,
    refetchInterval: 30_000,
    queryFn: async () => (await latestEvents(client!, PROTOCOL!.factory, limit)) as Address[],
  });
}

/** The block `contract` was created in (its own EventCreated log): where its logs start. */
export function useCreatedBlock(contract: Address | undefined) {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  return useQuery({
    queryKey: ["created-block", DEFAULT_CHAIN_ID, contract?.toLowerCase()],
    enabled: client !== undefined && contract !== undefined && PROTOCOL !== null,
    staleTime: STALE_TIME.immutable,
    queryFn: async () => {
      const created = getAbiItem({ abi: presenceEventAbi, name: "EventCreated" });
      const logs = await getLogsChunked(
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
        FROM_BLOCK,
      );
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
}

const DEPOSITED = getAbiItem({ abi: presenceEventAbi, name: "Deposited" });
const REJECTED = getAbiItem({ abi: presenceEventAbi, name: "Rejected" });
const PAID = getAbiItem({ abi: presenceEventAbi, name: "Paid" });

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
              events: [DEPOSITED, REJECTED, PAID],
              fromBlock: a,
              toBlock: b,
            }),
          getBlockNumber: () => client!.getBlockNumber({ cacheTime: 0 }),
        },
        fromBlock!,
      );
      const byWallet = foldGuestLogs(logs);
      return {
        guests: new Set(
          logs.filter((log) => log.eventName === "Deposited").map((log) => log.args.staker?.toLowerCase()),
        ).size,
        byWallet,
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
