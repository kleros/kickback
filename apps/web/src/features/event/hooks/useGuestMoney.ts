"use client";

import { useState } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address, Hash } from "viem";
import { useAccount, usePublicClient } from "wagmi";

import { SendError, useSend } from "@/lib/web3/send";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { depositsKey, eventKey } from "../api/useEvent";
import { resolveRefund, type MoneyAction } from "../model/depositState";
import { claimAmount, prepareGuestMoney, readGuestMoney } from "../operations/guestMoney";

export const moneyKey = (contract: Address) => ["guest-money", DEFAULT_CHAIN_ID, contract.toLowerCase()] as const;

/** The connected wallet's place in the event, and its calls besides the deposit: approve, challenge, withdraw. */
export function useGuestMoney(
  contract: Address,
  token: Address | undefined,
  depositAmount: bigint,
  challengeCost: bigint,
) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  const queries = useQueryClient();
  const [sending, setSending] = useState<{
    account?: Address;
    action: MoneyAction;
    amount?: bigint;
    unit?: string;
    /** A "resolve" that puts the guest on the list (an unanswered challenge, or a ruling that they came). */
    joins?: boolean;
    hash?: Hash;
  }>({
    action: "claim",
  });
  const query = useQuery({
    queryKey: [...moneyKey(contract), address?.toLowerCase()],
    enabled: !!client && !!address,
    refetchInterval: 10_000,
    queryFn: () => readGuestMoney(client!, contract, address!, token),
  });
  // recorded, so a reload while it confirms shows "still confirming" instead of offering the same call again
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
  const run = (action: MoneyAction) => {
    const data = query.data;
    const amount =
      action === "challenge"
        ? challengeCost
        : action === "approve"
          ? depositAmount
          : action === "resolve"
            ? data?.challenge.state === 2
              ? resolveRefund(data.challenge)
              : (data?.challenge.deposit ?? 0n)
            : action === "release"
              ? depositAmount
              : data && claimAmount(data.claimable, data.claimableEth, token);
    if (!address || !client || amount === undefined) return;
    // challenge money is ETH even in a token event
    const unit =
      action === "challenge" ||
      action === "resolve" ||
      (token && (action === "claim" || action === "withdraw") && data !== undefined && data.claimable === 0n)
        ? "ETH"
        : undefined;
    const joins =
      action === "resolve" &&
      (data?.challenge.state === 1 || (data?.challenge.state === 2 && data.challenge.ruling === 1));
    setSending({ account: address, action, amount, unit, joins, hash: undefined });
    send.mutate({
      expectedAccount: address,
      onSent: (hash) => setSending((s) => ({ ...s, hash })),
      prepare: () => prepareGuestMoney(client, contract, address, action, amount, token),
    });
  };
  return {
    query,
    send: {
      ...sending,
      status: send.status,
      error: send.error?.message,
      errorKind: send.error instanceof SendError ? send.error.kind : undefined,
    },
    withdraw: () => run("withdraw"),
    claim: () => run("claim"),
    challenge: () => run("challenge"),
    approve: () => run("approve"),
    resolve: () => run("resolve"),
    release: () => run("release"),
  };
}
