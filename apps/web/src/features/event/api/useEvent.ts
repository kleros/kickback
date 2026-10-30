"use client";

import { kickbackAbi } from "@kickback/contracts";
import {
  eventClock,
  findDeployBlock,
  getLogsChunked,
  KickbackError,
  readEvent,
  renderCase,
  type EventClock,
  type EventInfo,
} from "@kickback/core";
import { useQuery } from "@tanstack/react-query";
import { getAbiItem, zeroAddress, type Address } from "viem";
import { usePublicClient } from "wagmi";

import { STALE_TIME } from "@/lib/query";

import { DEFAULT_CHAIN_ID, isLocalChainEnabled } from "@/config/chains";
import { knownLumaUrl } from "@/config/event";
import { isKnownResolverOn } from "@/config/kleros";

import { foldGuestLogs, type WalletDeposits } from "../model/guestLogs";

export type RefusalReason = "not-address" | "no-contract" | "not-kickback" | "look-alike";

export interface KickbackEvent extends EventInfo {
  clock: EventClock | null;
  /** The registration page named in the case description, when it is a Luma link. */
  lumaUrl?: string;
  /** Registered guests: what previewShare divides. */
  stakerCount: number;
}

export class EventRefused extends Error {
  constructor(
    readonly reason: RefusalReason,
    readonly address: string,
  ) {
    super(reason);
  }
}

const LUMA_RE = /https:\/\/(?:www\.)?(?:lu\.ma|luma\.com)\/[A-Za-z0-9._~\-/]+/;

const refusalOf = (error: unknown): RefusalReason | undefined => {
  if (!(error instanceof KickbackError)) return undefined;
  if (error.code === "NO_KICKBACK_CONTRACT") return "no-contract";
  if (error.code === "UNKNOWN_CODE") return "look-alike";
  if (error.code === "NOT_KICKBACK") return "not-kickback";
  return undefined;
};

export const eventKey = (contract: string) => ["event", DEFAULT_CHAIN_ID, contract.toLowerCase()] as const;

/**
 * The event at `contract`, read on-chain and checked: the code fingerprint is the Kickback v7 build's,
 * and on a public network the Dispute Resolver is Kleros's own. Anything else throws EventRefused.
 */
export function useEvent(contract: string) {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });

  return useQuery<KickbackEvent, Error>({
    queryKey: eventKey(contract),
    enabled: client !== undefined,
    staleTime: STALE_TIME.live,
    refetchInterval: 10_000,
    retry: (count, error) => !(error instanceof EventRefused) && count < 2,
    queryFn: async () => {
      let info: EventInfo;
      try {
        info = await readEvent(client!, contract);
      } catch (error) {
        const reason = refusalOf(error);
        if (reason) throw new EventRefused(/^0x[0-9a-fA-F]{40}$/.test(contract) ? reason : "not-address", contract);
        throw error;
      }
      if (!isLocalChainEnabled && !isKnownResolverOn(DEFAULT_CHAIN_ID, info.disputeResolver))
        throw new EventRefused("look-alike", contract);

      const caseText = renderCase(info.metaEvidenceTemplate, zeroAddress, info.contract);
      const stakerCount = await client!.readContract({
        address: info.contract,
        abi: kickbackAbi,
        functionName: "stakerCount",
      });
      return {
        ...info,
        clock: eventClock(caseText, info.eventStart),
        lumaUrl: LUMA_RE.exec(caseText)?.[0] ?? knownLumaUrl(DEFAULT_CHAIN_ID, info.contract),
        stakerCount: Number(stakerCount),
      };
    },
  });
}

/** The contract's previewShare for `attend` attendees, when the event has registered guests. */
export function usePreviewShare(contract: Address | undefined, attend: number | undefined) {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  return useQuery({
    queryKey: ["preview-share", DEFAULT_CHAIN_ID, contract?.toLowerCase(), attend],
    enabled: client !== undefined && contract !== undefined && attend !== undefined && attend > 0,
    staleTime: STALE_TIME.live,
    queryFn: () =>
      client!.readContract({
        address: contract!,
        abi: kickbackAbi,
        functionName: "previewShare",
        args: [BigInt(attend!)],
      }),
  });
}

export interface EventDeposits {
  /** Wallets with a deposit. */
  guests: number;
  /** Lower-case wallet → its deposits. */
  byWallet: Map<string, WalletDeposits>;
}

const DEPOSITED = getAbiItem({ abi: kickbackAbi, name: "Deposited" });
const REJECTED = getAbiItem({ abi: kickbackAbi, name: "Rejected" });
const REFUNDED = getAbiItem({ abi: kickbackAbi, name: "Refunded" });
const REGISTERED = getAbiItem({ abi: kickbackAbi, name: "StakerRegistered" });
const PAYOUT = getAbiItem({ abi: kickbackAbi, name: "Payout" });

export const depositsKey = (contract: string) => ["event-deposits", DEFAULT_CHAIN_ID, contract.toLowerCase()] as const;

/** Deposit and payment logs, from `fromBlock` or the searched deploy block. */
export function useEventDeposits(contract: Address | undefined, fromBlock: number | undefined, depositAmount: bigint) {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });

  return useQuery<EventDeposits>({
    queryKey: [...depositsKey(contract ?? ""), fromBlock, depositAmount.toString()],
    enabled: client !== undefined && contract !== undefined,
    staleTime: STALE_TIME.live,
    refetchInterval: 30_000,
    queryFn: async () => {
      const from = fromBlock ?? (await findDeployBlock(client!, contract!));
      const logs = await getLogsChunked(
        {
          getLogs: ({ fromBlock: a, toBlock: b }) =>
            client!.getLogs({
              address: contract!,
              events: [DEPOSITED, REJECTED, REFUNDED, REGISTERED, PAYOUT],
              fromBlock: a,
              toBlock: b,
            }),
          getBlockNumber: () => client!.getBlockNumber({ cacheTime: 0 }),
        },
        from,
      );
      const byWallet = foldGuestLogs(logs, depositAmount);
      return {
        guests: new Set(logs.filter((log) => log.eventName === "Deposited").map((log) => log.args.from?.toLowerCase()))
          .size,
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
