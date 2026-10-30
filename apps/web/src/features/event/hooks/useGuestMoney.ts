"use client";

import { useState } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";

import { useSend } from "@/lib/web3/send";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { depositsKey, eventKey } from "../api/useEvent";
import { prepareGuestMoney, readGuestMoney } from "../operations/guestMoney";

const moneyKey = (contract: Address) => ["guest-money", DEFAULT_CHAIN_ID, contract.toLowerCase()] as const;

export function useGuestMoney(contract: Address, deposit: bigint) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  const queries = useQueryClient();
  const [sending, setSending] = useState<{ account?: Address; action: "withdraw" | "claim"; amount?: bigint }>({
    action: "claim",
  });
  const query = useQuery({
    queryKey: [...moneyKey(contract), address?.toLowerCase()],
    enabled: !!client && !!address,
    refetchInterval: 10_000,
    queryFn: () => readGuestMoney(client!, contract, address!),
  });
  const send = useSend({
    record: true,
    onSuccess: async () => {
      await Promise.all(
        [moneyKey(contract), depositsKey(contract), eventKey(contract)].map((queryKey) =>
          queries.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
  const run = (action: "withdraw" | "claim") => {
    const amount = action === "claim" ? query.data?.owed : deposit;
    if (!address || !client || amount === undefined) return;
    setSending({ account: address, action, amount });
    send.mutate({
      expectedAccount: address,
      prepare: () => prepareGuestMoney(client, contract, address, action, amount),
    });
  };
  return {
    query,
    send: { ...sending, status: send.status, error: send.error?.message },
    withdraw: () => run("withdraw"),
    claim: () => run("claim"),
  };
}
