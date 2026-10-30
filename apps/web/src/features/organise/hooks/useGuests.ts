"use client";

import { useState } from "react";

import type { Config } from "@kickback/core";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";

import { batchLists, guestRows, type Tick, type Ticks } from "../model/guests";
import { organiserKey, configKey } from "../model/shared";
import { readGuests, selectedGuestList } from "../operations/guests";

export function useGuests(cfg: Config) {
  const client = usePublicClient({ chainId: cfg.chainId });
  const identity = `${cfg.chainId}:${cfg.receiver.toLowerCase()}`;
  const [files, setFiles] = useState<Record<string, string | null>>({});
  const [selections, setSelections] = useState<Record<string, Ticks>>({});
  const csv = files[identity] ?? null;
  const ticks = selections[identity] ?? {};
  const query = useQuery({
    queryKey: [...organiserKey({ chainId: cfg.chainId, address: cfg.receiver }), "guests", configKey(cfg), csv],
    queryFn: () => readGuests(client!, cfg, csv),
    enabled: !!client,
    retry: false,
    staleTime: Infinity,
  });
  const rows = query.data ? guestRows(query.data.overview.deposits, query.data.check, ticks) : [];
  return {
    ...query,
    rows,
    csvLoaded: csv !== null,
    loadCsv: (text: string | null) => setFiles((old) => ({ ...old, [identity]: text })),
    setTick: (id: string, tick: Tick) =>
      setSelections((old) => ({ ...old, [identity]: { ...old[identity], [id]: tick } })),
    selectedBatches: (action: "register" | "refund") => {
      if (!query.data) throw new Error("Check the guests first.");
      return batchLists(selectedGuestList(query.data, ticks, action));
    },
    selectedList: (action: "register" | "refund") => {
      if (!query.data) throw new Error("Check the guests first.");
      return selectedGuestList(query.data, ticks, action);
    },
  };
}
