"use client";

import { errorText as coreErrorText, gasLimitFor as coreGasLimitFor } from "@kickback/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAccount, getConnectorClient, getPublicClient, sendTransaction } from "@wagmi/core";
import type { Address } from "viem";
import { getChainId } from "viem/actions";
import { useAccount } from "wagmi";
import { useStore } from "zustand";

import { MOCK_CONNECTOR_ID } from "@/lib/web3/mock-account";
import { wagmiConfig } from "@/lib/web3/wagmi";

import { DEFAULT_CHAIN_ID, isDevWalletOnly } from "@/config/chains";

import { sendLock } from "./lock";
import { sendTx, type SendArgs, type SendDeps, type SendWallet } from "./send";
import { createSentTxStore, reconcileSentTx, type SentTx } from "./sentTx";

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

function wagmiWallet(): SendWallet {
  const { connector } = getAccount(wagmiConfig);
  return {
    getAddress: () => {
      const current = getAccount(wagmiConfig);
      return connector && current.connector?.uid === connector.uid ? current.address : undefined;
    },
    isDevWallet: () => connector?.id === MOCK_CONNECTOR_ID,
    getChainId: async () => getChainId(await getConnectorClient(wagmiConfig, { connector })),
    sendTransaction: (request) => sendTransaction(wagmiConfig, { ...request, connector }),
  };
}

const sentTxQueryKey = (chainId: number, contract: Address | undefined, account: Address | undefined) =>
  ["sent-tx", chainId, contract?.toLowerCase(), account?.toLowerCase()] as const;

export interface UseSendOptions {
  errorText?: SendDeps["errorText"];
  gasLimitFor?: SendDeps["gasLimitFor"];
  /** Record the transaction in the browser until it settles, for `useSentTx` after a reload. */
  record?: boolean;
  onSuccess?: () => void | Promise<unknown>;
  onError?: (error: Error) => void;
}

/** The one way a write reaches the wallet. `args.prepare` re-reads and builds the request. */
export function useSend({ errorText, gasLimitFor, record = false, onSuccess, onError }: UseSendOptions = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: SendArgs) => {
      let saved: SentTx | undefined;
      const receipt = await sendTx(
        {
          client: publicClient(),
          wallet: wagmiWallet(),
          chainId: DEFAULT_CHAIN_ID,
          errorText: errorText ?? coreErrorText,
          gasLimitFor: gasLimitFor ?? coreGasLimitFor,
          sent: record
            ? {
                ...sentTxStore,
                save: (record) => {
                  saved = record;
                  sentTxStore.save(record);
                  const queryKey = sentTxQueryKey(record.chainId, record.contract, record.account);
                  // An older reconciliation must not overwrite the newly sent hash.
                  void queryClient.cancelQueries({ queryKey, exact: true });
                  queryClient.setQueryData(queryKey, { record, outcome: "pending" });
                },
              }
            : undefined,
          devWalletOnly: isDevWalletOnly,
        },
        args,
      );
      // the receipt is in: the record is mined now, not at the next poll (a page reading "pending" would
      // call the guest's own transaction "an earlier one" for a few seconds)
      if (saved) {
        const queryKey = sentTxQueryKey(saved.chainId, saved.contract, saved.account);
        const current = sentTxStore.read(saved.chainId, saved.contract, saved.account) ?? saved; // a fee bump's hash
        void queryClient.cancelQueries({ queryKey, exact: true });
        queryClient.setQueryData(queryKey, { record: current, outcome: "mined" });
      }
      return receipt;
    },
    onSuccess,
    onError,
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
    queryKey: sentTxQueryKey(DEFAULT_CHAIN_ID, contract, address),
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
