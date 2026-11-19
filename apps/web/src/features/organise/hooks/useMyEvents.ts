"use client";

import { eventsOf } from "@kickback/core";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { PROTOCOL } from "@/config/protocol";

import { readDeployments } from "../model/browserEvents";

/** Events this browser created on the app's chain. */
export function useBrowserEvents() {
  const query = useQuery({
    queryKey: ["organise", "deployments"],
    queryFn: () => readDeployments(),
    staleTime: Infinity,
  });
  return (query.data ?? []).filter((row) => row.chainId === DEFAULT_CHAIN_ID);
}

/** The events the connected wallet organises, from the factory, newest first. */
export function useMyEvents() {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  const { address } = useAccount();
  return useQuery({
    queryKey: ["organise", "mine", DEFAULT_CHAIN_ID, address?.toLowerCase()],
    enabled: !!client && !!address && PROTOCOL !== null,
    queryFn: async () => (await eventsOf(client!, PROTOCOL!.factory, address!)) as Address[],
  });
}
