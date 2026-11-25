"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { presenceEventAbi, presenceFactoryAbi } from "@kickback/contracts";
import { eventConfig, MAX_SETTLEMENT_WINDOW, MIN_SETTLEMENT_WINDOW } from "@kickback/core";
import { useQuery } from "@tanstack/react-query";
import { erc20Abi, formatEther, isAddress, parseEventLogs, parseUnits, type Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";

import { GlassCard } from "@/components/ui/GlassCard";
import { ConnectWallet } from "@/components/wallet/ConnectWallet";

import { useSend } from "@/lib/web3/send";

import { DEFAULT_CHAIN, DEFAULT_CHAIN_ID } from "@/config/chains";
import { paths } from "@/config/paths";
import { PROTOCOL } from "@/config/protocol";

import { ErrorLine, Primary } from "./parts";
import { saveDeployment } from "../model/browserEvents";
import { gate } from "../model/shared";
import { tx } from "../operations/tx";

/** "2026-11-24T18:00" in the browser's zone, for a datetime-local input. */
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const unix = (value: string) => Math.floor(new Date(value).getTime() / 1000);

function initialForm(now = new Date()) {
  const start = new Date(now.getTime() + 7 * 86_400_000);
  start.setHours(18, 0, 0, 0);
  const end = new Date(start.getTime() + 4 * 3_600_000);
  return {
    name: "",
    url: "",
    asset: "ETH",
    token: "",
    deposit: "0.01",
    start: local(start),
    end: local(end),
    deadlineDays: "7",
    capacity: "",
  };
}
type Form = ReturnType<typeof initialForm>;

/** Name, decimals and symbol of an ERC-20, read when the organiser pastes its address. */
function useToken(address: string) {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  return useQuery({
    queryKey: ["token", DEFAULT_CHAIN_ID, address.toLowerCase()],
    enabled: !!client && isAddress(address),
    retry: false,
    queryFn: async () => {
      const t = { address: address as Address, abi: erc20Abi } as const;
      const [symbol, decimals] = await Promise.all([
        client!.readContract({ ...t, functionName: "symbol" }),
        client!.readContract({ ...t, functionName: "decimals" }),
      ]);
      return { symbol, decimals };
    },
  });
}

/** Kleros's fee a guest pays to challenge the list now, read from the factory's implementation. */
function useChallengeFee() {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  return useQuery({
    queryKey: ["challenge-fee", DEFAULT_CHAIN_ID, PROTOCOL?.factory],
    enabled: !!client && !!PROTOCOL,
    staleTime: 60_000,
    queryFn: async () => {
      const implementation = await client!.readContract({
        address: PROTOCOL!.factory,
        abi: presenceFactoryAbi,
        functionName: "implementation",
      });
      return client!.readContract({ address: implementation, abi: presenceEventAbi, functionName: "challengeDeposit" });
    },
  });
}

function Field({
  label,
  hint,
  full,
  children,
}: {
  label: string;
  hint?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={full ? "og-field is-full" : "og-field"}>
      <span className="og-label">{label}</span>
      {children}
      {hint && <span className="og-note">{hint}</span>}
    </label>
  );
}

export function CreateScreen() {
  const router = useRouter();
  const { address } = useAccount();
  const [form, setForm] = useState<Form>(() => initialForm());
  const [error, setError] = useState<{ text: string; at: number } | null>(null);
  const token = useToken(form.asset === "token" ? form.token : "");
  const fee = useChallengeFee().data;
  const send = useSend();
  const set = (key: keyof Form) => (e: { currentTarget: { value: string } }) =>
    setForm({ ...form, [key]: e.currentTarget.value });

  const asset = form.asset === "ETH" ? { symbol: "ETH", decimals: 18 } : token.data ? token.data : null;

  const build = () => {
    if (!asset) throw new Error("Paste the token's contract address and wait for its name to load.");
    if (!/^\d+(\.\d+)?$/.test(form.deposit.trim()))
      throw new Error("Enter the deposit as a number, such as 0.01 or 25.");
    const end = unix(form.end);
    return eventConfig({
      name: form.name,
      url: form.url,
      token: form.asset === "ETH" ? undefined : (form.token as Address),
      depositAmount: parseUnits(form.deposit.trim(), asset.decimals),
      eventStart: unix(form.start),
      eventEnd: end,
      claimDeadline: end + Math.max(7, Number(form.deadlineDays) || 7) * 86_400,
      capacity: Number(form.capacity) || 0,
    });
  };
  let check: string | null = null;
  try {
    build();
  } catch (e) {
    check = (e as Error).message;
  }
  const reason = !PROTOCOL
    ? "This network has no factory yet."
    : !address
      ? "Connect the wallet that will organise the event."
      : check;

  const create = () => {
    setError(null);
    send.mutate(
      { expectedAccount: address, prepare: async () => tx.create(PROTOCOL!.factory, build()) },
      {
        onSuccess: (receipt) => {
          const [log] = parseEventLogs({ abi: presenceFactoryAbi, eventName: "EventCreated", logs: receipt.logs });
          const created = log?.args.eventContract;
          if (!created)
            return setError({ text: "Created, but the new address was not found. Check your wallet.", at: Date.now() });
          saveDeployment({
            address: created,
            chainId: DEFAULT_CHAIN_ID,
            block: Number(receipt.blockNumber),
            name: form.name.trim(),
          });
          router.push(paths.organiseEvent.getHref(created));
        },
        onError: (e) => setError({ text: e.message, at: Date.now() }),
      },
    );
  };

  return (
    <div className="og-page og-narrow" data-testid="create">
      <div className="flex flex-col gap-2">
        <h1 className="kb-h1">Create an event</h1>
        <p className="og-lede">
          Guests book with a refundable deposit. After the event you post who came; the no-shows&apos; deposits are
          shared among the guests who did. Anyone left off can challenge, and Kleros jurors decide.
        </p>
      </div>
      {!address && (
        <div className="og-actions">
          <ConnectWallet text="Connect your wallet" />
        </div>
      )}
      <GlassCard as="section" className="og-card">
        <div className="og-form" data-testid="create-form">
          <Field label="Event name" full hint="Shown to guests and to Kleros jurors if there is a dispute">
            <input className="og-input" value={form.name} maxLength={120} onChange={set("name")} />
          </Field>
          <Field label="Event page" full hint="Optional: your Luma (or other) page, https://…">
            <input
              className="og-input"
              type="url"
              value={form.url}
              placeholder="https://luma.com/…"
              onChange={set("url")}
            />
          </Field>
          <Field label="Deposit in">
            <select className="og-input" value={form.asset} onChange={set("asset")}>
              <option value="ETH">ETH</option>
              <option value="token">A token (USDC, DAI…)</option>
            </select>
          </Field>
          <Field
            label={`Deposit${asset ? `, ${asset.symbol}` : ""}`}
            hint={
              fee === undefined
                ? undefined
                : form.asset === "ETH" &&
                    /^\d+(\.\d+)?$/.test(form.deposit.trim()) &&
                    parseUnits(form.deposit.trim(), 18) < fee
                  ? `A guest left off pays Kleros's fee, now ${formatEther(fee)} ETH, to challenge: more than this deposit, so few will. Guests get less protection.`
                  : `A guest left off pays Kleros's fee, now ${formatEther(fee)} ETH, to challenge.`
            }
          >
            <input className="og-input" inputMode="decimal" value={form.deposit} onChange={set("deposit")} />
          </Field>
          {form.asset === "token" && (
            <Field
              label="Token contract address"
              full
              hint={
                token.data
                  ? `${token.data.symbol}, ${token.data.decimals} decimals`
                  : token.isError
                    ? "Not a token on this network"
                    : "0x…"
              }
            >
              <input className="og-input is-mono" value={form.token} spellCheck={false} onChange={set("token")} />
            </Field>
          )}
          <Field label="Starts" hint="In your local time">
            <input className="og-input" type="datetime-local" value={form.start} onChange={set("start")} />
          </Field>
          <Field label="Ends" hint="Bookings stay open until then, for walk-ins">
            <input className="og-input" type="datetime-local" value={form.end} onChange={set("end")} />
          </Field>
          <Field
            label="Post the list within, days"
            hint={`${MIN_SETTLEMENT_WINDOW / 86_400} to ${MAX_SETTLEMENT_WINDOW / 86_400} days after the end`}
          >
            <input
              className="og-input"
              type="number"
              min={MIN_SETTLEMENT_WINDOW / 86_400}
              max={MAX_SETTLEMENT_WINDOW / 86_400}
              value={form.deadlineDays}
              onChange={set("deadlineDays")}
            />
          </Field>
          <Field label="Capacity" hint="Empty for no limit">
            <input className="og-input" type="number" min={0} value={form.capacity} onChange={set("capacity")} />
          </Field>
        </div>
      </GlassCard>
      <ErrorLine error={error} />
      <Primary gate={gate(reason)} pending={send.isPending} busy={send.isPending} onPress={create}>
        Create the event
      </Primary>
      <p className="og-note">
        Runs on {DEFAULT_CHAIN.name}. Creating an event is free: one transaction from your wallet, you pay only the
        network fee. The event&apos;s rules are fixed in the contract: nobody, including you, can change them or take
        the deposits. After the event, a guest you leave off the list can challenge; you then have 1 day to add them, or
        send it to Kleros{fee === undefined ? "" : ` (${formatEther(fee)} ETH now)`}.
      </p>
    </div>
  );
}
