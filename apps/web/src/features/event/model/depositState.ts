import { decimalText } from "@kickback/core";
import type { Address, Hash } from "viem";

import type { SendErrorKind, SentTxOutcome } from "@/lib/web3/send";

export const DEPOSIT_STATES = [
  "rest",
  "nowallet",
  "connect",
  "wrongnet",
  "addchain",
  "approve",
  "ready",
  "insufficient",
  "signing",
  "pending",
  "done",
  "failed",
  "closed",
  "full",
  "already",
  "earlier",
  "dropped",
  "replaced",
  "refunded",
  "on-list",
  "listing",
  "challenge",
  "challenged",
  "disputed",
  "withdraw",
  "claim",
  "paid-out",
  "not-attended",
  "withdrawn",
  "checking",
] as const;

export type DepositStateKey = (typeof DEPOSIT_STATES)[number];

export type WalletStatus = "disconnected" | "connecting" | "connected";

/** The calls a guest makes besides the deposit: all money comes out through withdraw(to). */
export type MoneyAction = "withdraw" | "claim" | "challenge" | "approve";

/** The deposit() selector: the same for ETH and token events. */
export const DEPOSIT_DATA = "0xd0e30db0";

export interface GuestState {
  /** 0 None, 1 Staker, 2 Rejected, 3 Refunded. */
  status: number;
  attended: boolean;
  /** In the event's asset. */
  claimable: bigint;
  /** Challenge money, in ETH. */
  claimableEth: bigint;
  sharePaid: bigint;
  challenge: { state: number; matchEndsAt: number; arbitratorDisputeID: bigint };
}

