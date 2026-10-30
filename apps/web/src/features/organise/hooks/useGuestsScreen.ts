"use client";

import { useRef, useState } from "react";

import type { Config, StampedList } from "@kickback/core";
import { formatEther } from "viem";

import { useSendBusy } from "@/lib/web3/send";

import { paths } from "@/config/paths";

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

  const inFlight = useRef(false);
  const [frozen, setFrozen] = useState<{
    action: "register" | "refund";
    lists: StampedList[];
    wallets: string[];
    total: bigint;
  } | null>(null);
  const rows = guests.rows.map((row) => ({
    ...row,
    returnHref:
      row.returnAmount === null
        ? null
        : `${paths.organiseEvent.getHref(scope.address, cfg.deployBlock, "payout")}${cfg.deployBlock === undefined ? "?" : "&"}${new URLSearchParams({ returnTo: row.wallet, returnAmount: formatEther(row.returnAmount) })}`,
  }));
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

  const open = (action: "register" | "refund") => {
    if (busy || inFlight.current) return;
    setError(null);
    try {
      const lists = guests
        .selectedBatches(action)
        .map((list) => ({ ...list, items: list.items.map((item) => ({ ...item })) }));
      const wallets = lists.flatMap((list) => list.items.map((item) => item.wallet));
      if (!wallets.length) return;
      setFrozen({
        action,
        lists,
        wallets,
        total: lists.reduce((sum, list) => sum + BigInt(list.deposit) * BigInt(list.items.length), 0n),
      });
    } catch (caught) {
      setError({ text: errorMessage(caught), at: Date.now() });
    }
  };
  const run = async () => {
    if (!frozen || busy || inFlight.current) return;
    inFlight.current = true;
    const { action, lists } = frozen;
    setError(null);
    setDone(null);
    setRunning(action);
    try {
      const mutation = action === "register" ? register : refund;
      await runGuestBatches(
        lists,
        (list) => mutation.mutateAsync({ list }),
        (remaining) => guests.refreshBatches(remaining, action),
      );
      const total = lists.reduce((sum, list) => sum + list.items.length, 0);
      setFrozen(null);
      setDone(action === "register" ? `Registered ${total}.` : `Refunded ${total}.`);
    } catch (caught) {
      setError({ text: errorMessage(caught), at: Date.now() });
    } finally {
      inFlight.current = false;
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
    frozen,
    close: () => {
      if (!busy && !inFlight.current) setFrozen(null);
    },
    confirm: run,
    register: () => open("register"),
    refund: () => open("refund"),
  };
}

export type GuestsScreenModel = ReturnType<typeof useGuestsScreen>;
