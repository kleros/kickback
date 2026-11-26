import { readableUnits } from "@kickback/core";
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
  "restoring",
  "resolve",
  "release",
] as const;

export type DepositStateKey = (typeof DEPOSIT_STATES)[number];

export type WalletStatus = "disconnected" | "connecting" | "connected";

/** The calls a guest makes besides the deposit: all money comes out through withdraw(to). */
export type MoneyAction = "withdraw" | "claim" | "challenge" | "approve" | "resolve" | "release";

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
  challenge: {
    state: number;
    matchEndsAt: number;
    arbitratorDisputeID: bigint;
    /** ETH the guest paid to challenge. */
    deposit?: bigint;
    /** The Dispute Resolver's case number, where evidence is sent. */
    localDisputeID?: bigint;
    /** A Kleros case's ruling: 0 refused to rule, 1 came, 2 did not come. */
    ruling?: number;
    /** A case with Kleros: the jurors' ruling is final, so anyone can settle it. Undefined when unknown. */
    isRuled?: boolean;
  };
}

export interface DepositInput {
  /** The contract's depositAmount, in the asset's smallest unit. */
  amount: bigint;
  /** The deposit's asset; `token` is undefined for ETH. */
  asset: { symbol: string; decimals: number; token?: Address };
  /** Unix seconds: the organiser can turn guests away until then. */
  eventStart?: number;
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
  /** True while the connected wallet's booking has not been read yet (loading, or the read failed). */
  guestUnknown?: boolean;
  moneySend?: {
    account?: Address;
    action: MoneyAction;
    amount?: bigint;
    /** The unit of `amount` when it is not the event's asset ("ETH" for challenge money). */
    unit?: string;
    status: "idle" | "pending" | "success" | "error";
    error?: string;
    /** "refused" when the dry run said the call would fail. */
    errorKind?: SendErrorKind;
    /** Set once the wallet has signed: the transaction is confirming. */
    hash?: Hash;
  };
  /** Phase 1 after the challenge window: whether payouts can be released now, and with which expired challenges. */
  release?: { expired: readonly Address[]; blocked: boolean };
  /** Wei, the network fee a challenge is expected to cost. */
  challengeFee?: bigint;
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
    /** Adding the chain to the wallet failed or was declined. */
    chainFailed?: boolean;
    /** The wallet is restoring the last session (page load), not a connect the guest started. */
    restoring?: boolean;
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
    /** The contract's custom error behind a refusal ("EventFull"). */
    errorName?: string;
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
  /** The Dispute Resolver's page for a case (its local dispute ID), where evidence is sent. */
  evidenceUrl?: (localDisputeID: bigint) => string | undefined;
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
  | "challenge"
  | "resolve"
  | "release";

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
  /** No action for this guest: the card shows the button text as a status, not a button. */
  status?: boolean;
  /** Done/already only: the event has ended, so the "tell friends" share row is hidden. */
  ended?: boolean;
  /** Copy views without a receipt: the text the copy button copies. */
  copy?: string;
}

export const DEFAULT_FOOT = "Then give Luma your deposit link.";
const PENDING_STAGE_2_MS = 60_000;
const PENDING_STAGE_3_MS = 5 * 60_000;

/** "0.01" from 10^16 wei: an amount as the card prints it, without the unit. */
export const unitsText = (units: bigint, decimals = 18) => readableUnits(units, decimals);
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
  if (guests === 0) return { text: "Be the first to deposit." };
  const spots = capacity ? Math.max(0, capacity - guests) : 0;
  const left = capacity ? ` · ${spots} ${spots === 1 ? "spot" : "spots"} left` : "";
  return { text: `${guests} ${guests === 1 ? "deposit" : "deposits"} so far${left}.` };
}

/** The card's one-line version of a send error, where the full sentence would wrap on a phone. */
const SHORT_ERRORS: Partial<Record<SendErrorKind, string>> = {
  busy: "Wait for the other action to finish.",
  "account-changed": "Wallet switched accounts. Try again.",
  "wrong-chain": "Wrong network. Switch and try again.",
  "no-account": "Connect your wallet first.",
};

