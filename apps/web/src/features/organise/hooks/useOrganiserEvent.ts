"use client";

import { createContext, useContext, useMemo } from "react";

import { isAddressEqual, type Address } from "viem";
import { useAccount } from "wagmi";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { networkFor } from "@/config/kleros";

import { useEventOverview } from "./useEventOverview";
import { readDeployments } from "../model/create";
import type { EventScope } from "../model/shared";

/** The block deposits are read from: the link's `from`, else this browser's record of the deploy. */
export function deployBlockFor(address: Address, from: string | undefined): number | undefined {
  if (from !== undefined && /^\d+$/.test(from)) return Number(from);
  return readDeployments().find((row) => row.chainId === DEFAULT_CHAIN_ID && isAddressEqual(row.address, address))
    ?.block;
}

/** One event's overview, read once for the shell and every tab under it. */
export function useOrganiserEventSource(address: Address, from?: string) {
  const deployBlock = useMemo(() => deployBlockFor(address, from), [address, from]);
  const scope: EventScope = useMemo(
    () => ({ chainId: DEFAULT_CHAIN_ID, address, deployBlock }),
    [address, deployBlock],
  );
  const network = useMemo(() => networkFor(DEFAULT_CHAIN_ID), []);
  const overview = useEventOverview(scope, network);
  const { address: account } = useAccount();
  const isOwner = !!account && !!overview.data && isAddressEqual(account, overview.data.event.owner);
  return { scope, overview, isOwner, connected: !!account };
}

export type OrganiserEvent = ReturnType<typeof useOrganiserEventSource>;

export const OrganiserEventContext = createContext<OrganiserEvent | null>(null);

export function useOrganiserEvent(): OrganiserEvent {
  const value = useContext(OrganiserEventContext);
  if (!value) throw new Error("useOrganiserEvent is used outside the organiser shell.");
  return value;
}
