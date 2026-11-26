"use client";

import { createContext, useContext, useEffect, useState } from "react";

import { errorText } from "@kickback/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAddressEqual, type Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";

import { STALE_TIME } from "@/lib/query";
import { useSend, useSendBusy } from "@/lib/web3/send";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { phaseOf } from "../model/phase";
import { readOrganiser } from "../operations/read";

type Request = { to: Address; data: `0x${string}`; value: bigint };

export const organiserKey = (address: string) => ["organise", DEFAULT_CHAIN_ID, address.toLowerCase()] as const;

/** One event, read for the shell and every tab under it, plus the one way its tabs send. */
export function useOrganiserEventSource(address: Address) {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  const queries = useQueryClient();
  const overview = useQuery({
    queryKey: organiserKey(address),
    enabled: client !== undefined,
    staleTime: STALE_TIME.live,
    refetchInterval: 15_000,
    retry: 1,
    queryFn: () => readOrganiser(client!, address),
  });
  const { address: account, chainId, status } = useAccount();
  const onChain = !!account && chainId === DEFAULT_CHAIN_ID;
  const data = overview.data;
  const isOwner = !!account && !!data && isAddressEqual(account, data.event.owner);
  // a late challenge still inside its answer time holds up the release: the pill says so
  const phase = data
    ? phaseOf(data.event, data.now, data.challenges.filter((c) => c.state === 1 && data.now <= c.matchEndsAt).length)
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
  const run = (label: string, request: () => Request | Promise<Request>, success: string, onSent?: () => void) => {
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
        onError: (e) => setError({ text: e.message || errorText(e), at: Date.now() }),
        onSettled: () => setRunning(null),
      },
    );
  };

  return {
    address,
    overview,
    phase,
    isOwner,
    connected: !!account,
    /** wagmi is restoring a saved session on page load: no "Connect" prompt yet. */
    restoring: !account && status === "reconnecting",
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
