// readEvent and readGuest against the Hardhat node globalSetup starts, then the attendance CSV and error helpers.
import { presenceEventAbi } from "@kickback/contracts";
import { createEvent, deployLocalEvent, localEventConfig } from "@kickback/contracts/local";
import { BaseError, ContractFunctionRevertedError, encodeErrorResult, getAddress, parseEther } from "viem";
import { beforeAll, describe, expect, test } from "vitest";

import * as core from "../src";
import { chainKit } from "./kit";

describe("reading an event", () => {
  const k = chainKit();
  let ev: Awaited<ReturnType<typeof deployLocalEvent>>;

  beforeAll(async () => {
    ev = await deployLocalEvent({ walletClient: k.wallet(0), publicClient: k.client, name: "Night one", capacity: 50 });
  });

  test("readEvent returns the settings and the summary, and checks the factory", async () => {
    const info = await core.readEvent(k.client, ev.event, { factory: ev.factory });
    expect(info).toMatchObject({
      contract: ev.event,
      factory: ev.factory,
      owner: k.addr(0),
      name: "Night one",
      url: ev.config.url,
      symbol: "ETH",
      decimals: 18,
      depositAmount: parseEther("0.01"),
      eventStart: Number(ev.config.eventStart),
      eventEnd: Number(ev.config.eventEnd),
      capacity: 50,
      phase: core.PHASE.Open,
      stakerCount: 0,
      challengeDeposit: parseEther("0.015"),
      challengePeriod: 86400,
      policyURI: ev.protocol!.policyURI,
    });
    expect(core.amountText(info.depositAmount, info)).toBe("0.01 ETH");
  });

  test("readEvent refuses an address that is not an event of this factory", async () => {
    const err = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: core.KickbackError) => e.code,
      );
    expect(await err(core.readEvent(k.client, "0x123", { factory: ev.factory }))).toBe("NOT_KICKBACK");
    expect(await err(core.readEvent(k.client, k.addr(5), { factory: ev.factory }))).toBe("NO_KICKBACK_CONTRACT");
    expect(await err(core.readEvent(k.client, ev.factory, { factory: ev.factory }))).toBe("NOT_KICKBACK");
    // an event of another (look-alike) factory
    const other = await deployLocalEvent({ walletClient: k.wallet(1), publicClient: k.client });
    expect(await err(core.readEvent(k.client, other.event, { factory: ev.factory }))).toBe("UNKNOWN_CODE");
    expect((await core.readEvent(k.client, other.event, null)).factory).toBe(other.factory);
  });

  test("readGuest follows a deposit; eventsOf and latestEvents list the factory's events", async () => {
    const before = await core.readGuest(k.client, ev.event, k.addr(2));
    expect(before).toMatchObject({ status: core.STATUS.None, attended: false, claimable: 0n });
    await k.mined(
      await k.wallet(2).writeContract({
        address: ev.event,
        abi: presenceEventAbi,
        functionName: "deposit",
        value: parseEther("0.01"),
      }),
    );
    expect((await core.readGuest(k.client, ev.event, k.addr(2))).status).toBe(core.STATUS.Staker);
    expect((await core.readEvent(k.client, ev.event, null)).stakerCount).toBe(1);

    const now = (await k.client.getBlock()).timestamp;
    const second = await createEvent(
      { walletClient: k.wallet(0), publicClient: k.client },
      ev.factory,
      localEventConfig(now, { name: "Night two" }),
    );
    expect(await core.eventsOf(k.client, ev.factory, k.addr(0))).toEqual([second.event, ev.event]);
    expect(await core.latestEvents(k.client, ev.factory, 1)).toEqual([second.event]);
  });
});

describe("attendance from a check-in CSV", () => {
  const a = getAddress("0x00000000000000000000000000000000000000aa");
  const b = getAddress("0x00000000000000000000000000000000000000bb");
  const c = getAddress("0x00000000000000000000000000000000000000cc");

  test("checked-in stakers are listed; the rest are no-shows; other rows say why they were skipped", () => {
    const csv = [
      "name,email,checked_in_at,What is your wallet address?",
      `Ana,ana@x.org,2026-11-04T18:02:00Z,${a}`,
      `Ben,ben@x.org,,${b}`,
      `Eve,eve@x.org,2026-11-04T18:05:00Z,0x00000000000000000000000000000000000000ee`,
      "Kai,kai@x.org,2026-11-04T18:06:00Z,",
      `Ana again,ana2@x.org,2026-11-04T18:07:00Z,${a.toLowerCase()}`,
    ].join("\n");
    const plan = core.attendanceFromCsv(csv, [a, b, c]);
    expect(plan.attending).toEqual([a]);
    expect(plan.noShows).toEqual([b, c]);
    expect(plan.skipped.map((s) => [s.name, s.reason])).toEqual([
      ["Ben", "not-checked-in"],
      ["Eve", "not-a-guest"],
      ["Kai", "no-wallet"],
      ["Ana again", "duplicate"],
    ]);
  });

  test("a plain list of wallets counts every staker in it", () => {
    expect(core.attendanceFromCsv(`wallet\n${b}\n${c}`, [a, b, c]).attending).toEqual([b, c]);
    expect(core.batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("errorText", () => {
  test("PresenceEvent errors read as plain words", () => {
    const data = encodeErrorResult({ abi: presenceEventAbi, errorName: "EventFull", args: [40n] });
    expect(core.errorText(data)).toBe("The event is full (40 spots).");
    const err = new BaseError("reverted", {
      cause: new ContractFunctionRevertedError({ abi: presenceEventAbi, functionName: "deposit", data }),
    });
    expect(core.errorText(err)).toBe("The event is full (40 spots).");
    expect(core.errorText({ code: 4001, message: "User rejected the request." })).toBe(
      "You cancelled in the wallet. Nothing was sent.",
    );
  });
});
