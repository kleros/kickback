"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { presenceEventAbi, presenceFactoryAbi } from "@kickback/contracts";
import {
  eventConfig,
  LUMA_URL,
  lumaLinkProblem,
  MAX_SETTLEMENT_WINDOW,
  MIN_SETTLEMENT_WINDOW,
  withHttps,
} from "@kickback/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  erc20Abi,
  formatEther,
  formatUnits,
  isAddress,
  maxUint256,
  parseEventLogs,
  parseUnits,
  type Address,
  type Hash,
} from "viem";
import { useAccount, usePublicClient } from "wagmi";

import { GlassCard } from "@/components/ui/GlassCard";
import { ConnectWallet } from "@/components/wallet/ConnectWallet";

import { isShowableTime, zonedDateText } from "@/utils/time";

import { sendLock, sentTxStore, useSend, useSentTx } from "@/lib/web3/send";
import { useRestoringWallet } from "@/lib/web3/useRestoringWallet";

import { DEFAULT_CHAIN, DEFAULT_CHAIN_ID } from "@/config/chains";
import { paths } from "@/config/paths";
import { PROTOCOL } from "@/config/protocol";

import { ErrorLine, Primary, TxLink } from "./parts";
import { gate } from "../model/shared";
import { browserZone, eventZone, zonedUnix, zoneLabel, zoneList } from "../model/zone";
import { tx } from "../operations/tx";

/** "2026-11-24T18:00" in the browser's zone, for a datetime-local input. */
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/**
 * A Luma link as it is stored: lower-case scheme and host, no ?query (an invite token must never go on chain) and
 * no #fragment; anything unparsable is left as typed.
 */
function normaliseLuma(raw: string): string {
  const t = raw.trim();
  try {
    const u = new URL(t);
    if (u.protocol !== "https:") return t;
    u.hash = "";
    u.search = "";
    u.host = u.host.toLowerCase();
    return u.toString();
  } catch {
    return t;
  }
}

/** A week from now at 18:00 on the device's clock, for 4 hours: set in the browser only, after the first render. */
function defaultDates(now = new Date()) {
  const start = new Date(now.getTime() + 7 * 86_400_000);
  start.setHours(18, 0, 0, 0);
  const end = new Date(start.getTime() + 4 * 3_600_000);
  return { start: local(start), end: local(end) };
}

/** Tabs, line breaks and other invisible control characters (the contract refuses them in a name). */
// eslint-disable-next-line no-control-regex -- control characters are exactly what is matched
const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;

/** A thousands separator ("1,000", "12,500"): never read as a decimal comma, which could be off by 1000 times. */
const THOUSANDS = /^[1-9]\d{0,2}(,\d{3})+$/;

