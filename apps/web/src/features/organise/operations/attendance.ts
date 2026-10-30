import { kickbackAbi } from "@kickback/contracts";
import { buildPayout, parseCsv, type Config, type RegistrationRow } from "@kickback/core";
import type { PublicClient } from "viem";

import { pinnedRead } from "./pinned";
import { attendanceModel } from "../model/attendance";

export interface AttendanceInput {
  checkinCsv: string | null;
  doorCsv?: string;
  verified?: readonly RegistrationRow[];
  claims?: readonly RegistrationRow[];
}

export async function readAttendancePlan(client: PublicClient, cfg: Config, input: AttendanceInput) {
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const readContract = pinnedRead(client, blockNumber);
  const plan = await buildPayout({
    client: { readContract },
    cfg,
    checkins: input.checkinCsv === null ? null : parseCsv(input.checkinCsv),
    extra: input.doorCsv === undefined ? undefined : parseCsv(input.doorCsv),
    verified: input.verified,
    claims: input.claims,
    title: cfg.eventName,
  });
  const share = await readContract({
    address: cfg.receiver,
    abi: kickbackAbi,
    functionName: "previewShare",
    args: [BigInt(plan.attendees.length)],
  });
  return { ...attendanceModel(plan, share), blockNumber };
}
