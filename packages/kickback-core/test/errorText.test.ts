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

const dummy = (p: AbiParameter): unknown =>
  p.type === "address"
    ? zeroAddress
    : p.type.startsWith("uint")
      ? 12_345_000_000_000_000n
      : p.type === "bool"
        ? false
        : "0x";
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
      const args = e.inputs.map(dummy);
      const data = encodeErrorResult({ abi: kickbackAbi, errorName: e.name, args } as never);
      const text = core.KICKBACK_ERROR_TEXT[e.name]!(args);
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
