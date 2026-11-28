import { presenceEventAbi, presenceFactoryAbi } from "@kickback/contracts";
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  InsufficientFundsError,
  TimeoutError,
  UserRejectedRequestError,
  type Abi,
  type Hex,
} from "viem";

import { fmt } from "./text";

/** Kleros's contracts (KlerosLiquid and the Dispute Resolver, v1) answer with plain reason strings. */
export const KLEROS_ERRORS: readonly (readonly [RegExp, string])[] = [
  [
    /within the appeal period/i,
    "The appeal window for this answer is closed. (The answer the jurors did not vote for can only be funded during the first half of the window.)",
  ],
  [/Appeal fee has already been paid/i, "This answer is already fully funded. Nothing more is needed for it."],
  [/no such ruling to fund/i, 'Choose an answer to fund: "Yes, attended" or "No, did not attend".'],
  [/dispute should be solved/i, "Appeal funds can only be collected once the case has its final ruling."],
  [
    /Cannot submit evidence to a resolved dispute/i,
    "This Kleros case already has its final ruling, so it takes no more evidence.",
  ],
  [/appeal period (time )?has not passed/i, "The appeal window has not ended yet."],
  [/evidence period time has not passed/i, "The evidence period of this case is still running."],
  [/not finished drawing/i, "Kleros is still drawing jurors for this round."],
  [/(commit|vote) period time has not passed/i, "Jurors are still voting."],
  [/already in the last period/i, 'The case already has its final ruling. Press "Settle the ruling".'],
  [
    /Ruling already executed|has been ruled already/i,
    'The final ruling was already delivered. Press "Settle the ruling".',
  ],
  [/Value is less than required/i, "The Kleros fee changed a moment ago. Reload the page and try again."],
];

const eth = (x: unknown) => `${fmt(BigInt(x as bigint))} ETH`;

/** Plain words for each PresenceEvent / PresenceFactory custom error, from its decoded arguments. */
export const KICKBACK_ERROR_TEXT: Record<string, (args: readonly unknown[]) => string> = {
  AlreadyInitialized: () => "This event is already set up.",
  NotOwner: () => "Only the event's organiser wallet can do this. Switch to that account in your wallet.",
  NotPendingOwner: () => "This wallet was not proposed as the new organiser.",
  NotOpen: () =>
    "The event is no longer taking deposits or changes (the list is closed, or it was paid out or cancelled).",
  NotListed: () => "This is only possible after the attendance list is closed and before the payout.",
  ZeroAddress: () => "One of the addresses is empty or zero.",
  BadConfig: ([f]) => `This event setting is not valid: ${String(f)}.`,
  TooLate: () => "Too late: this window has closed.",
  TooEarly: () => "Too early: this is not possible yet. Check the times on the page.",
  Reentrancy: () => "The contract refused this call. Nothing was sent.",
  AlreadyStaker: ([x]) => `${x} already has a deposit for this event.`,
  WasRejected: ([x]) => `The organiser turned ${x} away, so this wallet cannot deposit again.`,
  EventFull: ([x]) => `The event is full (${String(x)} ${Number(x) === 1 ? "spot" : "spots"}).`,
  NotAStaker: ([x]) => `${x} has no deposit for this event.`,
  DuplicateAttendee: ([x]) => `${x} is already on the attendance list.`,
  NoAttendees: () => "The attendance list is empty: add at least one guest who came, or cancel the event.",
  NothingToWithdraw: () => "There is nothing to withdraw for this wallet.",
  TransferFailed: ([x]) =>
    `The payment to ${x} did not go through. The receiving wallet may refuse payments. Nothing was sent.`,
  WrongAmount: ([x, y]) => `The amount must be exactly ${eth(x)} (sent ${eth(y)}).`,
  TokenEvent: () => "This event takes its deposit in a token, not ETH: use the Deposit button on the event page.",
  AlreadyAttending: ([x]) => `${x} is already on the attendance list.`,
  AlreadyChallenged: ([x]) => `${x} has already challenged.`,
  NoChallenge: ([x]) => `${x} has not challenged.`,
  WrongChallengeState: ([x]) => `The challenge from ${x} is not at a step that allows this.`,
  ArbitrationCostTooHigh: ([x, y]) =>
    `The Kleros fee went up since the challenge was opened (now ${eth(x)}, the two deposits cover ${eth(y)}), so no case can be created. Nothing was sent.`,
  NotRuled: ([x]) => `Kleros has not yet given its final ruling on the challenge from ${x}.`,
  ChallengesPending: ([x]) =>
    `${String(x)} ${Number(x) === 1 ? "challenge is" : "challenges are"} still waiting for an answer. Payouts can be released once the answer window is over.`,
  OnlyNumberedRulings: () => "Kleros returned a ruling this contract does not know. Nothing was changed.",
  InDispute: ([x]) => `${x} is in a Kleros case, so the jurors decide; this cannot be changed by hand.`,
  NotAppealable: ([x]) => `The challenge from ${x} is not in a Kleros case that can be appealed.`,
  NotEnoughGas: () =>
    "The transaction ran out of gas while paying someone. Try again, with a higher gas limit if it fails again.",
  SpareTooLow: ([x]) => `The contract only holds ${eth(x)} of spare money.`,
  BadTemplate: () => "The case description template does not fit the contract.",
  NotAnImplementation: () => "That address is not a Proof of Presence event implementation.",
};

