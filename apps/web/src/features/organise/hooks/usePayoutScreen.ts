"use client";

import { useState } from "react";

import { parseEther, type Address } from "viem";

import { useSendBusy } from "@/lib/web3/send";

import { useCancel, useRefund, useRejectAndRefund, useReleasePayouts, useReturnToken, useSweep } from "./useActions";
import { errorMessage } from "./useGuestsScreen";
import { usePayoutActions } from "./usePayoutActions";
import type { EventScope, Gate } from "../model/shared";
import { openable, TYPED_WORDS } from "../model/view";

export type RareAction = "sweep" | "refund" | "removeGuest" | "cancel" | "returnToken";

/** Figures frozen when a dialog opens; the send refuses if the chain has moved from them. */
export type Frozen =
  | { action: "release"; pool: bigint; attendees: number; share: bigint; heldBack: bigint }
  | { action: "sweep"; spare: bigint }
  | { action: "cancel"; registered: number; refundTotal: bigint }
  | { action: "refund"; spare: bigint }
  | { action: "removeGuest" }
  | { action: "returnToken" };

const parseAmount = (text: string): bigint | undefined => {
  try {
    return text.trim() ? parseEther(text.trim()) : undefined;
  } catch {
    return undefined;
  }
};
const asAddress = (text: string) => (/^0x[0-9a-fA-F]{40}$/.test(text.trim()) ? (text.trim() as Address) : undefined);

/** The payout tab: release, then the rare actions under one More menu, each with a typed or filled confirm. */
export function usePayoutScreen(scope: EventScope, deposit: bigint) {
  const actions = usePayoutActions(scope);
  const [frozen, setFrozen] = useState<Frozen | null>(null);
  const [fields, setFields] = useState({ to: "", amount: "", guest: "", token: "" });
  const dialogInput = {
    amount:
      frozen?.action === "refund"
        ? parseAmount(fields.amount)
        : frozen?.action === "returnToken" && /^\d+$/.test(fields.amount)
          ? BigInt(fields.amount)
          : undefined,
    token: frozen?.action === "returnToken" ? asAddress(fields.token) : undefined,
    guest: frozen?.action === "removeGuest" ? asAddress(fields.guest) : undefined,
  };
  const dialogRead = usePayoutActions(
    scope,
    frozen && (dialogInput.amount || dialogInput.guest || dialogInput.token) ? dialogInput : {},
  );
  const release = useReleasePayouts(scope);
  const sweep = useSweep(scope);
  const cancel = useCancel(scope);
  const refund = useRefund(scope);
  const returnToken = useReturnToken(scope);
  const remove = useRejectAndRefund(scope);
  const busy = useSendBusy();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const pending =
    release.isPending ||
    sweep.isPending ||
    cancel.isPending ||
    refund.isPending ||
    remove.isPending ||
    returnToken.isPending;

  const data = actions.data;
  const locked = (reason: string): Gate => ({ enabled: false, lockedReason: reason });
  const reading = locked("Reading the event…");
  const gates = data
    ? {
        release: openable(data.release, `type ${TYPED_WORDS.pay}`),
        sweep: openable(data.sweep, `type ${TYPED_WORDS.sweep}`),
        cancel: openable(data.cancel, `type ${TYPED_WORDS.cancel}`),
        refund: openable(data.refund, "enter an amount"),
        returnToken: openable(data.returnToken, "read the token balance first"),
        removeGuest: openable(data.removeGuest, "choose a registered guest"),
      }
    : {
        release: reading,
        sweep: reading,
        cancel: reading,
        refund: reading,
        removeGuest: reading,
        returnToken: reading,
      };

  const open = (action: Frozen["action"]) => {
    if (!data) return;
    setError(null);
    setDone(null);
    setFields({ to: "", amount: "", guest: "", token: "" });
    if (action === "release")
      setFrozen({
        action,
        pool: data.pool ?? 0n,
        attendees: data.attendees ?? 0,
        share: data.share ?? 0n,
        heldBack: data.heldBack ?? 0n,
      });
    else if (action === "sweep") setFrozen({ action, spare: data.spare });
    else if (action === "cancel")
      setFrozen({ action, registered: data.registered, refundTotal: deposit * BigInt(data.registered) });
    else if (action === "refund") setFrozen({ action, spare: data.spare });
    else setFrozen({ action });
  };

  const dialogGate: Gate | null =
    frozen?.action === "returnToken"
      ? dialogRead.isError
        ? locked("Could not read this token. Check its address and try again.")
        : !dialogInput.token
          ? locked("Enter the token contract.")
          : !asAddress(fields.to)
            ? locked("Enter the wallet to return it to.")
            : dialogRead.isPlaceholderData
              ? reading
              : (dialogRead.data?.returnToken ?? reading)
      : frozen?.action === "refund"
        ? dialogRead.data && dialogInput.amount
          ? !asAddress(fields.to)
            ? locked("Enter the wallet to return it to.")
            : dialogRead.data.refund
          : locked("Enter an amount to return.")
        : frozen?.action === "removeGuest"
          ? dialogRead.data && dialogInput.guest
            ? dialogRead.data.removeGuest
            : locked("Paste the guest's wallet.")
          : null;

  const confirm = async (typed: string) => {
    if (!frozen) return;
    setError(null);
    try {
      if (frozen.action === "release")
        await release.mutateAsync({
          confirmation: typed,
          expected: { pool: frozen.pool, attendees: frozen.attendees, share: frozen.share, heldBack: frozen.heldBack },
        });
      else if (frozen.action === "sweep") await sweep.mutateAsync({ confirmation: typed, expectedSpare: frozen.spare });
      else if (frozen.action === "cancel")
        await cancel.mutateAsync({ confirmation: typed, expectedRegistered: frozen.registered });
      else if (frozen.action === "refund")
        await refund.mutateAsync({ to: asAddress(fields.to)!, amount: dialogInput.amount! });
      else if (frozen.action === "returnToken")
        await returnToken.mutateAsync({
          token: dialogInput.token!,
          to: asAddress(fields.to)!,
          amount: dialogInput.amount!,
        });
      else {
        const list = dialogRead.data?.removeGuestList;
        if (!list) throw new Error("Paste a registered guest's wallet.");
        await remove.mutateAsync({ list });
      }
      setDone(
        {
          release: "Payouts released.",
          sweep: "Leftovers collected.",
          cancel: "Event cancelled. Registered guests were refunded.",
          refund: "Returned.",
          removeGuest: "Guest removed and refunded.",
          returnToken: "Tokens returned.",
        }[frozen.action],
      );
      setFrozen(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return {
    loading: actions.isPending,
    readError: actions.error ? errorMessage(actions.error) : null,
    figures: data
      ? {
          pool: data.pool,
          attendees: data.attendees,
          share: data.share,
          heldBack: data.heldBack,
          spare: data.spare,
          openChallenges: data.openChallenges,
          registered: data.registered,
        }
      : null,
    gates,
    frozen,
    fields,
    setField: (name: keyof typeof fields, value: string) => setFields((old) => ({ ...old, [name]: value })),
    dialogGate,
    token: dialogRead.isPlaceholderData ? null : (dialogRead.data?.token ?? null),
    open,
    close: () => {
      if (!pending) setFrozen(null);
    },
    confirm,
    pending,
    busy,
    error,
    done,
  };
}

export type PayoutScreenModel = ReturnType<typeof usePayoutScreen>;