/** A wallet-side failure: only a rejection is the guest's own cancel. */
function walletText(message: string | undefined): string {
  const m = message ?? "";
  if (m.startsWith("Cancelled in your wallet")) return "Cancelled in your wallet. Nothing was sent.";
  if (/enough ETH|insufficient funds/i.test(m)) return "Not enough ETH. Nothing was sent.";
  return "Your wallet hit an error. Nothing was sent.";
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
  const recheck = { label: "Check again", id: "recheck" as const };
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
  // after the end, before the list: tell a guest with a deposit what happens next
  const awaitingList = input.phase === 0 && input.chainNow !== undefined && input.chainNow >= input.eventEnd;
  const listDue = input.claimDeadline ? input.dayText(input.claimDeadline) : undefined;
  const me = wallet.address ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : "";
  // an amount owed to the guest: rounded down, without the "≈" that reads as unsure
  const owed = (units: bigint, unit?: string) => (unit === "ETH" ? ethText(units) : fmt(units)).replace(/^[~≈]/, "");
  const awaitingLines: StatusLine[] = [
    {
      text: listDue ? `The organiser confirms who came by ${listDue}.` : "Next, the organiser confirms who came.",
      tone: "pri",
    },
    { text: "Left off the list? You can challenge." },
  ];
  const done = (tx: Hash, when?: number): DepositView => ({
    key: when === undefined ? "done" : "already",
    label: "Deposit sent",
    lines: awaitingList ? awaitingLines : [],
    receipt: receipt(tx, when),
    action: "copy",
    button: "Copy deposit link",
    foot: awaitingList ? null : "Paste it in Luma for approval.",
    ended: awaitingList || undefined,
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
  // the card's lines are short: a refusal gets one plain line, the full reason stays for the organiser pages
  const errorFor = (action: MoneyAction): StatusLine | undefined =>
    moneySend?.status === "error" && moneySend.action === action
      ? {
          text:
            moneySend.errorKind === "refused"
              ? "This would fail now. Nothing was sent."
              : moneySend.errorKind === "unconfirmed"
                ? "Sent, not confirmed yet. Check before retrying."
                : moneySend.errorKind === "reverted"
                  ? "It failed. Only the network fee was spent."
                  : moneySend.errorKind === "wallet"
                    ? walletText(moneySend.error)
                    : (moneySend.error ?? "Nothing was sent. Try again."),
          tone: moneySend.errorKind === "unconfirmed" ? "warn" : "err",
        }
      : undefined;
  const guest = connected ? input.guest : undefined;
  const readOnly = (
    key: DepositStateKey,
    label: string,
    lines: StatusLine[],
    value = amount,
    unit?: string,
    button = label,
  ): DepositView => ({
    key,
    label,
    lines,
    amount: owed(value, unit),
    unit,
    action: "none",
    button,
    disabled: true,
    status: true,
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
      amount: owed(value, unit),
      unit,
      label,
      lines: [errorFor("claim") ?? errorFor("withdraw") ?? lines].flat(),
      action: key,
      button: key === "claim" ? "Claim" : "Withdraw my deposit",
      disabled: input.busy,
      foot: null,
    });

  if (connected && moneySend?.status === "pending") {
    // before the wallet signs, point to the wallet; after, the transaction is confirming
    const signed = moneySend.hash !== undefined;
    return {
      ...readOnly(
        "signing",
        moneySend.action === "claim"
          ? "Claiming"
          : moneySend.action === "withdraw"
            ? "Withdrawing"
            : moneySend.action === "challenge"
              ? "Sending challenge"
              : moneySend.action === "release"
                ? "Releasing payouts"
                : "Sending",
        signed
          ? [{ text: `Confirming on ${chain.name}.`, tone: "pri", link: etherscan(moneySend.hash!) }]
          : [{ text: "Open your wallet to confirm.", tone: "pri" }, { text: "Then wait for the network." }],
        moneySend.amount ?? amount,
        moneySend.unit ?? (moneySend.action === "challenge" ? "ETH" : undefined),
      ),
      button: signed ? "Confirming" : "Confirm in your wallet",
      glyph: signed ? "arc" : "ring",
      status: false,
    };
  }
  if (connected && input.sent?.outcome === "pending" && input.sent.data && !isDepositRecord(input.sent))
    return {
      ...readOnly("earlier", "Sending", [
        { text: "An earlier transaction is still confirming.", link: etherscan(input.sent.hash) },
      ]),
      button: "Confirming",
      glyph: "arc",
      status: false,
    };

  // money waiting for this wallet: a payout, a refund, or challenge money back
  if (guest && (guest.claimable > 0n || guest.claimableEth > 0n)) {
    const eth = guest.claimable === 0n;
    // an ETH event pays both amounts in one withdrawal; a token event pays them in their own units
    const value = isToken ? (eth ? guest.claimableEth : guest.claimable) : guest.claimable + guest.claimableEth;
    const unit = isToken && eth ? "ETH" : undefined;
    const both =
      guest.claimable > 0n && guest.claimableEth > 0n && isToken
        ? [{ text: `Plus ${ethText(guest.claimableEth)} ETH from your challenge.` }]
        : [];
    if (input.phase === 3)
      return moneyAction(
        "withdraw",
        "Event cancelled",
        value,
        [{ text: "The organiser cancelled the event." }, { text: "Withdraw your full deposit below." }],
        unit,
      );
    if (input.phase === 0 && guest.status === 1)
      return moneyAction(
        "withdraw",
        "Deposit available",
        value,
        [{ text: "Attendance was not confirmed in time." }, { text: "Withdraw your full deposit below." }],
        unit,
      );
    if (input.phase === 2 && guest.attended)
      return moneyAction(
        "claim",
        "Ready to claim",
        value,
        [{ text: "Thanks for coming. Here is your payout." }, ...both],
        unit,
      );
    return moneyAction(
      "claim",
      "Ready to claim",
      value,
      [
        { text: eth ? "ETH from your challenge is ready to claim." : `${fmt(value)} ${sym} is ready to claim.` },
        ...both,
      ],
      unit,
    );
  }

  const paidLink = history?.paidTx ? txHref(explorer, history.paidTx) : undefined;
  const paidLine = (label: string): StatusLine[] => (paidLink ? [{ text: "", link: { label, href: paidLink } }] : []);

  if (guest && input.phase === 2 && guest.attended)
    return readOnly(
      "paid-out",
      "Paid out",
      [{ text: `Sent to ${me}. All done.` }, ...paidLine("Payout transaction")],
      guest.sharePaid,
      undefined,
      "Nothing left to do",
    );

  const challenge = guest?.challenge;
  const kleros = (id: bigint) => {
    const href = input.caseUrl?.(id);
    return href ? { label: "Kleros case", href } : undefined;
  };
  // evidence goes to the Dispute Resolver's case page; the court's page is the fallback
  const caseLink = (c: NonNullable<typeof challenge>) => {
    const ev = c.localDisputeID !== undefined ? input.evidenceUrl?.(c.localDisputeID) : undefined;
    return ev ? { label: "Case page", href: ev } : kleros(c.arbitratorDisputeID);
  };
  const disputedLines = (c: NonNullable<typeof challenge>): StatusLine[] => [
    { text: "Kleros jurors are deciding.", tone: "pri", link: caseLink(c) },
    { text: "Send your evidence on the case page." },
  ];
  // Kleros has ruled but nobody has settled the case yet: anyone can, so the guest can too
  const ruledCase = (c: NonNullable<typeof challenge>): DepositView | undefined => {
    if (!c.isRuled || c.ruling === undefined || c.ruling > 2) return undefined;
    if (c.ruling === 2)
      return readOnly(
        "disputed",
        "Kleros has ruled",
        [{ text: "Kleros jurors ruled you were not there.", tone: "pri", link: caseLink(c) }],
        amount,
        undefined,
        "Nothing left to do",
      );
    const error = errorFor("resolve");
    return switchOr({
      key: "resolve",
      label: "Kleros has ruled",
      amount: ethText(c.deposit ?? 0n),
      unit: "ETH",
      lines: error
        ? [error]
        : [
            {
              text: c.ruling === 1 ? "Kleros jurors ruled you attended." : "Kleros jurors did not rule either way.",
              tone: "pri",
            },
            { text: "Confirm to settle the ruling." },
          ],
      action: "resolve",
      button: c.ruling === 1 ? "Join the list" : "Settle the ruling",
      disabled: input.busy,
      foot: c.ruling === 1 ? "Your Kleros fee comes back." : "Half the remaining fee comes back.",
      shake: error !== undefined,
    });
  };
  const ruled = challenge?.state === 3 && !guest?.attended;
  const refusedToRule = ruled && challenge?.ruling === 0;
  const ruledText = refusedToRule
    ? "Kleros jurors did not rule either way."
    : "Kleros jurors ruled you were not there.";

  if (guest?.status === 1 && input.phase === 2 && !guest.attended && challenge?.state === 2)
    return (
      ruledCase(challenge) ??
      readOnly("disputed", "With Kleros", disputedLines(challenge), amount, undefined, "Waiting for jurors")
    );

  if (guest?.status === 1 && input.phase === 2 && !guest.attended)
    return readOnly(
      "not-attended",
      "Not on the attendance list",
      [{ text: ruled ? ruledText : "Your deposit went to the guests who came." }],
      amount,
      undefined,
      "Nothing left to do",
    );

  if (guest?.status === 1 && input.phase === 1) {
    const windowOver =
      !!input.challengeEndsAt && input.chainNow !== undefined && input.chainNow > input.challengeEndsAt;
    if (guest.attended) {
      // anyone can release payouts once no challenge is still waiting for an answer
      if (windowOver && input.release && !input.release.blocked) {
        const error = errorFor("release");
        return switchOr({
          key: "release",
          label: "On the attendance list",
          amount: owed(amount),
          lines: error
            ? [error]
            : [{ text: "Challenges have closed.", tone: "pri" }, { text: "Anyone can release payouts now." }],
          action: "release",
          button: "Release payouts",
          disabled: input.busy,
          foot: "Then claim your share here.",
          shake: error !== undefined,
        });
      }
      if (windowOver)
        return readOnly(
          "on-list",
          "On the attendance list",
          [{ text: "You are on the list.", tone: "pri" }, { text: "Challenges have closed. Payouts come next." }],
          amount,
          undefined,
          "Waiting for payouts",
        );
      return readOnly(
        "on-list",
        "On the attendance list",
        [
          { text: "You are on the list.", tone: "pri" },
          {
            text: input.challengeEndsAt
              ? `Challenges close ${timeText(input.challengeEndsAt)}.`
              : "Payouts come once the list is final.",
          },
        ],
        amount,
        undefined,
        "Waiting for payouts",
      );
    }
    if (challenge?.state === 1) {
      const paid = challenge.deposit || input.challengeDeposit;
      // the organiser did not answer in time: the guest can settle it and join the list
      if (input.chainNow !== undefined && input.chainNow > challenge.matchEndsAt) {
        const error = errorFor("resolve");
        return switchOr({
          key: "resolve",
          label: "Challenge accepted",
          amount: ethText(paid ?? 0n),
          unit: "ETH",
          lines: error
            ? [error]
            : [
                { text: "The organiser did not answer in time.", tone: "pri" },
                { text: "Join now, or wait for payouts to add you." },
              ],
          action: "resolve",
          button: "Join the list",
          disabled: input.busy,
          foot: "Your Kleros fee comes back.",
          shake: error !== undefined,
        });
      }
      return readOnly(
        "challenged",
        "Challenge sent",
        [
          {
            text: paid ? `You paid the ${ethText(paid)} ETH Kleros fee.` : "Challenge sent.",
            tone: "pri",
          },
          // the full time, so the guest can tell on the day itself; the card offers "Join the list" once it passes
          { text: `Answer expected by ${timeText(challenge.matchEndsAt)}.` },
        ],
        paid ?? amount,
        paid ? "ETH" : undefined,
        "Waiting for the organiser",
      );
    }
    if (challenge?.state === 2)
      return (
        ruledCase(challenge) ??
        readOnly("disputed", "With Kleros", disputedLines(challenge), amount, undefined, "Waiting for jurors")
      );
    if (ruled)
      return readOnly(
        "not-attended",
        "Not on the attendance list",
        [{ text: ruledText }],
        amount,
        undefined,
        "Nothing left to do",
      );
    if (!input.challengeEndsAt)
      return readOnly(
        "listing",
        "Attendance list",
        [
          {
            text: listDue ? `The organiser confirms who came by ${listDue}.` : "The organiser is confirming who came.",
          },
          { text: "Left off the list? You can challenge." },
        ],
        amount,
        undefined,
        "Waiting for the list",
      );
    if (!windowOver && input.chainNow !== undefined) {
      const cost = input.challengeDeposit ?? 0n;
      const error = errorFor("challenge");
      // the wallet also pays the network fee; while that is unknown, only the Kleros fee is checked
      const need = cost + (input.challengeFee ?? 0n);
      const short = input.balance !== undefined && input.balance < need;
      return switchOr({
        key: "challenge",
        label: "Kleros fee to challenge",
        amount: ethText(cost),
        unit: "ETH",
        lines: error
          ? [error]
          : short
            ? [
                { text: `${ethText(input.balance!)} ETH available`, tone: "err", action: recheck },
                {
                  text:
                    input.challengeFee === undefined
                      ? `Add ETH by ${timeText(input.challengeEndsAt)}.`
                      : `${ethText(need)} ETH needed by ${timeText(input.challengeEndsAt)}.`,
                },
              ]
            : [
                { text: "Were you there? Challenge to be added.", tone: "warn" },
                { text: `Challenges close ${timeText(input.challengeEndsAt)}.` },
              ],
        action: "challenge",
        button: short && !error ? "Not enough ETH" : "Challenge the list",
        disabled: input.busy || short || input.challengeDeposit === undefined,
        foot: "Disputed? Kleros jurors decide.",
        shake: error !== undefined,
      });
    }
    return readOnly(
      "not-attended",
      "Not on the attendance list",
      [{ text: "The challenge window has closed." }],
      amount,
      undefined,
      "Nothing left to do",
    );
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
        { text: "This wallet cannot deposit again." },
      ],
      action: "none",
      button: "Deposit returned",
      disabled: true,
      status: true,
      foot: null,
    };
  if (guest?.status === 3)
    return readOnly(
      "withdrawn",
      "Deposit returned",
      [{ text: "Your deposit was returned in full." }, ...paidLine("Refund transaction")],
      amount,
      undefined,
      "Nothing left to do",
    );

  if (connected && guest?.status === 1) {
    if (history?.txHash) return done(history.txHash, history.at);
    // the deposit is on-chain but its transaction is not known yet
    if (history === undefined)
      return {
        ...readOnly("already", "Deposit sent", [
          { text: "Your deposit is in.", tone: "pri" },
          { text: "Finding your deposit link…" },
        ]),
        button: "Finding your link",
        glyph: "arc",
        status: false,
      };
    if (awaitingList)
      return {
        ...readOnly("already", "Deposit sent", awaitingLines),
        button: "Waiting for the list",
      };
    // the logs did not name the transaction: the wallet's own page still proves the deposit
    const walletLink = explorer ? `${explorer}/address/${wallet.address}` : wallet.address!;
    return {
      key: "already",
      label: "Deposit sent",
      lines: [
        { text: "Your deposit is in.", tone: "pri" },
        { text: explorer ? "Paste your wallet link in Luma." : "Paste your wallet address in Luma." },
      ],
      action: "copy",
      copy: walletLink,
      button: explorer ? "Copy wallet link" : "Copy wallet address",
      foot: null,
    };
  }

  if (send.status === "success" && send.hash && connected) return done(send.hash);
  if (connected && sent?.outcome === "mined" && isDepositRecord(sent))
    return done(sent.hash, Math.floor(sent.at / 1000));
  // a mined record without call data cannot be told apart from a deposit until the contract answers
  if (connected && input.sent?.data === undefined && input.sent?.outcome === "mined" && guest === undefined)
    return {
      key: "earlier",
      label: "Refundable deposit",
      lines: [
        { text: "An earlier transaction went through.", tone: "pri" },
        { text: "Checking whether it was your deposit.", link: etherscan(input.sent.hash) },
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
        lines: [{ text: "Open your wallet to confirm the deposit.", tone: "pri" }],
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
      ...readOnly("checking", "Refundable deposit", [{ text: "Loading the event…" }]),
      button: "Loading",
      glyph: "arc",
      status: false,
    };
  // never judge a connected wallet (no deposit, or deposits closed) before its record has loaded
  if (connected && input.guestUnknown)
    return {
      ...readOnly("checking", "Refundable deposit", [{ text: "Checking your deposit." }]),
      button: "Checking deposits",
      glyph: "arc",
      status: false,
    };

  // a visitor without a wallet may have deposited before: the card is the page's only way to connect
  const connectFor = (key: "closed" | "full", first: string): DepositView =>
    wallet.restoring
      ? {
          key,
          label: "Refundable deposit",
          lines: [{ text: "Checking your wallet." }],
          action: "none",
          button: "Checking your wallet",
          disabled: true,
          glyph: "arc",
          foot: null,
        }
      : wallet.status === "connecting"
        ? {
            key,
            label: "Refundable deposit",
            lines: [{ text: "Waiting for your wallet to connect.", tone: "pri" }],
            action: "none",
            button: "Approve in your wallet",
            glyph: "ring",
            foot: null,
          }
        : wallet.asked && !wallet.hasProvider
          ? {
              key,
              label: "Refundable deposit",
              lines: [
                { text: "No wallet found in this browser." },
                { text: "Choose a wallet app, or use its browser." },
              ],
              action: "connect",
              button: "Connect wallet",
              foot: null,
            }
          : {
              key,
              label: "Refundable deposit",
              lines: [{ text: first }, { text: "Deposited? Connect that wallet." }],
              action: "connect",
              button: "Connect wallet",
              foot: null,
            };

  const ended = input.chainNow >= input.eventEnd;
  if (ended || input.phase !== 0) {
    const reason =
      input.phase === 3
        ? "The event was cancelled."
        : input.phase === 1
          ? input.challengeEndsAt && input.chainNow > input.challengeEndsAt
            ? "Challenges have closed. Payouts come next."
            : "Challenges are open for guests left off."
          : input.phase === 2
            ? "Payouts have been released."
            : "The event has ended.";
    if (!connected) return connectFor("closed", reason);
    return {
      key: "closed",
      label: "Refundable deposit",
      // two lines fit: a wallet with no deposit gets the fix instead of the reason
      lines: !guest?.status
        ? [{ text: `No deposit from ${me}.`, tone: "warn" as const }, { text: "Used another wallet? Switch to it." }]
        : [{ text: reason }],
      action: "none",
      button: "Deposits closed",
      disabled: true,
      status: true,
      foot: null,
    };
  }
  if (input.capacity && input.stakerCount !== undefined && input.stakerCount >= input.capacity) {
    const taken = input.capacity === 1 ? "The only spot is taken." : `All ${input.capacity} spots are taken.`;
    if (!connected) return connectFor("full", taken);
    const canReject = input.eventStart === undefined || input.chainNow < input.eventStart;
    return {
      key: "full",
      label: "Refundable deposit",
      lines: canReject ? [{ text: taken }, { text: "A spot opens if a guest is turned away." }] : [{ text: taken }],
      action: "none",
      button: "Event full",
      disabled: true,
      foot: null,
    };
  }

  if (!connected) {
    if (wallet.restoring)
      return {
        key: "restoring",
        label: "Refundable deposit",
        lines: [{ text: "Checking your wallet." }],
        action: "none",
        button: "Checking your wallet",
        disabled: true,
        glyph: "arc",
        foot: DEFAULT_FOOT,
      };
    if (wallet.status === "connecting")
      return {
        key: "connect",
        label: "Refundable deposit",
        lines: [{ text: "Waiting for your wallet to connect.", tone: "pri" }],
        action: "none",
        button: "Approve in your wallet",
        glyph: "ring",
        foot: DEFAULT_FOOT,
      };
    // the picker closed without a wallet in this browser: point to WalletConnect or the wallet app's browser
    if (wallet.asked && !wallet.hasProvider)
      return {
        key: "nowallet",
        label: "Refundable deposit",
        lines: [{ text: "No wallet found in this browser." }, { text: "Choose a wallet app, or use its browser." }],
        action: "connect",
        button: "Connect wallet",
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
        lines: [
          wallet.chainFailed
            ? { text: `Your wallet did not add ${chain.name}. Try again.`, tone: "err" }
            : { text: `${chain.name} is not in your wallet yet.`, tone: "warn" },
        ],
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
  // a refused deposit: say why in one short line; a refusal that cannot change ends the retry loop
  const refused = (name: string | undefined): DepositView => {
    const final: Record<string, [string, string]> = {
      EventFull: ["The event just filled up.", "Event full"],
      WasRejected: ["The organiser turned this wallet away.", "Deposit returned"],
      NotOpen: ["Deposits have just closed.", "Deposits closed"],
      TooLate: ["Deposits have just closed.", "Deposits closed"],
    };
    const hit = name ? final[name] : undefined;
    return {
      key: "failed",
      label: "Not sent",
      lines: [
        { text: hit ? hit[0] : "This deposit would fail.", tone: "err" },
        { text: `Your ${amt} ${sym} stayed in your wallet.` },
      ],
      shake: true,
      ...deposit,
      button: hit ? hit[1] : "Try again",
      disabled: hit ? true : input.busy,
    };
  };
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
        return refused("errorName" in send ? send.errorName : undefined);
      case "unconfirmed":
        return send.hash ? pendingView(input, send.hash, PENDING_STAGE_3_MS) : dropped;
      case "wallet":
        notice = { text: walletText(send.errorMessage), tone: "err" };
        break;
      default:
        notice = {
          text: (send.errorKind && SHORT_ERRORS[send.errorKind]) ?? send.errorMessage ?? "Nothing was sent. Try again.",
          tone: "err",
        };
    }
  }

  if (sent?.outcome === "dropped") return dropped;
  if (sent?.outcome === "replaced") return replaced(sent.hash);
  if (sent?.outcome === "failed" && send.status === "idle") return failed(true);

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
          {
            text:
              input.fee === undefined ? `${amt} ETH needed.` : `${ethText(needed)} ETH needed with the network fee.`,
          },
        ],
        action: "none",
        button: "Not enough ETH",
        disabled: true,
        foot: DEFAULT_FOOT,
      };
  }

  const shown = isToken ? input.tokenBalance : input.balance;
  const where = shown === undefined ? `From ${me}` : `From ${me} · ${fmt(shown)} ${sym}`;

  if (isToken && (input.allowance === undefined || input.allowance < amount))
    return {
      key: "approve",
      label: "Refundable deposit",
      lines: notice
        ? [notice, { text: where }]
        : [{ text: `Step 1 of 2: allow exactly ${amt} ${sym}.`, tone: "pri" }, { text: where }],
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
