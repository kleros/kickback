import { fmtEth } from "@kickback/core";
import type { Address, Hash } from "viem";

import type { SendErrorKind, SentTxOutcome } from "@/lib/web3/send";

export const DEPOSIT_STATES = [
  "rest",
  "nowallet",
  "connect",
  "wrongnet",
  "addchain",
  "ready",
  "insufficient",
  "signing",
  "pending",
  "done",
  "failed",
  "closed",
  "already",
  "earlier",
  "dropped",
  "replaced",
  "refunded",
  "short",
] as const;

export type DepositStateKey = (typeof DEPOSIT_STATES)[number];

export type WalletStatus = "disconnected" | "connecting" | "connected";

export interface DepositInput {
  /** The contract's depositAmount, in wei. */
  amount: bigint;
  /** Unix seconds. */
  eventStart: number;
  /** 0 Open, 1 Listed, 2 Finalized, 3 Cancelled. */
  phase: number;
  /** The latest block's time, unix seconds; the app's "now". */
  chainNow: number | undefined;
  chain: { id: number; name: string };
  wallet: {
    status: WalletStatus;
    address?: Address;
    chainId?: number;
    /** An injected wallet exists in this browser. */
    hasProvider: boolean;
    /** The guest pressed Connect in this visit. */
    asked: boolean;
    /** The wallet answered 4902: it does not know the app's chain. */
    needsChain: boolean;
  };
  /** Wei, read from the app's chain. */
  balance?: bigint;
  /** Wei, the network fee the deposit is expected to cost. */
  fee?: bigint;
  /** This wallet's deposits to the event; undefined while loading or disconnected. */
  history?: {
    deposited: bigint;
    txHash?: Hash;
    /** Unix seconds of the first deposit. */
    at?: number;
    /** Unix seconds the contract returned the deposit (Rejected). */
    refundedAt?: number;
  };
  /** The browser's record of the last deposit sent, as reconciled with the network. */
  sent?: { outcome: SentTxOutcome; hash: Hash; at: number } | null;
  send: {
    status: "idle" | "pending" | "success" | "error";
    /** Date.now() when the send started. */
    startedAt?: number;
    hash?: Hash;
    errorKind?: SendErrorKind;
    errorMessage?: string;
  };
  /** Date.now(), for how long a transaction has been waiting. */
  wallNow: number;
  /** Wallets that have deposited so far. */
  guests?: number;
  /** The chain's block explorer, when it has one. */
  explorer?: string;
  /** Formats unix seconds as a short date on the event's clock ("29 Oct"). */
  dayText: (unix: number) => string;
  /** The wallet's chain by name, when the wallet is on another one. */
  chainName?: (id: number) => string | undefined;
}

export type Tone = "pri" | "warn" | "err";

export interface StatusLine {
  text: string;
  tone?: Tone;
  link?: { label: string; href: string };
  /** An inline action the card wires up. */
  action?: { label: string; id: "recheck" };
}

export type DepositAction = "connect" | "switch" | "add-chain" | "deposit" | "copy" | "none";

export interface DepositView {
  key: DepositStateKey;
  /** Pending only: 1 under a minute, 2 under five, 3 stuck. */
  stage?: 1 | 2 | 3;
  label: string;
  lines: StatusLine[];
  receipt?: { tx: Hash; txLink: string; txUrl?: string; wallet: Address; when?: string };
  action: DepositAction;
  button: string;
  glyph?: "ring" | "arc";
  disabled?: boolean;
  /** The line under the button; null leaves it empty. */
  foot: string | null;
  /** Play the error shake when this view appears. */
  shake?: boolean;
}

export const DEFAULT_FOOT = "Deposits close when the event starts";
const PENDING_STAGE_2_MS = 60_000;
const PENDING_STAGE_3_MS = 5 * 60_000;

/** "0.01" from 10^16 wei: the amount as the card prints it, without the unit. */
export const ethText = (wei: bigint) => fmtEth(wei).replace(/ ETH$/, "");

