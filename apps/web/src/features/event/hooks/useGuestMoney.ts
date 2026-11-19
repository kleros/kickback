"use client";

import { useState } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";

import { useSend } from "@/lib/web3/send";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { depositsKey, eventKey } from "../api/useEvent";
import type { MoneyAction } from "../model/depositState";
import { prepareGuestMoney, readGuestMoney } from "../operations/guestMoney";

export const moneyKey = (contract: Address) => ["guest-money", DEFAULT_CHAIN_ID, contract.toLowerCase()] as const;

/** The connected wallet's place in the event, and its calls besides the deposit: approve, challenge, withdraw. */
export function useGuestMoney(contract: Address, token: Address | undefined, depositAmount: bigint, challengeCost: bigint) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  const queries = useQueryClient();
  const [sending, setSending] = useState<{ account?: Address; action: MoneyAction; amount?: bigint }>({
    action: "claim",
  });
  const query = useQuery({
    queryKey: [...moneyKey(contract), address?.toLowerCase()],
    enabled: !!client && !!address,
    refetchInterval: 10_000,
    queryFn: () => readGuestMoney(client!, contract, address!, token),
  });
  const send = useSend({
    onSuccess: async () => {
      await Promise.all(
        [moneyKey(contract), depositsKey(contract), eventKey(contract)].map((queryKey) =>
          queries.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
  const run = (action: MoneyAction) => {
    const data = query.data;
    const amount =
      action === "challenge"
        ? challengeCost
        : action === "approve"
          ? depositAmount
          : data && (data.claimable > 0n ? data.claimable : data.claimableEth);
    if (!address || !client || amount === undefined) return;
    setSending({ account: address, action, amount });
    send.mutate({
      expectedAccount: address,
      prepare: () => prepareGuestMoney(client, contract, address, action, amount, token),
    });
  };
  return {
    query,
    send: { ...sending, status: send.status, error: send.error?.message },
    withdraw: () => run("withdraw"),
    claim: () => run("claim"),
    challenge: () => run("challenge"),
    approve: () => run("approve"),
  };
}
