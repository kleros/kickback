"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { getAccount, getConnectorClient, getPublicClient, sendTransaction } from "@wagmi/core";
import type { Address } from "viem";
import { getChainId } from "viem/actions";
import { useAccount } from "wagmi";
import { useStore } from "zustand";

import { wagmiConfig } from "@/lib/web3/wagmi";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { sendLock } from "./lock";
import { sendTx, type SendArgs, type SendDeps, type SendWallet } from "./send";
import { createSentTxStore, reconcileSentTx } from "./sentTx";
import * as stub from "./stubs";

const browserStorage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

/** The browser's record of sent transactions, shared by every send and watcher in the tab. */
export const sentTxStore = createSentTxStore(browserStorage());

const publicClient = () => {
  const client = getPublicClient(wagmiConfig, { chainId: DEFAULT_CHAIN_ID });
  if (!client) throw new Error(`No RPC configured for chain ${DEFAULT_CHAIN_ID}.`);
  return client;
};

const wagmiWallet: SendWallet = {
  getAddress: () => getAccount(wagmiConfig).address,
  getChainId: async () => getChainId(await getConnectorClient(wagmiConfig)),
  sendTransaction: (request) => sendTransaction(wagmiConfig, request),
};

export interface UseSendOptions {
  errorText?: SendDeps["errorText"];
  gasLimitFor?: SendDeps["gasLimitFor"];
  /** Record the transaction in the browser until it settles, for `useSentTx` after a reload. */
  record?: boolean;
  onSuccess?: () => void;
}

/** The one way a write reaches the wallet. `args.prepare` re-reads and builds the request. */
export function useSend({ errorText, gasLimitFor, record = false, onSuccess }: UseSendOptions = {}) {
  return useMutation({
    mutationFn: (args: SendArgs) =>
      sendTx(
        {
          client: publicClient(),
          wallet: wagmiWallet,
          chainId: DEFAULT_CHAIN_ID,
          errorText: errorText ?? stub.errorText,
          gasLimitFor: gasLimitFor ?? stub.gasLimitFor,
          sent: record ? sentTxStore : undefined,
        },
        args,
      ),
    onSuccess,
  });
}

/** True while any send is under way, to grey out every other action. */
export const useSendBusy = () => useStore(sendLock, (state) => state.busy);

/** How often a pending record is checked again. */
const SENT_TX_POLL_MS = 4_000;

/** The connected account's last send to `contract` from this browser, checked until it settles. */
export function useSentTx(contract: Address | undefined) {
  const { address } = useAccount();

  return useQuery({
    queryKey: ["sent-tx", DEFAULT_CHAIN_ID, contract?.toLowerCase(), address?.toLowerCase()],
    queryFn: () =>
      reconcileSentTx(
        publicClient(),
        sentTxStore,
        { chainId: DEFAULT_CHAIN_ID, contract: contract!, account: address! },
        Date.now(),
      ),
    enabled: contract !== undefined && address !== undefined,
    staleTime: 0,
    refetchInterval: (query) => (query.state.data?.outcome === "pending" ? SENT_TX_POLL_MS : false),
  });
}
