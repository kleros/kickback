"use client";

import { createContext, useContext, useEffect, useState } from "react";

import { errorText, revertName } from "@kickback/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAddressEqual, type Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";

import { EventRefused } from "@/lib/presence";
import { STALE_TIME } from "@/lib/query";
import { useChainTime } from "@/lib/web3/chain-time";
import { useSend, useSendBusy } from "@/lib/web3/send";
import { useRestoringWallet } from "@/lib/web3/useRestoringWallet";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { phaseOf } from "../model/phase";
import { readOrganiser } from "../operations/read";

type Request = { to: Address; data: `0x${string}`; value: bigint };

/** A well-formed contract address (anything else cannot be an event). */
export const isEventAddress = (address: string) => /^0x[0-9a-fA-F]{40}$/.test(address);

export const organiserKey = (address: string) => ["organise", DEFAULT_CHAIN_ID, address.toLowerCase()] as const;

/** One event, read for the shell and every tab under it, plus the one way its tabs send. */
export function useOrganiserEventSource(address: Address) {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  const queries = useQueryClient();
  const overview = useQuery({
    queryKey: organiserKey(address),
    // a link that is no address at all is refused without a read
    enabled: client !== undefined && isEventAddress(address),
    staleTime: STALE_TIME.live,
    // a refusal is final: no retry delay, no polling
    refetchInterval: (q) => (q.state.error instanceof EventRefused ? false : 15_000),
    retry: (count, e) => !(e instanceof EventRefused) && count < 1,
    queryFn: () => readOrganiser(client!, address),
  });
  const { address: account, chainId } = useAccount();
  const restoring = useRestoringWallet();
  const onChain = !!account && chainId === DEFAULT_CHAIN_ID;
  const data = overview.data;
  // the chain's clock, re-read every block: the overview read is up to 15 s old, so a tab could still offer
  // something the contract refuses since the start (or end) passed; take the later of the two
  const chainTime = useChainTime(DEFAULT_CHAIN_ID);
  const now = data ? Math.max(data.now, chainTime.data?.now ?? 0) : undefined;
  const isOwner = !!account && !!data && isAddressEqual(account, data.event.owner);
  // a late challenge still inside its answer time holds up the release: the pill says so
  const phase = data
    ? phaseOf(data.event, now!, data.challenges.filter((c) => c.state === 1 && now! <= c.matchEndsAt).length)
    : null;

  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; at: number } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // a message belongs to the wallet that sent it: drop it on Disconnect or an account switch
  const accountKey = account?.toLowerCase();
  useEffect(() => {
    setError(null);
    setDone(null);
  }, [accountKey]);
  const busy = useSendBusy();
  const send = useSend({
    // awaited, so a tab never offers the same names again before the new list is read
    onSuccess: async () => {
      await Promise.all([
        queries.invalidateQueries({ queryKey: organiserKey(address) }),
        queries.invalidateQueries({ queryKey: ["event", DEFAULT_CHAIN_ID, address.toLowerCase()] }),
      ]);
    },
  });

  /** Sends one request under a label ("Turn away 2"); `success` is said when it is confirmed. */
  const run = (
    label: string,
    request: () => Request | Promise<Request>,
    success: string,
    onSent?: () => void,
    /** Plain words for a contract refusal this action can meet, by its custom error ("TooLate"). */
    refusals?: Record<string, string>,
  ) => {
    setRunning(label);
    setError(null);
    setDone(null);
    send.mutate(
      { expectedAccount: account, prepare: async () => await request() },
      {
        onSuccess: () => {
          setDone(success);
          onSent?.();
        },
        onError: (e) => {
          const name = revertName(e) ?? revertName((e as { cause?: unknown }).cause);
          const known = name ? refusals?.[name] : undefined;
          setError({ text: known ?? (e.message || errorText(e)), at: Date.now() });
          // a refusal means the page is behind the chain: read it again so the controls follow
          if (name) void queries.invalidateQueries({ queryKey: organiserKey(address) });
        },
        onSettled: () => setRunning(null),
      },
    );
  };

  return {
    address,
    overview,
    phase,
    /** The chain's time (seconds): the later of the overview read and the latest block. */
    now,
    isOwner,
    connected: !!account,
    /** wagmi is restoring a saved session on page load: no "Connect" prompt yet. */
    restoring,
    /** Connected, and on the network the event lives on. */
    onChain,
    account,
    run,
    running,
    busy: busy || running !== null,
    error,
    done,
    clearMessages: () => (setError(null), setDone(null)),
  };
}

export type OrganiserEvent = ReturnType<typeof useOrganiserEventSource>;

export const OrganiserEventContext = createContext<OrganiserEvent | null>(null);

export function useOrganiserEvent(): OrganiserEvent {
  const value = useContext(OrganiserEventContext);
  if (!value) throw new Error("useOrganiserEvent is used outside the organiser shell.");
  return value;
}
