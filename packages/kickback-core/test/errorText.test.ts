import { kickbackAbi } from "@kickback/contracts";
import {
  encodeErrorResult,
  HttpRequestError,
  parseEther,
  TimeoutError,
  UserRejectedRequestError,
  zeroAddress,
  type AbiParameter,
} from "viem";
import { describe, expect, test } from "vitest";

import * as core from "../src";

import { chainKit } from "./chain";
import { read } from "./docs";

const argument = (p: AbiParameter, index: number): unknown =>
  p.type === "address"
    ? "0x0000000000000000000000000000000000000123"
    : p.name === "count"
      ? 3n
      : p.type.startsWith("uint")
        ? [parseEther("0.01"), parseEther("0.02")][index]
        : "0x";

const CONSOLE_TEXT: Record<string, string> = {
  NotOwner: "Only the owner wallet can do this. Switch to the owner account in your wallet.",
  NotPendingOwner: "This wallet was not proposed as the new owner.",
  NotOpen:
    "The attendance list is already posted, or the event is paid out or cancelled, so this is no longer possible.",
  NotListed: "This is only possible after the attendance list is posted and before the payout.",
  AlreadyAttending: "0x0000000000000000000000000000000000000123 is already on the attendance list.",
  AlreadyChallenged: "0x0000000000000000000000000000000000000123 has already challenged.",
  NoChallenge: "0x0000000000000000000000000000000000000123 has not challenged.",
  WrongChallengeState:
    "The challenge of 0x0000000000000000000000000000000000000123 is not in a state that allows this (see the challenge list).",
  WrongDeposit: "The ETH deposit must be 0.01 ETH (sent 0.02 ETH).",
  ArbitrationCostTooHigh:
    "The Kleros fee went up since the challenge was opened (now 0.01 ETH, the two deposits cover 0.02 ETH), so a dispute cannot be created. Nothing was sent.",
  NotRuled: "Kleros has not ruled yet on the challenge of 0x0000000000000000000000000000000000000123.",
  ChallengesPending:
    "3 challenge(s) are still waiting for a match (each has 1 day). Payouts can be released after that.",
  InDispute:
    "0x0000000000000000000000000000000000000123 is already in a Kleros case, so the jurors decide. If they did attend, say so in the case (Send evidence): the jury rules attended when the organiser confirms it.",
  OnlyNumberedRulings: "Kleros returned a ruling this contract does not know. Nothing was changed.",
  NotEnoughGas:
    "The transaction ran short of gas while paying someone. Nothing changed. Try again, with a higher gas limit in your wallet if it happens again.",
  Reentrancy: "The contract refused a nested call.",
  NotSettled: "Leftovers can only be collected after the payout or a cancellation.",
  ZeroAddress: "One of the addresses is empty, zero, or the contract itself.",
  ZeroDeposit: "The deposit amount is zero.",
  BadTimes: "The settlement deadline must be at least 7 days after the event start.",
  TooLate:
    "Too late: either the 1-day window is over, or the settlement deadline passed (then each guest can withdraw their own deposit).",
  TooEarly:
    "Too early: check the times in the status (list opens at the event start; payouts and settling wait for the windows to end).",
  AlreadyRegistered:
    '0x0000000000000000000000000000000000000123 is already registered. Press "Load deposits" again (and "Check the Luma list" again if you used it), then check the ticked guests before you try again.',
  NotAStaker:
    '0x0000000000000000000000000000000000000123 is not a registered staker. Press "Load deposits" again (and "Check the Luma list" again if you used it), then check the ticked guests before you try again.',
  CannotReject:
    "0x0000000000000000000000000000000000000123 cannot be refunded: they were already refunded or paid out.",
  DuplicateAttendee:
    "0x0000000000000000000000000000000000000123 appears twice in the attendee list. Build the attendance list again.",
  NoAttendees: "The attendee list is empty.",
  ShareMismatch:
    "The payout per person changed (you confirmed 0.01 ETH, it is now 0.02 ETH). Build the attendance list again.",
  InsufficientBalance:
    "Not enough spare ETH in the contract for this (needs 0.01 ETH in total, has 0.02 ETH). A deposit may be missing; load the deposits again and check them.",
  NothingToClaim: "There is nothing to claim for this wallet.",
  NotAppealable:
    "The challenge of 0x0000000000000000000000000000000000000123 is not in a Kleros case that can be appealed.",
  TransferFailed:
    "The transfer to 0x0000000000000000000000000000000000000123 did not go through: an address that refuses ETH (some smart-contract wallets do), or, when returning tokens, a token contract that refused (check the token address and the amount the contract holds). Nothing was sent.",
};

const ERRORS = kickbackAbi.filter(
  (x): x is Extract<(typeof kickbackAbi)[number], { type: "error" }> => x.type === "error",
);
const SOLIDITY_ERROR = { type: "error", name: "Error", inputs: [{ type: "string", name: "message" }] } as const;
const reason = (text: string) => encodeErrorResult({ abi: [SOLIDITY_ERROR], errorName: "Error", args: [text] });