function initialForm() {
  return {
    name: "",
    url: "",
    asset: "ETH",
    token: "",
    deposit: "0.01",
    // the dates depend on the device's clock: empty on the server and in the first render, so both match
    start: "",
    end: "",
    // set to the device's zone once in the browser (the server would render its own)
    zone: "UTC",
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
  const queryClient = useQueryClient();
  const { address, chainId } = useAccount();
  // wagmi is restoring a saved session: no Connect prompt yet
  const restoring = useRestoringWallet();
  const [form, setForm] = useState<Form>(() => initialForm());
  // the server renders in its own zone and on its own clock: take the device's once in the browser
  const [deviceZone, setDeviceZone] = useState("UTC");
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const zone = browserZone();
    setDeviceZone(zone);
    setMounted(true);
    // never over anything already typed
    setForm((f) => ({ ...f, zone, ...(f.start || f.end ? {} : defaultDates()) }));
  }, []);
  const [error, setError] = useState<{ text: string; at: number } | null>(null);
  // a message belongs to the wallet that sent it: drop it on Disconnect or an account switch
  const accountKey = address?.toLowerCase();
  useEffect(() => setError(null), [accountKey]);
  const tokenAddress = form.token.trim();
  const token = useToken(form.asset === "token" ? tokenAddress : "");
  const fee = useChallengeFee().data;
  // recorded, so a reload while the create confirms still knows about it (and does not offer a second create)
  const send = useSend({ record: true });
  const factory = PROTOCOL?.factory;
  const sent = useSentTx(factory);
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  // set once this visit's create is confirmed: the button stays locked until the page has navigated
  const [created, setCreated] = useState(false);
  const mineHash = send.data?.transactionHash;
  // a create sent before a reload (or in another tab), not this visit's own
  const earlier =
    sent.data && !send.isPending && !created && sent.data.record.hash !== mineHash && address ? sent.data : undefined;
  // an old leftover never shows: only a create from the last hour
  const recent = !!earlier && Math.abs(Date.now() - earlier.record.at) < 3_600_000;
  const earlierPending = recent && earlier?.outcome === "pending";
  const earlierMined = recent && earlier?.outcome === "mined" ? earlier.record.hash : undefined;
  const earlierFailed = recent && earlier && earlier.outcome !== "pending" && earlier.outcome !== "mined";
  const earlierEvent = useQuery({
    queryKey: ["create-receipt", DEFAULT_CHAIN_ID, earlierMined],
    enabled: !!client && !!earlierMined,
    staleTime: Infinity,
    queryFn: async () => {
      const receipt = await client!.getTransactionReceipt({ hash: earlierMined as Hash });
      const [log] = parseEventLogs({ abi: presenceFactoryAbi, eventName: "EventCreated", logs: receipt.logs });
      return log?.args.eventContract ?? null;
    },
  });
  const earlierContract = earlierEvent.data;
  useEffect(() => {
    if (!earlierContract) return;
    void queryClient.invalidateQueries({ queryKey: ["organise", "mine"] });
    // a create confirmed while the page was reloading: its zone goes to the event it created
    if (address) eventZone.settle(DEFAULT_CHAIN_ID, address, earlierContract);
  }, [earlierContract, queryClient, address]);
  // the notice shows once: leaving the page forgets the mined record
  useEffect(() => {
    if (!earlierMined || !factory || !address) return;
    return () => sentTxStore.forget(DEFAULT_CHAIN_ID, factory, address, earlierMined as Hash);
  }, [earlierMined, factory, address]);
  const set = (key: keyof Form) => (e: { currentTarget: { value: string } }) =>
    setForm({ ...form, [key]: e.currentTarget.value });

  const asset = form.asset === "ETH" ? { symbol: "ETH", decimals: 18 } : token.data ? token.data : null;
  // many phone keyboards type a decimal comma: "0,01"; a thousands separator ("1,000") is refused instead
  const rawDeposit = form.deposit.trim();
  const thousands = THOUSANDS.test(rawDeposit);
  const deposit = rawDeposit.replace(",", ".");
  const [minDays, maxDays] = [MIN_SETTLEMENT_WINDOW / 86_400, MAX_SETTLEMENT_WINDOW / 86_400];

  // the reasons follow the order of the fields on the form: name, Luma link, deposit, dates, days, capacity
  const build = () => {
    // the name alone, by the same rules as the final check (every other value here is a valid placeholder)
    const t = Math.floor(Date.now() / 1000);
    eventConfig({
      name: form.name,
      url: "",
      depositAmount: 1n,
      eventStart: t + 60,
      eventEnd: t + 120,
      claimDeadline: t + 120 + MIN_SETTLEMENT_WINDOW,
      capacity: 0,
    });
    // the link is stored on-chain for good: check and store the cleaned one (lower-case host, no query or #fragment)
    // a link typed without https:// (or with http://) is completed first; the query is still reported below
    const typed = withHttps(form.url);
    const lumaProblem = lumaLinkProblem(typed);
    if (lumaProblem?.kind === "manage" || lumaProblem?.kind === "other") throw new Error(lumaProblem.text);
    const url = normaliseLuma(typed);
    if (!LUMA_URL.test(url)) throw new Error("Paste the event's Luma link, such as https://luma.com/abc123.");
    if (thousands)
      throw new Error(
        "Write the deposit without a thousands separator, such as 1000, or use a dot for decimals, such as 1.5.",
      );
    if (!/^\d+(\.\d+)?$/.test(deposit)) throw new Error("Enter the deposit as a number, such as 0.01 or 25.");
    if (!asset) throw new Error("Paste the token's contract address and wait for its name to load.");
    // parseUnits would round extra decimals silently, and the deposit cannot change once the event exists
    const places = (deposit.split(".")[1] ?? "").length;
    if (places > asset.decimals)
      throw new Error(
        asset.decimals === 0
          ? `Enter the deposit as a whole number: ${asset.symbol} has no decimal places.`
          : `Enter the deposit with at most ${asset.decimals} decimal places: that is the most ${asset.symbol} allows.`,
      );
    // more than the contract can store: encoding it would fail, so say so here
    const units = parseUnits(deposit, asset.decimals);
    if (units > maxUint256) throw new Error("This deposit is too large. Enter a smaller amount.");
    const start = zonedUnix(form.start, form.zone);
    const end = zonedUnix(form.end, form.zone);
    if (!Number.isFinite(start) || !(start > 0)) throw new Error("Enter a start date and time.");
    if (!Number.isFinite(end) || !(end > 0)) throw new Error("Enter an end date and time.");
    if (!(end > start)) throw new Error("The event must end after it starts.");
    if (!(end > Date.now() / 1000)) throw new Error("The event's end time has already passed.");
    const days = Number(form.deadlineDays);
    if (!Number.isInteger(days) || days < minDays || days > maxDays)
      throw new Error(`Enter a whole number of days from ${minDays} to ${maxDays}.`);
    const capText = form.capacity.trim();
    if (capText && !/^\d+$/.test(capText))
      throw new Error("Enter the capacity as a whole number, such as 100, or leave it empty for no limit.");
    const capacity = capText ? Number(capText) : 0;
    if (capText && capacity === 0) throw new Error("Enter a capacity of at least 1, or leave it empty for no limit.");
    return eventConfig({
      name: form.name,
      url,
      token: form.asset === "ETH" ? undefined : (tokenAddress as Address),
      depositAmount: units,
      eventStart: start,
      eventEnd: end,
      claimDeadline: end + days * 86_400,
      capacity,
    });
  };
  // an invite token or another query is dropped before the link goes on chain: say so, with the link stored
  const typedUrl = withHttps(form.url);
  const lumaCheck = form.url.trim() ? lumaLinkProblem(typedUrl) : null;
  // completed with https:// (and nothing else wrong with it): say so, with the link stored
  const schemeAdded = !!form.url.trim() && typedUrl !== form.url.trim() && !lumaCheck;
  const lumaNote =
    lumaCheck?.kind === "token" || lumaCheck?.kind === "query"
      ? lumaCheck.text
      : schemeAdded
        ? "The link has been completed with https://."
        : null;
  let check: string | null = null;
  try {
    build();
  } catch (e) {
    check = (e as Error).message;
  }
  const reason = !PROTOCOL
    ? "Events cannot be created on this network yet."
    : !address
      ? restoring
        ? "Checking your wallet."
        : "Connect the wallet that will organise the event."
      : chainId !== DEFAULT_CHAIN_ID
        ? `Switch your wallet to ${DEFAULT_CHAIN.name}.`
        : earlierPending
          ? "Wait for the event you already created to confirm."
          : check;
  const plainDeposit = !thousands && /^\d+(\.\d+)?$/.test(deposit);
  // the amount as it will be stored, once it is a valid number for this asset (so parseUnits never rounds)
  const depositUnits =
    plainDeposit && asset && (deposit.split(".")[1] ?? "").length <= asset.decimals
      ? parseUnits(deposit, asset.decimals)
      : undefined;
  // only an amount that can be created: above zero and storable
  const depositShown =
    asset && depositUnits !== undefined && depositUnits > 0n && depositUnits <= maxUint256
      ? `Guests will deposit ${formatUnits(depositUnits, asset.decimals)} ${asset.symbol}.`
      : undefined;
  const feeHint =
    fee === undefined
      ? undefined
      : form.asset === "ETH" && plainDeposit && parseUnits(deposit, 18) > 0n && parseUnits(deposit, 18) < fee
        ? `A guest you leave off can challenge by paying the Kleros fee, currently ${formatEther(fee)} ETH. To send their case to Kleros, you pay the same fee, and you lose it if the jurors side with the guest, so mark everyone who came.`
        : `A guest you leave off can challenge by paying the Kleros fee, currently ${formatEther(fee)} ETH.`;
  const zoneName = form.zone.replace(/_/g, " ");
  /** The picked time in the event's zone: "Thu 3 Dec 2026, 18:00 GMT" (each visitor sees it in their own zone). */
  const shown = (value: string) => {
    const unix = zonedUnix(value, form.zone);
    return Number.isFinite(unix) && isShowableTime(unix) ? zonedDateText(unix, form.zone) : "";
  };
  const startUnix = zonedUnix(form.start, form.zone);
  const startPassed = Number.isFinite(startUnix) && startUnix > 0 && startUnix < Date.now() / 1000;

  // set synchronously on the first press: a double press in the same tick never sends a second create (the
  // second mutate would also drop the first one's callbacks, so the page would never open the new event)
  const inFlight = useRef(false);
  const create = () => {
    if (inFlight.current || created || send.isPending || earlierPending || sendLock.getState().busy) return;
    inFlight.current = true;
    setError(null);
    // the zone is not on chain: kept in this browser, so the organiser pages can show the event's own times
    if (address) eventZone.saveCreate(DEFAULT_CHAIN_ID, address, form.zone);
    send.mutate(
      { expectedAccount: address, prepare: async () => tx.create(PROTOCOL!.factory, build()) },
      {
        onSuccess: (receipt) => {
          // locked from here: a second press would create a second event (the ref stays set too)
          setCreated(true);
          if (factory && address) sentTxStore.forget(DEFAULT_CHAIN_ID, factory, address, receipt.transactionHash);
          // the lists of this wallet's events (home and Manage your events) must show the new one
          void queryClient.invalidateQueries({ queryKey: ["organise", "mine"] });
          const [log] = parseEventLogs({ abi: presenceFactoryAbi, eventName: "EventCreated", logs: receipt.logs });
          const created = log?.args.eventContract;
          if (!created)
            return setError({
              text: "The event was created, but its address could not be read. Open “Manage your events” (link below): it is listed there.",
              at: Date.now(),
            });
          if (address) eventZone.settle(DEFAULT_CHAIN_ID, address, created);
          router.push(paths.organiseEvent.getHref(created));
        },
        onError: (e) => {
          inFlight.current = false;
          setError({ text: e.message, at: Date.now() });
        },
      },
    );
  };

  return (
    <div className="og-page og-narrow" data-testid="create">
      <div className="flex flex-col gap-2">
        <h1 className="kb-h1">Create an event</h1>
        <p className="og-lede">
          Guests pay a refundable deposit to attend. After the event, you confirm who actually came, and the
          no-shows&apos; deposits are shared among the guests who did. A guest you leave off by mistake can challenge,
          and independent jurors on Kleros Court decide who is right.
        </p>
      </div>
      {/* connect, or switch a wallet that is on another network; nothing once it is ready */}
      {!restoring && (!address || chainId !== DEFAULT_CHAIN_ID) && (
        <div className="og-actions">
          <ConnectWallet text="Connect wallet" />
        </div>
      )}
      <GlassCard as="section" className="og-card">
        <div className="og-form" data-testid="create-form">
          <Field label="Event name" full hint="Shown to guests, and to Kleros jurors if there is a dispute.">
            <input
              className="og-input"
              value={form.name}
              // a tab or another invisible character (pasted from a spreadsheet) becomes a space, as it is shown
              onChange={(e) => setForm({ ...form, name: e.currentTarget.value.replace(CONTROL_CHARS, " ") })}
            />
          </Field>
          <Field label="Luma event page" full hint="Required. Guests register there; Kickback only holds the deposits.">
            <input
              className="og-input"
              type="url"
              value={form.url}
              placeholder="https://luma.com/…"
              onChange={set("url")}
            />
            {lumaNote && (
              <span className="og-note" data-testid="luma-link-note">
                {lumaNote} The link stored will be {normaliseLuma(typedUrl)}
              </span>
            )}
          </Field>
          <Field label="Deposit in">
            <select className="og-input" value={form.asset} onChange={set("asset")}>
              <option value="ETH">ETH</option>
              <option value="token">A token (USDC, DAI…)</option>
            </select>
          </Field>
          <Field label={`Deposit${asset ? ` (${asset.symbol})` : ""}`}>
            <input className="og-input" inputMode="decimal" value={form.deposit} onChange={set("deposit")} />
            {depositShown && (
              <span className="og-note" data-testid="deposit-shown">
                {depositShown}
              </span>
            )}
          </Field>
          {feeHint && <p className="og-note is-full -mt-2.5">{feeHint}</p>}
          {form.asset === "token" && (
            <Field
              label="Token contract address"
              full
              hint={
                token.data
                  ? `${token.data.symbol}, ${token.data.decimals} decimal places`
                  : token.isError
                    ? "Not a token on this network."
                    : "0x…"
              }
            >
              <input className="og-input is-mono" value={form.token} spellCheck={false} onChange={set("token")} />
            </Field>
          )}
          <Field
            label="Time zone of the event"
            full
            hint={`${zoneLabel(form.zone, zonedUnix(form.start, form.zone) || 0)}. Use the event's own time zone, as set on Luma. Your device is set to ${deviceZone.startsWith("Etc/") ? zoneLabel(deviceZone, Date.now() / 1000) : `${deviceZone.replace(/_/g, " ")} (${zoneLabel(deviceZone, Date.now() / 1000)})`}.`}
          >
            <select className="og-input" value={form.zone} onChange={set("zone")}>
              {/* the zone list differs between the server and some browsers: the full list only once mounted */}
              {(mounted ? zoneList(form.zone) : [form.zone]).map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Starts"
            hint={
              startPassed
                ? "This start time has already passed. Guests can still deposit until the event ends, but you will not be able to turn anyone away."
                : shown(form.start)
                  ? `${shown(form.start)}, in the event's time zone (${zoneName}). The guest page shows each visitor this time in their own time zone.`
                  : `In the event's time zone (${zoneName})`
            }
          >
            <input className="og-input" type="datetime-local" value={form.start} onChange={set("start")} />
          </Field>
          <Field
            label="Ends"
            hint={
              shown(form.end)
                ? `${shown(form.end)}. Deposits stay open until then, for walk-ins.`
                : "Deposits stay open until then, for walk-ins."
            }
          >
            <input className="og-input" type="datetime-local" value={form.end} onChange={set("end")} />
          </Field>
          <Field
            label="Days to confirm who came"
            hint={`${MIN_SETTLEMENT_WINDOW / 86_400} to ${MAX_SETTLEMENT_WINDOW / 86_400} days after the event ends. Once you confirm the list, guests left off have 1 day to challenge. Miss the deadline and every guest can withdraw their full deposit.`}
          >
            <input
              className="og-input"
              type="number"
              min={MIN_SETTLEMENT_WINDOW / 86_400}
              max={MAX_SETTLEMENT_WINDOW / 86_400}
              step={1}
              value={form.deadlineDays}
              onChange={set("deadlineDays")}
            />
          </Field>
          <Field label="Capacity" hint="Leave empty for no limit.">
            <input
              className="og-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              value={form.capacity}
              onChange={set("capacity")}
            />
          </Field>
        </div>
      </GlassCard>
      <ErrorLine error={error} />
      {earlierPending && earlier && (
        <p className="og-note" data-testid="create-earlier" role="status">
          An event you created from this wallet is still confirming (<TxLink tx={earlier.record.hash} />
          ). It will appear under{" "}
          <Link href={paths.organise.getHref()} className="kb-link">
            Manage your events
          </Link>
          .
        </p>
      )}
      {earlierMined && earlierContract && (
        <p className="og-success" data-testid="create-earlier" role="status">
          Your event was created.{" "}
          <Link href={paths.organiseEvent.getHref(earlierContract)} className="kb-link">
            Open the event
          </Link>
          .
        </p>
      )}
      {earlierFailed && (
        <p className="og-note" data-testid="create-earlier" role="status">
          Your earlier create did not go through, so you can create the event now.
        </p>
      )}
      {created && !error && (
        <p className="og-note" role="status">
          Your event is created. Opening it… If it does not open,{" "}
          <Link href={paths.organise.getHref()} className="kb-link">
            find it under Manage your events
          </Link>
          .
        </p>
      )}
      <Primary
        gate={gate(created ? null : reason)}
        pending={send.isPending || created}
        busy={send.isPending || created}
        onPress={create}
      >
        {created ? "Opening your event…" : "Create the event"}
      </Primary>
      <p className="og-note">
        Runs on {DEFAULT_CHAIN.name}. Creating an event is free apart from the network fee: it takes one transaction
        from your wallet. The event&apos;s rules are fixed in the contract: nobody, including you, can change them or
        take the deposits. After the event, a guest you leave off the list can challenge. You can add them until the
        1-day challenge window closes, or send the case to Kleros
        {fee === undefined ? "" : ` (currently ${formatEther(fee)} ETH)`} within 1 day of their challenge. If you do
        neither, they are added.
      </p>
    </div>
  );
}
