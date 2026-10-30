import { kickbackAbi } from "@kickback/contracts";
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
  [/no such ruling to fund/i, "Choose an answer to fund: Yes, attended or No, did not attend."],
  [/dispute should be solved/i, "Appeal money can only be collected once the case has its final ruling."],
  [
    /Cannot submit evidence to a resolved dispute/i,
    "This Kleros case already has its final ruling, so it takes no more evidence.",
  ],
  [/appeal period (time )?has not passed/i, "The appeal window has not ended yet."],
  [/evidence period time has not passed/i, "The evidence period of this case is still running."],
  [/not finished drawing/i, "Kleros is still drawing jurors for this round."],
  [/(commit|vote) period time has not passed/i, "Jurors are still voting."],
  [
    /already in the last period/i,
    'The case already has its final ruling. Press "Deliver final ruling" (it skips this step), then Settle.',
  ],
  [/Ruling already executed|has been ruled already/i, "The final ruling was already delivered. Press Settle."],
  [/Value is less than required/i, "The Kleros fee changed a moment ago. Press Refresh and try again."],
];

const eth = (x: unknown) => `${fmt(BigInt(x as bigint))} ETH`;
const REDO_DEPOSITS =
  'Press "Load deposits" again (and "Check the Luma list" again if you used it), then check the ticked guests before you try again.';
const REDO_PLAN = "Build the attendance list again.";

/** Plain words for each TruthPaysKickback custom error, from its decoded arguments. */
export const KICKBACK_ERROR_TEXT: Record<string, (args: readonly unknown[]) => string> = {
  NotOwner: () => "Only the owner wallet can do this. Switch to the owner account in your wallet.",
  NotPendingOwner: () => "This wallet was not proposed as the new owner.",
  NotOpen: () =>
    "The attendance list is already posted, or the event is paid out or cancelled, so this is no longer possible.",
  NotListed: () => "This is only possible after the attendance list is posted and before the payout.",
  AlreadyAttending: ([x]) => `${x} is already on the attendance list.`,
  AlreadyChallenged: ([x]) => `${x} has already challenged.`,
  NoChallenge: ([x]) => `${x} has not challenged.`,
  WrongChallengeState: ([x]) => `The challenge of ${x} is not in a state that allows this (see the challenge list).`,
  WrongDeposit: ([x, y]) => `The ETH deposit must be ${eth(x)} (sent ${eth(y)}).`,
  ArbitrationCostTooHigh: ([x, y]) =>
    `The Kleros fee went up since the challenge was opened (now ${eth(x)}, the two deposits cover ${eth(y)}), so a dispute cannot be created. Nothing was sent.`,
  NotRuled: ([x]) => `Kleros has not ruled yet on the challenge of ${x}.`,
  ChallengesPending: ([x]) =>
    `${x} challenge(s) are still waiting for a match (each has 1 day). Payouts can be released after that.`,
  InDispute: ([x]) =>
    `${x} is already in a Kleros case, so the jurors decide. If they did attend, say so in the case (Send evidence): the jury rules attended when the organiser confirms it.`,
  OnlyNumberedRulings: () => "Kleros returned a ruling this contract does not know. Nothing was changed.",
  NotEnoughGas: () =>
    "The transaction ran short of gas while paying someone. Nothing changed. Try again, with a higher gas limit in your wallet if it happens again.",
  Reentrancy: () => "The contract refused a nested call.",
  NotSettled: () => "Leftovers can only be collected after the payout or a cancellation.",
  ZeroAddress: () => "One of the addresses is empty, zero, or the contract itself.",
  ZeroDeposit: () => "The deposit amount is zero.",
  BadTimes: () => "The settlement deadline must be at least 7 days after the event start.",
  BadMetaEvidenceTemplate: () =>
    "The case description template does not fit the contract: it must name the challenged wallet, use only known placeholders and stay under about 24 KB.",
  TooLate: () =>
    "Too late: either the 1-day window is over, or the settlement deadline passed (then each guest can withdraw their own deposit).",
  TooEarly: () =>
    "Too early: check the times in the status (list opens at the event start; payouts and settling wait for the windows to end).",
  AlreadyRegistered: ([x]) => `${x} is already registered. ${REDO_DEPOSITS}`,
  NotAStaker: ([x]) => `${x} is not a registered staker. ${REDO_DEPOSITS}`,
  CannotReject: ([x]) => `${x} cannot be refunded: they were already refunded or paid out.`,
  DuplicateAttendee: ([x]) => `${x} appears twice in the attendee list. ${REDO_PLAN}`,
  NoAttendees: () => "The attendee list is empty.",
  ShareMismatch: ([x, y]) =>
    `The payout per person changed (you confirmed ${eth(x)}, it is now ${eth(y)}). ${REDO_PLAN}`,
  InsufficientBalance: ([x, y]) =>
    `Not enough spare ETH in the contract for this (needs ${eth(x)} in total, has ${eth(y)}). A deposit may be missing; load the deposits again and check them.`,
  NothingToClaim: () => "There is nothing to claim for this wallet.",
  NotAppealable: ([x]) => `The challenge of ${x} is not in a Kleros case that can be appealed.`,
  TransferFailed: ([x]) =>
    `The transfer to ${x} did not go through: an address that refuses ETH (some smart-contract wallets do), or, when returning tokens, a token contract that refused (check the token address and the amount the contract holds). Nothing was sent.`,
};

type Decoded = { errorName: string; args: readonly unknown[] };

const isRevertData = (d: unknown): d is Hex => typeof d === "string" && /^0x[0-9a-fA-F]{8}/.test(d);

// Every object in an error's cause chain, and the nested `error` / `info.error` objects wallets and RPCs use.
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

/**
 * Plain-language text for an error from a read, a dry run or a send: a TruthPaysKickback custom error
 * (decoded with `abi`), a Kleros reason string, a wallet rejection, a rate limit, insufficient funds
 * or a timeout; otherwise the error's own message.
 */
export function errorText(error: unknown, abi: Abi = kickbackAbi): string {
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
    return "You cancelled in the wallet. Nothing was sent.";

  const decoded = decodeRevert(error, abi);
  if (decoded && decoded.errorName !== "Error" && decoded.errorName !== "Panic") {
    const text = KICKBACK_ERROR_TEXT[decoded.errorName];
    return text ? text(decoded.args) : `The contract refused: ${decoded.errorName}`;
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
    return "No answer from the network in time. Check the last sent transaction's link before trying again.";
  if (error instanceof BaseError) return error.shortMessage;
  return raw || String(error);
}
