"use client";

import { createContext, useContext, useState } from "react";

import { errorText } from "@kickback/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAddressEqual, type Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";

import { STALE_TIME } from "@/lib/query";
import { useSend, useSendBusy } from "@/lib/web3/send";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { phaseOf } from "../model/phase";
import { readOrganiser } from "../operations/read";

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
  const { address: account } = useAccount();
  const data = overview.data;
  const isOwner = !!account && !!data && isAddressEqual(account, data.event.owner);
  const phase = data ? phaseOf(data.event, data.now) : null;

  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; at: number } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const busy = useSendBusy();
  const send = useSend({
    onSuccess: () => {
      void queries.invalidateQueries({ queryKey: organiserKey(address) });
      void queries.invalidateQueries({ queryKey: ["event", DEFAULT_CHAIN_ID, address.toLowerCase()] });
    },
  });

  /** Sends one request under a label ("Turn away 2"); `success` is said when it is confirmed. */
  const run = (label: string, request: () => { to: Address; data: `0x${string}`; value: bigint }, success: string) => {
    setRunning(label);
    setError(null);
    setDone(null);
    send.mutate(
      { expectedAccount: account, prepare: async () => request() },
      {
        onSuccess: () => setDone(success),
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
