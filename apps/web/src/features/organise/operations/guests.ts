import { kickbackAbi } from "@kickback/contracts";
import { checkGuests, depositsOverview, getLogsChunked, parseCsv, type Config, type StampedList } from "@kickback/core";
import { getAbiItem, getAddress, type PublicClient } from "viem";

import { guestRows, snapshotRefusal, type Ticks } from "../model/guests";
import { requireEnabled } from "../model/shared";

export async function readGuests(client: PublicClient, cfg: Config, csv: string | null) {
  const overview = await depositsOverview({ client, cfg, scanFrom: cfg.deployBlock });
  const check =
    csv === null ? null : await checkGuests({ client, cfg, rows: parseCsv(csv), scanFrom: cfg.deployBlock });
  const snapshotBlock =
    check?.snapshotBlock ?? overview.check?.snapshotBlock ?? Number(await client.getBlockNumber({ cacheTime: 0 }));
  return {
    overview,
    check,
    snapshotBlock,
    stamp: { contract: cfg.receiver, chainId: cfg.chainId, deposit: cfg.depositUnits.toString(), block: snapshotBlock },
    statusOf: (check ?? overview.check)?.statusOf ?? new Map<string, number>(),
  };
}
export type GuestsData = Awaited<ReturnType<typeof readGuests>>;

export function selectedGuestList(data: GuestsData, ticks: Ticks, action: "register" | "refund"): StampedList {
  const selected = guestRows(data.overview.deposits, data.check, ticks).filter((r) => r.tick === action);
  return {
    ...data.stamp,
    generatedAt: "",
    items: selected.map((r) => ({
      wallet: r.wallet,
      name: r.name,
      email: "",
      onchain: undefined,
      status: data.statusOf.get(r.wallet.toLowerCase()),
    })),
  };
}

const RELEVANT_EVENTS = [
  "Deposited",
  "Rejected",
  "Refunded",
  "StakerRegistered",
  "AttendancePosted",
  "Cancelled",
] as const;
const events = RELEVANT_EVENTS.map((name) => getAbiItem({ abi: kickbackAbi, name }));

export async function checkSnapshot(
  client: PublicClient,
  cfg: Pick<Config, "receiver" | "chainId" | "logChunk">,
  list: StampedList,
) {
  const block = await client.getBlockNumber({ cacheTime: 0 });
  const deposit = await client.readContract({
    address: cfg.receiver,
    abi: kickbackAbi,
    functionName: "depositAmount",
    blockNumber: block,
  });
  requireEnabled(
    snapshotRefusal(list, {
      contract: cfg.receiver,
      chainId: cfg.chainId,
      deposit,
      block: Number(block),
      relevantLogs: 0,
      statusChanged: false,
    }),
  );
  const status = await Promise.all(
    list.items.map((i) =>
      client.readContract({
        address: cfg.receiver,
        abi: kickbackAbi,
        functionName: "status",
        args: [getAddress(i.wallet)],
        blockNumber: block,
      }),
    ),
  );
  const logs = await getLogsChunked(
    { getLogs: (range) => client.getLogs({ address: cfg.receiver, events, ...range }) },
    list.block + 1,
    block,
    cfg.logChunk,
  );
  requireEnabled(
    snapshotRefusal(list, {
      contract: cfg.receiver,
      chainId: cfg.chainId,
      deposit,
      block: Number(block),
      relevantLogs: logs.length,
      statusChanged: status.some((s, i) => Number(s) !== list.items[i]?.status),
    }),
  );
}

export function refreshRemainingBatches(data: GuestsData, lists: StampedList[], action: "register" | "refund") {
  const rows = guestRows(data.overview.deposits, data.check);
  for (const list of lists) {
    if (
      list.contract.toLowerCase() !== data.stamp.contract.toLowerCase() ||
      list.chainId !== data.stamp.chainId ||
      list.deposit !== data.stamp.deposit ||
      data.stamp.block < list.block
    )
      throw new Error("The event snapshot changed; check the list again.");
  }
  return lists.map((list) => ({
    ...list,
    ...data.stamp,
    items: list.items.map((item) => {
      const eligible = rows.some(
        (row) =>
          row.wallet.toLowerCase() === item.wallet.toLowerCase() &&
          (action === "register" ? row.canRegister.enabled : row.canRefund.enabled),
      );
      const status = data.statusOf.get(item.wallet.toLowerCase());
      if (!eligible || status !== item.status)
        throw new Error("The remaining guests changed; check the list again. Your ticks are kept.");
      return { ...item, status };
    }),
  }));
}

export async function runGuestBatches(
  lists: StampedList[],
  send: (list: StampedList) => Promise<unknown>,
  refresh: (remaining: StampedList[]) => Promise<StampedList[]>,
) {
  let remaining = lists;
  while (remaining.length) {
    await send(remaining[0]!);
    remaining = remaining.slice(1);
    if (remaining.length) remaining = await refresh(remaining);
  }
}
