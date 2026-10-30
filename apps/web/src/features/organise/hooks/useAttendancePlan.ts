"use client";

import type { Config } from "@kickback/core";
import { useQuery } from "@tanstack/react-query";
import { isAddressEqual } from "viem";
import { useAccount, usePublicClient } from "wagmi";

import { useChainTime } from "@/lib/web3/chain-time";

import { attendanceGates } from "../model/attendance";
import { organiserKey, configKey, gate } from "../model/shared";
import { readAttendancePlan, type AttendanceInput } from "../operations/attendance";
import { readEventState } from "../operations/read";

export function useAttendancePlan(
  cfg: Config,
  input: AttendanceInput | null,
  confirmation = "",
  noShowConfirmation = "",
) {
  const client = usePublicClient({ chainId: cfg.chainId });
  const { address: account } = useAccount();
  const time = useChainTime(cfg.chainId);
  const scope = { chainId: cfg.chainId, address: cfg.receiver };
  const state = useQuery({
    queryKey: [...organiserKey(scope), "attendance-state", time.data?.blockNumber.toString()],
    queryFn: () => readEventState(client!, scope),
    enabled: !!client,
    retry: false,
  });
  const query = useQuery({
    queryKey: [...organiserKey(scope), "attendance", configKey(cfg), input],
    queryFn: () => readAttendancePlan(client!, cfg, input!),
    enabled: !!client && input !== null,
    retry: false,
  });
  const gates =
    state.data && !state.isError
      ? attendanceGates(
          state.data.event,
          state.data.now,
          state.data.challengeEndsAt,
          query.isError ? undefined : query.data?.plan,
          confirmation,
          noShowConfirmation,
          !!account && isAddressEqual(account, state.data.event.owner),
        )
      : { post: gate("Read the event before posting."), add: gate("Read the event before adding guests.") };
  return { ...query, gates, eventError: state.error };
}