describe("errorText", () => {
  test("every custom error in the ABI has its own plain words, however the revert data reaches it", () => {
    expect(ERRORS.length).toBeGreaterThan(30);
    expect(Object.keys(core.KICKBACK_ERROR_TEXT).sort()).toEqual(ERRORS.map((e) => e.name).sort());
    for (const e of ERRORS) {
      const args = e.inputs.map(argument);
      const data = encodeErrorResult({ abi: kickbackAbi, errorName: e.name, args } as never);
      const text =
        e.name === "BadMetaEvidenceTemplate"
          ? "The case description template does not fit the contract: it must name the challenged wallet, use only known placeholders and stay under about 24 KB."
          : CONSOLE_TEXT[e.name];
      expect(text, e.name).toBeDefined();
      expect(text, e.name).not.toMatch(/The contract refused: |undefined|NaN/);
      for (const err of [
        data,
        { data },
        { cause: { data } },
        { error: { data } },
        { info: { error: { data } } },
        { shortMessage: "x", cause: { raw: data } },
      ])
        expect(core.errorText(err), e.name).toBe(text);
    }
    expect(
      core.errorText(
        encodeErrorResult({ abi: kickbackAbi, errorName: "WrongDeposit", args: [parseEther("0.01"), 1n] }),
      ),
    ).toBe("The ETH deposit must be 0.01 ETH (sent 0.000000000000000001 ETH).");
  });

  test.each([
    "it's too early for this",
    "it's too late for this",
    "a challenge is still waiting for a match",
    "the attendance list isn't open for this (not published yet, or payouts were already released)",
    "there's nothing to claim",
    "the ETH amount needed has changed. Check again",
    "this wallet has already challenged",
    "this wallet is already on the attendance list",
    "this wallet has no confirmed spot",
    "the challenge has moved on. Check again",
    "Kleros hasn't delivered the final ruling yet",
    "deposits are closed",
    "the amount can't be zero",
    "the gas limit was set too low. Try again and keep the gas your wallet suggests",
    "the Kleros fee went up beyond both deposits",
    "that address can't receive it",
    "that address refused the ETH. Use another address",
    "the appeal period for this answer is over",
    "this answer is already fully funded",
    "the case already has its final ruling, so it takes no more evidence",
    "the case has no final ruling yet",
  ])("preserves site RPC error wording: %s", (text) => {
    expect(core.errorText(new Error(text))).toBe(text);
  });

  test("Kleros reason strings, wallet rejection, rate limits, insufficient funds, timeouts", () => {
    expect(core.errorText(reason("Appeal fee has already been paid."))).toBe(
      "This answer is already fully funded. Nothing more is needed for it.",
    );
    expect(core.errorText({ data: reason("Funding must be made within the appeal period.") })).toMatch(
      /^The appeal window for this answer is closed/,
    );
    expect(core.errorText({ shortMessage: 'execution reverted: "The dispute should be solved"' })).toMatch(
      /once the case has its final ruling/,
    );
    expect(core.errorText(reason("some other reason"))).toBe("some other reason");
    for (const e of [
      { code: 4001 },
      new UserRejectedRequestError(new Error("no")),
      { shortMessage: "User rejected the request." },
    ])
      expect(core.errorText(e)).toBe("You cancelled in the wallet. Nothing was sent.");
    for (const e of [
      new HttpRequestError({ url: "https://rpc", status: 429 }),
      { code: -32005 },
      { shortMessage: "Too Many Requests" },
    ])
      expect(core.errorText(e)).toMatch(/rate limited/);
    // calldata in a long message can hold "429": only short texts are read for it
    expect(core.errorText({ message: "call failed: data 0x00429000" })).toBe("call failed: data 0x00429000");
    expect(core.errorText({ shortMessage: "insufficient funds for gas * price + value" })).toMatch(
      /does not have enough ETH/,
    );
    expect(core.errorText(new TimeoutError({ body: {}, url: "https://rpc" }))).toMatch(
      /No answer from the network in time/,
    );
    expect(core.errorText(new Error("boom"))).toBe("boom");
  });

  test("a revert from the chain reaches the user as the contract's own words", { timeout: 60_000 }, async () => {
    const k = chainKit();
    const { liquid, proxy } = await k.mocks();
    const t = await k.now();
    const cfg = core.normalizeConfig({
      chain: "local",
      chainId: 31337,
      deposit: "0.01",
      receiver: zeroAddress,
      eventStart: new Date((t + 3600) * 1000).toISOString(),
      claimDeadline: new Date((t + 3600 + 14 * 86400) * 1000).toISOString(),
      owner: k.addr(0),
      kleros: { disputeResolver: proxy, arbitrator: liquid, policyURI: "/ipfs/QmPolicyForTests" },
    });
    const kick = await k.deployKickback(
      core.deployArgs(
        cfg,
        k.addr(0),
        read(core.GENERIC_METAEVIDENCE_TEMPLATE).replace(
          /\{\{(eventTitle|eventWhen|eventWhere|hosts|eventLink)\}\}/g,
          "x",
        ),
      ),
    );
    const fail = (account: number, functionName: string, args: unknown[] = []) =>
      k.client
        .simulateContract({ address: kick, abi: kickbackAbi, functionName, args, account: k.addr(account) } as never)
        .then(
          () => expect.fail(`${functionName} did not revert`),
          (e: unknown) => core.errorText(e),
        );
    expect(await fail(1, "claim", [k.addr(1)])).toBe("There is nothing to claim for this wallet.");
    expect(await fail(1, "registerStakers", [[k.addr(2)]])).toBe(
      "Only the owner wallet can do this. Switch to the owner account in your wallet.",
    );
    expect(await fail(0, "postAttendance", [[k.addr(2)], 1n])).toMatch(/^Too early/);
  });
});