/** "14 s", "2 min 14 s". */
export function waitText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** "3 min", "2 h", "under a minute". */
export function agoText(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return "under a minute";
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`;
}

export const txHref = (explorer: string | undefined, hash: Hash) => (explorer ? `${explorer}/tx/${hash}` : undefined);

function guestsLine(guests: number | undefined): StatusLine {
  if (guests === undefined) return { text: "" };
  if (guests === 0) return { text: "Be the first to deposit" };
  return { text: `${guests} ${guests === 1 ? "guest" : "guests"} deposited` };
}

/** The deposit card's state, from everything the page knows. Earlier rules win. */
export function depositState(input: DepositInput): DepositView {
  const { amount, chain, wallet, history, sent, send, explorer } = input;
  const amt = ethText(amount);
  const connected = wallet.status === "connected" && wallet.address !== undefined;
  const onChain = connected && wallet.chainId === chain.id;
  const deposit = { action: "deposit" as const, foot: DEFAULT_FOOT };
  const receipt = (tx: Hash, when?: number) => ({
    tx,
    txUrl: txHref(explorer, tx),
    txLink: txHref(explorer, tx) ?? tx,
    wallet: wallet.address!,
    when: when === undefined ? undefined : input.dayText(when),
  });
  const done = (tx: Hash, when?: number): DepositView => ({
    key: when === undefined ? "done" : "already",
    label: "Deposited",
    lines: [],
    receipt: receipt(tx, when),
    action: "copy",
    button: "Copy transaction link",
    foot: "Paste both into Luma",
  });
  const etherscan = (hash: Hash) => {
    const href = txHref(explorer, hash);
    return href ? { label: "Etherscan", href } : undefined;
  };

  if (send.status === "success" && send.hash && connected) return done(send.hash);

  if (connected && history?.refundedAt !== undefined)
    return {
      key: "refunded",
      label: "Refunded",
      lines: [
        { text: `Your deposit was returned on ${input.dayText(history.refundedAt)}.` },
        { text: "Ask the organiser before sending again." },
      ],
      action: "none",
      button: "Refunded",
      disabled: true,
      foot: DEFAULT_FOOT,
    };

  if (connected && history && history.deposited >= amount && history.txHash)
    return done(history.txHash, history.at ?? input.chainNow ?? 0);
  if (connected && sent?.outcome === "mined") return done(sent.hash, Math.floor(sent.at / 1000));

  if (connected && send.status === "pending") {
    const record = sent?.outcome === "pending" && sent.at >= (send.startedAt ?? 0) ? sent : undefined;
    if (!record)
      return {
        key: "signing",
        label: "Sending",
        lines: [{ text: "Your wallet is showing the deposit.", tone: "pri" }],
        action: "none",
        button: "Confirm in your wallet",
        glyph: "ring",
        foot: DEFAULT_FOOT,
      };
    return pendingView(input, record.hash, input.wallNow - record.at);
  }

  if (connected && sent?.outcome === "pending")
    return {
      key: "earlier",
      label: "Sending",
      lines: [
        { text: "An earlier deposit is still confirming.", tone: "pri" },
        { text: `Sent ${agoText(input.wallNow - sent.at)} ago`, link: etherscan(sent.hash) },
      ],
      action: "none",
      button: "Confirming",
      glyph: "arc",
      foot: DEFAULT_FOOT,
    };

  const started = input.chainNow !== undefined && input.chainNow >= input.eventStart;
  if (started || input.phase !== 0)
    return {
      key: "closed",
      label: "Refundable deposit",
      lines: [
        {
          text:
            input.phase === 3
              ? "The event was cancelled."
              : input.phase !== 0
                ? "The attendance list is out."
                : "The event has started.",
        },
      ],
      action: "none",
      button: "Deposits closed",
      disabled: true,
      foot: null,
    };

  if (!connected) {
    // without an injected wallet, connecting means the QR code: say so rather than "approve"
    if (wallet.asked && !wallet.hasProvider)
      return {
        key: "nowallet",
        label: "Refundable deposit",
        lines: [{ text: "No wallet in this browser." }, { text: "Connect by QR from your phone." }],
        action: "connect",
        button: "Connect wallet",
        foot: DEFAULT_FOOT,
      };
    if (wallet.status === "connecting")
      return {
        key: "connect",
        label: "Refundable deposit",
        lines: [{ text: "Your wallet is asking to connect.", tone: "pri" }],
        action: "none",
        button: "Approve in your wallet",
        glyph: "ring",
        foot: DEFAULT_FOOT,
      };
    return {
      key: "rest",
      label: "Refundable deposit",
      lines: [guestsLine(input.guests)],
      action: "connect",
      button: "Connect wallet",
      foot: DEFAULT_FOOT,
    };
  }

  if (!onChain) {
    if (wallet.needsChain)
      return {
        key: "addchain",
        label: "Refundable deposit",
        lines: [{ text: `${chain.name} is not in your wallet yet.`, tone: "warn" }],
        action: "add-chain",
        button: `Add ${chain.name} to your wallet`,
        foot: DEFAULT_FOOT,
      };
    const theirs = wallet.chainId === undefined ? undefined : input.chainName?.(wallet.chainId);
    return {
      key: "wrongnet",
      label: "Refundable deposit",
      lines: [
        { text: theirs ? `Your wallet is on ${theirs}.` : "Your wallet is on another network.", tone: "warn" },
        { text: `This event is on ${chain.name}.` },
      ],
      action: "switch",
      button: `Switch to ${chain.name}`,
      foot: DEFAULT_FOOT,
    };
  }

  const failed = (spentFee: boolean): DepositView => ({
    key: "failed",
    label: "Not sent",
    lines: [
      { text: `Your ${amt} ETH stayed in your wallet.`, tone: "err" },
      { text: spentFee ? "Only the network fee was spent." : "Nothing was sent." },
    ],
    button: "Try again",
    shake: true,
    ...deposit,
  });
  const dropped: DepositView = {
    key: "dropped",
    label: "Not sent",
    lines: [{ text: "The network dropped your transaction.", tone: "err" }, { text: "Nothing left your wallet." }],
    button: "Deposit again",
    ...deposit,
  };
  const replaced = (hash: Hash | undefined): DepositView => {
    const link = hash ? etherscan(hash) : undefined;
    return {
      key: "replaced",
      label: "Not sent",
      lines: [
        { text: "Your wallet replaced the transaction.", tone: "warn" },
        link ? { text: "Check before sending again.", link } : { text: "Check your wallet before sending again." },
      ],
      button: "Deposit again",
      ...deposit,
    };
  };

  let notice: StatusLine | undefined;
  if (send.status === "error") {
    switch (send.errorKind) {
      case "replaced":
        return replaced(send.hash);
      case "reverted":
        return failed(true);
      case "refused":
        return failed(false);
      case "unconfirmed":
        return send.hash ? pendingView(input, send.hash, PENDING_STAGE_3_MS) : dropped;
      case "wallet":
        notice = { text: "Declined in your wallet. Nothing was sent.", tone: "err" };
        break;
      default:
        notice = { text: send.errorMessage ?? "Nothing was sent. Try again.", tone: "err" };
    }
  }

  if (sent?.outcome === "dropped") return dropped;
  if (sent?.outcome === "replaced") return replaced(sent.hash);
  if (sent?.outcome === "failed" && send.status === "idle") return failed(true);

  if (history && history.deposited > 0n && history.deposited < amount)
    return {
      key: "short",
      label: "Short payment",
      lines: [
        {
          text: `${ethText(history.deposited)} ETH received, ${ethText(amount - history.deposited)} ETH short.`,
          tone: "warn",
        },
        { text: "Refunded later. Send the full amount." },
      ],
      button: "Deposit",
      ...deposit,
    };

  const needed = amount + (input.fee ?? 0n);
  if (input.balance !== undefined && input.balance < needed)
    return {
      key: "insufficient",
      label: "Refundable deposit",
      lines: [
        {
          text: `${ethText(input.balance)} ETH available`,
          tone: "err",
          action: { label: "Check again", id: "recheck" },
        },
        { text: input.fee === undefined ? `${amt} ETH needed.` : `${ethText(needed)} ETH needed with the fee.` },
      ],
      action: "none",
      button: "Not enough ETH",
      disabled: true,
      foot: DEFAULT_FOOT,
    };

  const where =
    input.balance === undefined ? `On ${chain.name}` : `On ${chain.name} · ${ethText(input.balance)} ETH available`;
  return {
    key: "ready",
    label: "Refundable deposit",
    lines: notice ? [notice, { text: where }] : [{ text: where }],
    button: "Deposit",
    shake: notice !== undefined,
    ...deposit,
  };
}

function pendingView(input: DepositInput, hash: Hash, waited: number): DepositView {
  const stage = waited < PENDING_STAGE_2_MS ? 1 : waited < PENDING_STAGE_3_MS ? 2 : 3;
  const href = txHref(input.explorer, hash);
  const lines: StatusLine[] =
    stage === 1
      ? [
          { text: `Confirming on ${input.chain.name} · ${waitText(waited)}`, tone: "pri" },
          { text: "Usually under a minute." },
        ]
      : stage === 2
        ? [{ text: `Still confirming · ${waitText(waited)}`, tone: "pri" }, { text: "Keep this page open." }]
        : [
            {
              text: `Still confirming · ${waitText(waited)}`,
              tone: "warn",
              link: href ? { label: "Etherscan", href } : undefined,
            },
            { text: "Do not send it again." },
          ];
  return {
    key: "pending",
    stage,
    label: "Sending",
    lines,
    action: "none",
    button: "Confirming",
    glyph: "arc",
    foot: DEFAULT_FOOT,
  };
}
