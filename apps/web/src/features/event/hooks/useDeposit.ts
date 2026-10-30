"use client";

import { useState } from "react";

import { kickbackAbi } from "@kickback/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { encodeFunctionData, type Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";

import { useSend } from "@/lib/web3/send";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { depositsKey } from "../api/useEvent";

/** Sends deposit() with value = depositAmount, re-read right before the wallet prompt. */
export function useDeposit(contract: Address, shownAmount: bigint) {
  const { address } = useAccount();
  const [account, setAccount] = useState<Address>();
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  const queryClient = useQueryClient();
  const [startedAt, setStartedAt] = useState<number | undefined>(undefined);

  const send = useSend({
    record: true,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: depositsKey(contract) }),
  });

  const deposit = () => {
    setStartedAt(Date.now());
    setAccount(address);
    send.mutate({
      expectedAccount: address,
      prepare: async () => {
        const amount = await client!.readContract({
          address: contract,
          abi: kickbackAbi,
          functionName: "depositAmount",
        });
        // shown is signed: the amount on the card is the amount sent
        if (amount !== shownAmount) throw new Error("The deposit amount changed. Reload the page.");
        return { to: contract, data: encodeFunctionData({ abi: kickbackAbi, functionName: "deposit" }), value: amount };
      },
    });
  };

  return { ...send, deposit, startedAt, account };
}
