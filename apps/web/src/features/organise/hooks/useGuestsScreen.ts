"use client";

import { useState } from "react";

import type { Config } from "@kickback/core";

import { useSendBusy } from "@/lib/web3/send";

import { useRegisterStakers, useRejectAndRefund } from "./useActions";
import { useGuests } from "./useGuests";
import type { EventScope } from "../model/shared";
import { runGuestBatches } from "../operations/guests";

export type GuestFilter = "all" | "register" | "refund" | "look";

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The guests tab: the Luma check, the tick columns, and register or refund in batches of 100. */
export function useGuestsScreen(cfg: Config, scope: EventScope) {
  const guests = useGuests(cfg);
  const register = useRegisterStakers(scope);
  const refund = useRejectAndRefund(scope);
  const busy = useSendBusy();
  const [file, setFile] = useState<string | null>(null);
  const [filter, setFilter] = useState<GuestFilter>("all");
  const [running, setRunning] = useState<"register" | "refund" | null>(null);
  const [error, setError] = useState<{ text: string; at: number } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const rows = guests.rows;
  const toRegister = rows.filter((r) => r.tick === "register").length;
  const toRefund = rows.filter((r) => r.tick === "refund").length;
  const counts: Record<GuestFilter, number> = {
    all: rows.length,
    register: rows.filter((r) => r.canRegister.enabled).length,
    refund: rows.filter((r) => r.canRefund.enabled).length,
    look: rows.filter((r) => !r.canRegister.enabled && !r.canRefund.enabled && r.status !== "Registered").length,
  };
  const shown = rows.filter((r) =>
    filter === "register"
      ? r.canRegister.enabled
      : filter === "refund"
        ? r.canRefund.enabled
        : filter === "look"
          ? !r.canRegister.enabled && !r.canRefund.enabled && r.status !== "Registered"
          : true,
  );

  const run = async (action: "register" | "refund") => {
    setError(null);
    setDone(null);
    setRunning(action);
    try {
      const lists = guests.selectedBatches(action);
      const mutation = action === "register" ? register : refund;
      await runGuestBatches(
        lists,
        (list) => mutation.mutateAsync({ list }),
        (remaining) => guests.refreshBatches(remaining, action),
      );
      const total = lists.reduce((sum, list) => sum + list.items.length, 0);
      setDone(action === "register" ? `Registered ${total}.` : `Refunded ${total}.`);
    } catch (caught) {
      setError({ text: errorMessage(caught), at: Date.now() });
    } finally {
      setRunning(null);
    }
  };

  return {
    rows: shown,
    total: rows.length,
    counts,
    filter,
    setFilter,
    loading: guests.isPending,
    readError: guests.error ? errorMessage(guests.error) : null,
    file,
    csvLoaded: guests.csvLoaded,
    checking: guests.isFetching,
    loadCsv: (name: string, text: string) => {
      setFile(name);
      setError(null);
      setDone(null);
      guests.loadCsv(text);
    },
    checkAgain: () => void guests.refetch(),
    setTick: guests.setTick,
    toRegister,
    toRefund,
    running,
    busy,
    error,
    done,
    register: () => void run("register"),
    refund: () => void run("refund"),
  };
}

export type GuestsScreenModel = ReturnType<typeof useGuestsScreen>;
