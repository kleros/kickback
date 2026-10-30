"use client";

import { useMemo, useState } from "react";

import { ipfsCidV0 } from "@kickback/core";
import { useQuery } from "@tanstack/react-query";
import * as v from "valibot";
import type { Address } from "viem";
import { useAccount } from "wagmi";

import { useSendBusy } from "@/lib/web3/send";

import { DEFAULT_CHAIN, DEFAULT_CHAIN_ID } from "@/config/chains";
import { klerosFor, networkFor, SEPOLIA_ID } from "@/config/kleros";
import { paths } from "@/config/paths";

import { useCreateEvent } from "./useCreateEvent";
import { errorMessage } from "./useGuestsScreen";
import { createEventSchema, readDeployments } from "../model/create";
import { GENERIC_POLICY_TEXT } from "../model/policy";
import { TYPED_WORDS } from "../model/view";

/** The form as typed: every field a string, so fields added later slot in without a new shape. */
export type CreateFormValues = Record<string, string>;

/** The pinned policy's address is fixed by its text, so the preview can name it before it is pinned. */
export const EXPECTED_POLICY_URI = `/ipfs/${ipfsCidV0(GENERIC_POLICY_TEXT)}`;

const pad = (n: number) => String(n).padStart(2, "0");
const localInput = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
const offsetOfNow = (date: Date) => {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  return `${sign}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
};

export function initialForm(now = new Date()): CreateFormValues {
  const start = new Date(now);
  start.setDate(start.getDate() + 7);
  start.setHours(18, 0, 0, 0);
  const end = new Date(start);
  end.setHours(22);
  return {
    title: "",
    shortName: "",
    start: localInput(start),
    end: localInput(end),
    timezoneOffset: offsetOfNow(now),
    zoneName: "",
    venue: "",
    hosts: "",
    registrationLink: "",
    deposit: "0.01",
    settleDays: "14",
  };
}

const toInput = (form: CreateFormValues) => ({ ...form, settleDays: Number(form.settleDays) });

export function formErrors(form: CreateFormValues): Record<string, string> {
  const parsed = v.safeParse(createEventSchema, toInput(form));
  if (parsed.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of parsed.issues) {
    const key = issue.path?.[0]?.key;
    if (typeof key === "string" && !errors[key])
      errors[key] =
        key === "registrationLink"
          ? "Paste the full https:// link."
          : key === "settleDays"
            ? "A whole number of days, 7 to 365."
            : issue.message.startsWith("Invalid")
              ? "Check this field."
              : issue.message;
  }
  return errors;
}

export interface DeployedEvent {
  address: Address;
  block: number;
  adminLink: string;
  guestLink: string;
}

/** The create page: the form, the jurors' preview, then pin, deploy and the links to share. */
export function useCreateScreen() {
  const { address: owner } = useAccount();
  const network = useMemo(() => networkFor(DEFAULT_CHAIN_ID), []);
  const create = useCreateEvent(network);
  const busy = useSendBusy();
  const [form, setForm] = useState<CreateFormValues>(() => initialForm());
  const [touched, setTouched] = useState(false);
  const [askNew, setAskNew] = useState(false);
  const [deployed, setDeployed] = useState<DeployedEvent | null>(null);
  const [error, setError] = useState<{ text: string; at: number } | null>(null);

  const errors = formErrors(form);
  const valid = Object.keys(errors).length === 0;
  let preview: string | null = null;
  let previewError: string | null = null;
  if (valid) {
    try {
      preview = create.preview(toInput(form), EXPECTED_POLICY_URI, owner);
    } catch (caught) {
      previewError = errorMessage(caught);
    }
  }

  const notSetUp =
    klerosFor(DEFAULT_CHAIN_ID) === null
      ? DEFAULT_CHAIN_ID === SEPOLIA_ID
        ? "Sepolia is not set up yet: its test court contracts are not deployed. Nothing can be created here."
        : `${DEFAULT_CHAIN.name} has no court set up. Nothing can be created here.`
      : null;
  const deployGate = notSetUp
    ? { enabled: false, lockedReason: notSetUp }
    : !owner
      ? { enabled: false, lockedReason: "Connect your wallet: it becomes the event's owner." }
      : touched && !valid
        ? { enabled: false, lockedReason: "Fix the fields marked above." }
        : previewError
          ? { enabled: false, lockedReason: previewError }
          : { enabled: true, lockedReason: null };

  const step = create.pin.isPending ? "pinning" : create.deploy.isPending ? "deploying" : deployed ? "done" : "form";
  const previous = (create.deployments.data ?? []).filter((row) => row.chainId === DEFAULT_CHAIN_ID);

  const run = async (confirmation?: string) => {
    setError(null);
    try {
      if (!owner) throw new Error("Connect your wallet first.");
      const policyURI = await create.pin.mutateAsync();
      const receipt = await create.deploy.mutateAsync({ form: toInput(form), owner, policyURI, confirmation });
      const address = receipt.contractAddress!;
      const block = Number(receipt.blockNumber);
      const origin = typeof window === "undefined" ? "" : window.location.origin;
      setAskNew(false);
      setDeployed({
        address,
        block,
        adminLink: `${origin}${paths.organiseEvent.getHref(address, block)}`,
        guestLink: `${origin}${paths.event.getHref(address, block)}`,
      });
    } catch (caught) {
      setError({ text: errorMessage(caught), at: Date.now() });
    }
  };

  return {
    form,
    setField: (name: string, value: string) => setForm((old) => ({ ...old, [name]: value })),
    errors: touched ? errors : {},
    preview,
    policyURI: create.pin.data ?? EXPECTED_POLICY_URI,
    policyPinned: create.pin.isSuccess,
    deployGate,
    notSetUp,
    step,
    busy,
    deploy: () => {
      setTouched(true);
      if (!valid || !deployGate.enabled) return;
      if (previous.length) setAskNew(true);
      else void run();
    },
    askNew,
    closeNew: () => {
      if (step === "form") setAskNew(false);
    },
    confirmNew: (typed: string) => void run(typed),
    newWord: TYPED_WORDS.another,
    deployed,
    previous,
    error,
  };
}

export type CreateScreenModel = ReturnType<typeof useCreateScreen>;

/** Events this browser created on the app's chain. */
export function useBrowserEvents() {
  const query = useQuery({
    queryKey: ["organise", "deployments"],
    queryFn: () => readDeployments(),
    staleTime: Infinity,
  });
  return (query.data ?? []).filter((row) => row.chainId === DEFAULT_CHAIN_ID);
}