export interface DepositInput {
  /** The contract's depositAmount, in the asset's smallest unit. */
  amount: bigint;
  /** The deposit's asset; `token` is undefined for ETH. */
  asset: { symbol: string; decimals: number; token?: Address };
  /** Unix seconds: deposits are open until the event ends. */
  eventEnd: number;
  /** 0 Open, 1 Listed, 2 Finalized, 3 Cancelled. */
  phase: number;
  claimDeadline?: number;
  /** Unix seconds; 0 while the organiser is still adding names. */
  challengeEndsAt?: number;
  /** ETH a challenge costs (Kleros's fee for the case). */
  challengeDeposit?: bigint;
  /** 0 = no limit. */
  capacity?: number;
  stakerCount?: number;
  guest?: GuestState;
  moneySend?: {
    account?: Address;
    action: MoneyAction;
    amount?: bigint;
    status: "idle" | "pending" | "success" | "error";
    error?: string;
  };
  busy?: boolean;
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
  /** ETH, read from the app's chain. */
  balance?: bigint;
  /** Token events: the wallet's token balance and what it lets the event take. */
  tokenBalance?: bigint;
  allowance?: bigint;
  /** Wei, the network fee the deposit is expected to cost. */
  fee?: bigint;
  /** This wallet's deposit logs; undefined while loading or disconnected. */
  history?: {
    txHash?: Hash;
    /** Unix seconds of the receipt deposit. */
    at?: number;
    /** Unix seconds the organiser turned the booking away (Rejected). */
    refundedAt?: number;
    /** The latest payment out of the event to this wallet. */
    paidTx?: Hash;
  };
  /** The browser's record of the last deposit sent, as reconciled with the network. */
  sent?: { outcome: SentTxOutcome; hash: Hash; at: number; data?: string; value?: string } | null;
  send: {
    account?: Address;
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
  /** Formats unix seconds as a short date ("29 Oct"). */
  dayText: (unix: number) => string;
  /** Formats unix seconds as a deadline ("Wed 4 Nov, 18:00"). */
  timeText?: (unix: number) => string;
  /** Kleros Court's page for a case. */
  caseUrl?: (arbitratorDisputeID: bigint) => string | undefined;
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

export type DepositAction =
  | "connect"
  | "switch"
  | "add-chain"
  | "deposit"
  | "approve"
  | "copy"
  | "none"
  | "withdraw"
  | "claim"
  | "challenge";

export interface DepositView {
  key: DepositStateKey;
  amount?: string;
  /** The unit after the amount; the deposit's asset when omitted. */
  unit?: string;
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

export const DEFAULT_FOOT = "Deposits stay open until the event ends";
const PENDING_STAGE_2_MS = 60_000;
const PENDING_STAGE_3_MS = 5 * 60_000;

/** "0.01" from 10^16 wei: an amount as the card prints it, without the unit. */
export const unitsText = (units: bigint, decimals = 18) => decimalText(units, decimals);
/** "0.01" from 10^16 wei. */
export const ethText = (wei: bigint) => unitsText(wei, 18);

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

function guestsLine(guests: number | undefined, capacity: number | undefined): StatusLine {
  if (guests === undefined) return { text: "" };
  if (guests === 0) return { text: "Be the first to book" };
  const left = capacity ? ` · ${Math.max(0, capacity - guests)} spots left` : "";
  return { text: `${guests} ${guests === 1 ? "guest" : "guests"} booked${left}` };
}

export const depositsOpen = (phase: number, eventEnd: number, chainNow: number | undefined) =>
  phase === 0 && chainNow !== undefined && chainNow < eventEnd;

/** The deposit card's state, from everything the page knows. Earlier rules win. */
export function depositState(input: DepositInput): DepositView {
  const { amount, asset, chain, wallet, history, explorer } = input;
  const isToken = asset.token !== undefined;
  const sym = asset.symbol;
  const fmt = (units: bigint) => unitsText(units, asset.decimals);
  const timeText = input.timeText ?? input.dayText;
  const isDepositRecord = (r: DepositInput["sent"]) =>
    r?.data === DEPOSIT_DATA && r.value === (isToken ? "0" : amount.toString());
  const sent =
    isDepositRecord(input.sent) || (input.sent?.data === undefined && input.sent?.outcome === "pending")
      ? input.sent
      : null;
  const send =
    input.send.account?.toLowerCase() === wallet.address?.toLowerCase() ? input.send : { status: "idle" as const };
  const amt = fmt(amount);
  const connected = wallet.status === "connected" && wallet.address !== undefined;
  const onChain = connected && wallet.chainId === chain.id;
  const deposit = { action: "deposit" as const, foot: DEFAULT_FOOT, disabled: input.busy };
  const receipt = (tx: Hash, when?: number) => ({
    tx,
    txUrl: txHref(explorer, tx),
    txLink: txHref(explorer, tx) ?? tx,
    wallet: wallet.address!,
    when: when === undefined ? undefined : input.dayText(when),
  });
  const done = (tx: Hash, when?: number): DepositView => ({
    key: when === undefined ? "done" : "already",
    label: "Booked",
    lines: [],
    receipt: receipt(tx, when),
    action: "copy",
    button: "Copy transaction link",
    foot: "You're in. Come to the event to get it back.",
  });
  const etherscan = (hash: Hash) => {
    const href = txHref(explorer, hash);
    return href ? { label: "Etherscan", href } : undefined;
  };
  const switchOr = <T extends DepositView>(view: T): DepositView =>
    onChain
      ? view
      : {
          ...view,
          action: wallet.needsChain ? "add-chain" : "switch",
          button: wallet.needsChain ? `Add ${chain.name} to your wallet` : `Switch to ${chain.name}`,
        };

  const moneySend =
    input.moneySend?.account?.toLowerCase() === wallet.address?.toLowerCase() ? input.moneySend : undefined;
  const errorFor = (action: MoneyAction): StatusLine | undefined =>
    moneySend?.status === "error" && moneySend.action === action
      ? { text: moneySend.error ?? "Nothing was sent. Try again.", tone: "err" }
      : undefined;
  const guest = connected ? input.guest : undefined;
  const readOnly = (
    key: DepositStateKey,
    label: string,
    lines: StatusLine[],
    value = amount,
    unit?: string,
  ): DepositView => ({
    key,
    label,
    lines,
    amount: unit === "ETH" ? ethText(value) : fmt(value),
    unit,
    action: "none",
    button: label,
    disabled: true,
    foot: null,
  });
  const moneyAction = (
    key: "claim" | "withdraw",
    label: string,
    value: bigint,
    lines: StatusLine[],
    unit?: string,
  ): DepositView =>
    switchOr({
      key,
      amount: unit === "ETH" ? ethText(value) : fmt(value),
      unit,
      label,
      lines: [errorFor("claim") ?? errorFor("withdraw") ?? lines].flat(),
      action: key,
      button: key === "claim" ? "Claim" : "Withdraw my deposit",
      disabled: input.busy,
      foot: null,
    });

  if (connected && moneySend?.status === "pending")
    return {
      ...readOnly(
        "signing",
        "Sending",
        [{ text: "Confirm in your wallet." }, { text: "Then wait for the network." }],
        moneySend.amount ?? amount,
        moneySend.action === "challenge" ? "ETH" : undefined,
      ),
      button: "Confirming",
      glyph: "arc",
    };
  if (connected && input.sent?.outcome === "pending" && input.sent.data && !isDepositRecord(input.sent))
    return {
      ...readOnly("earlier", "Sending", [
        { text: "An earlier transaction is still confirming.", link: etherscan(input.sent.hash) },
      ]),
      button: "Confirming",
      glyph: "arc",
    };

  // money waiting for this wallet: a payout, a refund, or challenge money back
  if (guest && (guest.claimable > 0n || guest.claimableEth > 0n)) {
    const eth = guest.claimable === 0n;
    const value = eth ? guest.claimableEth : guest.claimable;
    const unit = eth ? "ETH" : undefined;
    const both =
      guest.claimable > 0n && guest.claimableEth > 0n && isToken
        ? [{ text: `Plus ${ethText(guest.claimableEth)} ETH from your challenge.` }]
        : [];
    if (input.phase === 3)
      return moneyAction("withdraw", "Event cancelled", value, [
        { text: "The organiser cancelled the event." },
        { text: "Your deposit returns in full." },
      ]);
    if (input.phase === 0 && guest.status === 1)
      return moneyAction("withdraw", "Deposit available", value, [
        { text: "No attendance list came in time." },
        { text: "Your deposit returns in full." },
      ]);
    if (input.phase === 2 && guest.attended)
      return moneyAction(
        "claim",
        "Ready to claim",
        value,
        [{ text: "Thanks for coming. Here is your share of the pool." }, ...both],
        unit,
      );
    return moneyAction(
      "claim",
      "Ready to claim",
      value,
      [{ text: eth ? "Money back from your challenge." : `${fmt(value)} ${sym} is yours to take.` }, ...both],
      unit,
    );
  }

  const paidLink = history?.paidTx ? txHref(explorer, history.paidTx) : undefined;
  const paidLine = paidLink ? [{ text: "", link: { label: "Payout transaction", href: paidLink } }] : [];

  if (guest && input.phase === 2 && guest.attended)
    return readOnly(
      "paid-out",
      "Paid out",
      [{ text: `Paid out ${fmt(guest.sharePaid)} ${sym}` }, ...paidLine],
      guest.sharePaid,
    );

  const challenge = guest?.challenge;
  const kleros = (id: bigint) => {
    const href = input.caseUrl?.(id);
    return href ? { label: "Kleros case", href } : undefined;
  };
  const ruledAbsent = challenge?.state === 3 && !guest?.attended;

  if (guest?.status === 1 && input.phase === 2 && !guest.attended)
    return readOnly("not-attended", "Not on the attendance list", [
      {
        text: ruledAbsent ? "Kleros jurors ruled you were not there." : "Your deposit went to the guests who came.",
      },
    ]);

  if (guest?.status === 1 && input.phase === 1) {
    if (guest.attended)
      return readOnly("on-list", "On the attendance list", [
        { text: "You're on the list.", tone: "pri" },
        {
          text: input.challengeEndsAt
            ? `Payouts open after ${timeText(input.challengeEndsAt)}.`
            : "Payouts open once the list is final.",
        },
      ]);
    if (challenge?.state === 1)
      return readOnly("challenged", "Challenge sent", [
        { text: "You said you were there.", tone: "pri" },
        { text: `The organiser can answer until ${timeText(challenge.matchEndsAt)}.` },
      ]);
    if (challenge?.state === 2)
      return readOnly("disputed", "With Kleros", [
        { text: "Kleros jurors are deciding if you came.", tone: "pri", link: kleros(challenge.arbitratorDisputeID) },
        { text: "Send your proof on the case page." },
      ]);
    if (ruledAbsent)
      return readOnly("not-attended", "Not on the attendance list", [
        { text: "Kleros jurors ruled you were not there." },
      ]);
    if (!input.challengeEndsAt)
      return readOnly("listing", "Attendance list", [
        { text: "The organiser is posting who came." },
        { text: "You're not on it yet. Check back soon." },
      ]);
    if (input.chainNow !== undefined && input.chainNow <= input.challengeEndsAt) {
      const cost = input.challengeDeposit ?? 0n;
      const error = errorFor("challenge");
      return switchOr({
        key: "challenge",
        label: "Not on the list",
        amount: ethText(cost),
        unit: "ETH",
        lines: error
          ? [error]
          : [
              { text: "Came but missing? Challenge the list.", tone: "warn" },
              { text: `Open until ${timeText(input.challengeEndsAt)}. Kleros decides.` },
            ],
        action: "challenge",
        button: "Challenge the list",
        disabled: input.busy || (input.balance !== undefined && input.balance < cost),
        foot: "The organiser can match it and Kleros jurors decide. The winner's side is refunded.",
        shake: error !== undefined,
      });
    }
    return readOnly("not-attended", "Not on the attendance list", [{ text: "The challenge window has closed." }]);
  }

  if (guest?.status === 2)
    return {
      key: "refunded",
      label: "Turned away",
      lines: [
        {
          text:
            history?.refundedAt !== undefined
              ? `The organiser returned your deposit on ${input.dayText(history.refundedAt)}.`
              : "The organiser returned your deposit in full.",
        },
        { text: "This wallet cannot book this event again." },
      ],
      action: "none",
      button: "Deposit returned",
      disabled: true,
      foot: null,
    };
  if (guest?.status === 3)
    return readOnly("withdrawn", "Deposit returned", [{ text: "Your deposit was returned in full." }, ...paidLine]);

  if (connected && guest?.status === 1) {
    if (history?.txHash) return done(history.txHash, history.at ?? input.chainNow ?? 0);
    return { ...readOnly("already", "Booked", [{ text: "You're booked for this event." }]), button: "Booked" };
  }

  if (send.status === "success" && send.hash && connected) return done(send.hash);
  if (connected && sent?.outcome === "mined" && isDepositRecord(sent)) return done(sent.hash, Math.floor(sent.at / 1000));
  // a mined record without call data cannot be told apart from a deposit until the contract answers
  if (connected && input.sent?.data === undefined && input.sent?.outcome === "mined" && guest === undefined)
    return {
      key: "earlier",
      label: "Refundable deposit",
      lines: [
        { text: "A transaction from this browser went through.", tone: "pri" },
        { text: "Checking it before you deposit again.", link: etherscan(input.sent.hash) },
      ],
      action: "none",
      button: "Checking",
      disabled: true,
      glyph: "arc",
      foot: DEFAULT_FOOT,
    };

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
        {
          text: sent.data ? "An earlier deposit is still confirming." : "An earlier transaction is still confirming.",
          tone: "pri",
        },
        { text: `Sent ${agoText(input.wallNow - sent.at)} ago`, link: etherscan(sent.hash) },
      ],
      action: "none",
      button: "Confirming",
      glyph: "arc",
      foot: DEFAULT_FOOT,
    };

  if (input.chainNow === undefined)
    return {
      ...readOnly("checking", "Refundable deposit", [{ text: "Reading the event's clock." }]),
      button: "Checking deposits",
      glyph: "arc",
    };
  const ended = input.chainNow >= input.eventEnd;
  if (ended || input.phase !== 0)
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
                : "The event has ended.",
        },
      ],
      action: "none",
      button: "Bookings closed",
      disabled: true,
      foot: null,
    };
  if (input.capacity && input.stakerCount !== undefined && input.stakerCount >= input.capacity)
    return {
      key: "full",
      label: "Refundable deposit",
      lines: [{ text: `All ${input.capacity} spots are booked.` }, { text: "A spot opens if a guest is turned away." }],
      action: "none",
      button: "Event full",
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
      lines: [guestsLine(input.guests, input.capacity)],
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
      { text: `Your ${amt} ${sym} stayed in your wallet.`, tone: "err" },
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

  let notice: StatusLine | undefined = errorFor("approve");
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

  const recheck = { label: "Check again", id: "recheck" as const };
  if (isToken) {
    if (input.tokenBalance !== undefined && input.tokenBalance < amount)
      return {
        key: "insufficient",
        label: "Refundable deposit",
        lines: [
          { text: `${fmt(input.tokenBalance)} ${sym} available`, tone: "err", action: recheck },
          { text: `${amt} ${sym} needed.` },
        ],
        action: "none",
        button: `Not enough ${sym}`,
        disabled: true,
        foot: DEFAULT_FOOT,
      };
    if (input.balance !== undefined && input.fee !== undefined && input.balance < input.fee)
      return {
        key: "insufficient",
        label: "Refundable deposit",
        lines: [
          { text: `${ethText(input.balance)} ETH available`, tone: "err", action: recheck },
          { text: `About ${ethText(input.fee)} ETH needed for the network fee.` },
        ],
        action: "none",
        button: "Not enough ETH for the fee",
        disabled: true,
        foot: DEFAULT_FOOT,
      };
  } else {
    const needed = amount + (input.fee ?? 0n);
    if (input.balance !== undefined && input.balance < needed)
      return {
        key: "insufficient",
        label: "Refundable deposit",
        lines: [
          { text: `${ethText(input.balance)} ETH available`, tone: "err", action: recheck },
          { text: input.fee === undefined ? `${amt} ETH needed.` : `${ethText(needed)} ETH needed with the fee.` },
        ],
        action: "none",
        button: "Not enough ETH",
        disabled: true,
        foot: DEFAULT_FOOT,
      };
  }

  const shown = isToken ? input.tokenBalance : input.balance;
  const where = shown === undefined ? `On ${chain.name}` : `On ${chain.name} · ${fmt(shown)} ${sym} available`;

  if (isToken && (input.allowance === undefined || input.allowance < amount))
    return {
      key: "approve",
      label: "Refundable deposit",
      lines: notice
        ? [notice, { text: where }]
        : [{ text: `Step 1 of 2: allow the event to take exactly ${amt} ${sym}.`, tone: "pri" }, { text: where }],
      action: "approve",
      button: `Allow ${amt} ${sym}`,
      disabled: input.busy || input.allowance === undefined,
      shake: notice !== undefined,
      foot: DEFAULT_FOOT,
    };

  return {
    key: "ready",
    label: "Refundable deposit",
    lines: notice
      ? [notice, { text: where }]
      : isToken
        ? [{ text: `Step 2 of 2: send your ${amt} ${sym} deposit.`, tone: "pri" }, { text: where }]
        : [{ text: where }],
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
