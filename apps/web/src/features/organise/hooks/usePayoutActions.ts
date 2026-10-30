"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";

import { useChainTime } from "@/lib/web3/chain-time";

import { organiserKey, type EventScope } from "../model/shared";
import { readPayoutActions, type PayoutInput } from "../operations/payout";

export function usePayoutActions(scope: EventScope, input: PayoutInput = {}) {
  const client = usePublicClient({ chainId: scope.chainId });
  const { address: account } = useAccount();
  const time = useChainTime(scope.chainId);
  return useQuery({
    queryKey: [
      ...organiserKey(scope),
      "payout",
      account,
      input.confirmation,
      input.amount?.toString(),
      input.token,
      input.guest,
      time.data?.blockNumber.toString(),
    ],
    queryFn: () => readPayoutActions(client!, scope, account, input),
    enabled: !!client,
    retry: false,
  });
}
