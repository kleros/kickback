"use client";

import { useState } from "react";

import type { BuildPayoutResult, Config, RegistrationRow } from "@kickback/core";
import { getAddress } from "viem";

import { useSendBusy } from "@/lib/web3/send";

import { useAddAttendees, usePostAttendance } from "./useActions";
import { useAttendancePlan } from "./useAttendancePlan";
import { useGuests } from "./useGuests";
import { errorMessage } from "./useGuestsScreen";
import type { EventScope } from "../model/shared";
import { openable, TYPED_WORDS } from "../model/view";

export interface LoadedFile {
  name: string;
  text: string;
  rows: number;
}

/** Only what buildPayout reads; the check's rows carry bigints, which a query key cannot hold. */
const registration = (row: RegistrationRow): RegistrationRow => ({
  wallet: row.wallet,
  name: row.name,
  email: row.email,
  approval: row.approval,
});

const rowCount = (text: string) => Math.max(0, text.trim().split(/\r?\n/).length - 1);

/** What the POST dialog shows and sends: frozen when it opens, so the figures signed are the figures read. */
export interface FrozenAttendance {
  plan: BuildPayoutResult;
  attendees: number;
  registered: number;
  noShows: number;
  unmatched: number;
  share: bigint;
}

/**
 * The attendance tab. The Luma export after the event is checked like the guest list, so a check-in counts
 * through the registration that verified the wallet; a door list may add wallets or emails.
 */
export function useAttendanceScreen(cfg: Config, scope: EventScope) {
  const [checkin, setCheckin] = useState<LoadedFile | null>(null);
  const [door, setDoor] = useState<LoadedFile | null>(null);
  const guests = useGuests(cfg);
  const check = checkin ? guests.data?.check : undefined;
  const waitingForCheck = !!checkin && !check;
  const input =
    (checkin || door) && !waitingForCheck
      ? {
          checkinCsv: checkin?.text ?? null,
          ...(door ? { doorCsv: door.text } : {}),
          verified: check?.verified.map(registration),
          claims: check?.claims.map(registration),
        }
      : null;
  const plan = useAttendancePlan(cfg, input, TYPED_WORDS.post, TYPED_WORDS.noShow);
  const post = usePostAttendance(scope);
  const add = useAddAttendees(scope);
  const [wallets, setWallets] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const busy = useSendBusy();
  const [frozen, setFrozen] = useState<FrozenAttendance | null>(null);
  const [error, setError] = useState<string | null>(null);

  const data = plan.data;
  const gate = openable(plan.gates.post, `type ${TYPED_WORDS.post}`, `type ${TYPED_WORDS.noShow}`);

  return {
    correction: {
      wallets,
      setWallets,
      open: addOpen,
      gate: plan.gates.add,
      pending: add.isPending,
      done: add.isSuccess,
      show: () => {
        setError(null);
        setAddOpen(true);
      },
      close: () => {
        if (!add.isPending) setAddOpen(false);
      },
      confirm: async () => {
        setError(null);
        try {
          const selected = wallets
            .trim()
            .split(/[\s,]+/)
            .filter(Boolean)
            .map((wallet) => getAddress(wallet));
          await add.mutateAsync({ wallets: selected });
          setAddOpen(false);
          setWallets("");
        } catch (caught) {
          setError(errorMessage(caught));
        }
      },
    },
    checkin,
    door,
    loadCheckin: (name: string, text: string) => {
      setCheckin({ name, text, rows: rowCount(text) });
      guests.loadCsv(text);
    },
    loadDoor: (name: string, text: string) => setDoor({ name, text, rows: rowCount(text) }),
    building: waitingForCheck || (input !== null && plan.isFetching),
    buildError: plan.error ? errorMessage(plan.error) : guests.error && checkin ? errorMessage(guests.error) : null,
    figures: data
      ? {
          attendees: data.attendees,
          registered: data.registered,
          noShows: data.noShows,
          unmatched: data.unmatchedStakers.length,
          share: data.share,
        }
      : null,
    downloads: data ? data.downloads : null,
    post: gate,
    frozen,
    open: () => {
      if (!data) return;
      setError(null);
      setFrozen({
        plan: data.plan,
        attendees: data.attendees,
        registered: data.registered,
        noShows: data.noShows,
        unmatched: data.unmatchedStakers.length,
        share: data.share,
      });
    },
    close: () => {
      if (!post.isPending) setFrozen(null);
    },
    confirm: async (confirmation: string, noShowConfirmation: string) => {
      if (!frozen) return;
      setError(null);
      try {
        await post.mutateAsync({ plan: frozen.plan, confirmation, noShowConfirmation });
        setFrozen(null);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    posting: post.isPending,
    posted: post.isSuccess,
    busy,
    error,
  };
}

export type AttendanceScreenModel = ReturnType<typeof useAttendanceScreen>;