const PRESENCE_ERRORS_ABI: Abi = [...presenceEventAbi, ...presenceFactoryAbi].filter((x) => x.type === "error");

type Decoded = { errorName: string; args: readonly unknown[] };

const isRevertData = (d: unknown): d is Hex => typeof d === "string" && /^0x[0-9a-fA-F]{8}/.test(d);

// Every object in an error's cause chain, and the nested `error` / `info.error` / `data` / `originalError`
// objects wallets and RPCs use.
function chain(e: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const visit = (x: unknown) => {
    if (!x || typeof x !== "object" || seen.has(x) || out.length > 20) return;
    seen.add(x);
    const o = x as Record<string, unknown>;
    out.push(o);
    visit(o.cause);
    visit(o.error);
    visit((o.info as Record<string, unknown> | undefined)?.error);
    // nodes and wallets nest the revert under `data`: Hardhat {data:{message,data}}, MetaMask
    // {data:{code:3,data}} or {data:{originalError:{data}}}
    if (o.data && typeof o.data === "object") visit(o.data);
    visit(o.originalError);
  };
  visit(e);
  return out;
}

function decodeRevert(e: unknown, abi: Abi): Decoded | null {
  if (isRevertData(e)) {
    try {
      const d = decodeErrorResult({ abi, data: e });
      return { errorName: d.errorName, args: d.args ?? [] };
    } catch {
      return null;
    }
  }
  for (const o of chain(e)) {
    if (o instanceof ContractFunctionRevertedError && o.data)
      return { errorName: o.data.errorName, args: o.data.args ?? [] };
    for (const d of [o.raw, o.data]) {
      if (!isRevertData(d)) continue;
      try {
        const r = decodeErrorResult({ abi, data: d });
        return { errorName: r.errorName, args: r.args ?? [] };
      } catch {
        // not one of this ABI's errors
      }
    }
  }
  return null;
}

/** The name of the PresenceEvent / PresenceFactory custom error behind `error`, when there is one. */
export function revertName(error: unknown, abi: Abi = PRESENCE_ERRORS_ABI): string | undefined {
  const decoded = decodeRevert(error, abi);
  return decoded && decoded.errorName !== "Error" && decoded.errorName !== "Panic" ? decoded.errorName : undefined;
}

/**
 * Plain-language text for an error from a read, a dry run or a send: a PresenceEvent custom error
 * (decoded with `abi`), a Kleros reason string, a wallet rejection, a rate limit, insufficient funds
 * or a timeout; otherwise the error's own message.
 */
export function errorText(error: unknown, abi: Abi = PRESENCE_ERRORS_ABI): string {
  const objs = chain(error);
  const codes = objs.map((o) => o.code);
  const texts = (keys: string[]) =>
    objs
      .flatMap((o) => keys.map((k) => o[k]))
      .filter((v): v is string => typeof v === "string" && !!v)
      .join(" ");
  // short texts only: a full message embeds calldata, whose hex digits can look like "429"
  const brief = texts(["shortMessage", "details"]);
  const raw = texts(["shortMessage", "reason", "details", "message"]);

  if (
    objs.some((o) => o instanceof UserRejectedRequestError) ||
    codes.includes(4001) ||
    codes.includes("ACTION_REJECTED") ||
    /user (rejected|denied)/i.test(brief)
  )
    return "Cancelled in your wallet. Nothing was sent.";

  const decoded = decodeRevert(error, abi);
  if (decoded && decoded.errorName !== "Error" && decoded.errorName !== "Panic") {
    const text = KICKBACK_ERROR_TEXT[decoded.errorName];
    return text
      ? text(decoded.args)
      : `The contract refused this transaction (${decoded.errorName}). Nothing was sent.`;
  }
  const reason = decoded?.errorName === "Error" ? String(decoded.args[0] ?? "") : "";
  for (const [re, text] of KLEROS_ERRORS) if (re.test(reason) || re.test(raw)) return text;
  if (reason) return reason;

  const status = objs.map((o) => o.status);
  if (
    codes.includes(429) ||
    codes.includes(-32005) ||
    status.includes(429) ||
    /rate.?limit|could not coalesce|too many requests/i.test(brief)
  )
    return "The network connection is busy (rate limited). Wait a minute and try again. Nothing was sent.";
  if (objs.some((o) => o instanceof InsufficientFundsError) || /insufficient funds/i.test(brief))
    return "This wallet does not have enough ETH for this (amount plus network fee).";
  if (objs.some((o) => o instanceof TimeoutError) || codes.includes("TIMEOUT"))
    return "The network did not answer in time. Check the link of the last transaction you sent before trying again.";
  if (error instanceof BaseError) return error.shortMessage;
  return raw || String(error);
}
