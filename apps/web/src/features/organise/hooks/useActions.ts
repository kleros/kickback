"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";

import { useSend } from "@/lib/web3/send";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { organiserKey, type EventScope } from "../model/shared";
import { prepareAction, type ActionInputs, type OrganiserAction } from "../operations/actions";

function useAction<K extends keyof ActionInputs>(scope: EventScope, name: K) {
  const client = usePublicClient({ chainId: scope.chainId });
  const { address: account } = useAccount();
  const queries = useQueryClient();
  const send = useSend({ record: true });
  return useMutation({
    mutationFn: (input: ActionInputs[K]) =>
      send.mutateAsync({
        prepare: async () => {
          if (!client) throw new Error("The network connection is unavailable.");
          if (scope.chainId !== DEFAULT_CHAIN_ID)
            throw new Error("This app cannot send on the selected event's network.");
          return prepareAction(client, scope, account, { name, input } as OrganiserAction);
        },
      }),
    onSuccess: async () => {
      await queries.invalidateQueries({ queryKey: organiserKey(scope) });
    },
  });
}

export const useRegisterStakers = (scope: EventScope) => useAction(scope, "registerStakers");
export const useRejectAndRefund = (scope: EventScope) => useAction(scope, "rejectAndRefund");
export const usePostAttendance = (scope: EventScope) => useAction(scope, "postAttendance");
export const useAddAttendees = (scope: EventScope) => useAction(scope, "addAttendees");
export const useReleasePayouts = (scope: EventScope) => useAction(scope, "releasePayouts");
export const useResolveChallenge = (scope: EventScope) => useAction(scope, "resolveChallenge");
export const useSweep = (scope: EventScope) => useAction(scope, "sweep");
export const useCancel = (scope: EventScope) => useAction(scope, "cancel");
export const useRefund = (scope: EventScope) => useAction(scope, "refund");
export const useReturnToken = (scope: EventScope) => useAction(scope, "returnToken");
