"use client";

import { useState } from "react";

import { presenceEventAbi } from "@kickback/contracts";
import { isEth } from "@kickback/core";
import { useQueryClient } from "@tanstack/react-query";
import { encodeFunctionData, type Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";

import { useSend } from "@/lib/web3/send";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { moneyKey } from "./useGuestMoney";
import { depositsKey, eventKey } from "../api/useEvent";

/**
 * Sends deposit(), with value = depositAmount for an ETH event and no ETH for a token event (approved first).
 * The amount is re-read right before the wallet prompt.
 */
export function useDeposit(contract: Address, token: Address, shownAmount: bigint) {
  const { address } = useAccount();
  const [account, setAccount] = useState<Address>();
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  const queryClient = useQueryClient();
  const [startedAt, setStartedAt] = useState<number | undefined>(undefined);

  const send = useSend({
    record: true,
    onSuccess: () => {
      for (const queryKey of [depositsKey(contract), moneyKey(contract), eventKey(contract)])
        void queryClient.invalidateQueries({ queryKey });
    },
  });

  const deposit = () => {
    setStartedAt(Date.now());
    setAccount(address);
    send.mutate({
      expectedAccount: address,
      prepare: async () => {
        const amount = await client!.readContract({
          address: contract,
          abi: presenceEventAbi,
          functionName: "depositAmount",
        });
        // shown is signed: the amount on the card is the amount sent
        if (amount !== shownAmount) throw new Error("The deposit amount changed. Reload the page.");
        return {
          to: contract,
          data: encodeFunctionData({ abi: presenceEventAbi, functionName: "deposit" }),
          value: isEth(token) ? amount : 0n,
        };
      },
    });
  };

  return { ...send, deposit, startedAt, account };
}
