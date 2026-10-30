import { deployLocalEvent } from "@kickback/contracts/local";
import { parseEther, type Address } from "viem";
import { expect, test } from "vitest";

import * as core from "../src";

import { chainKit } from "./chain";

test("Luma deposit and check-in lists drive registration, refunds and attendance", async () => {
  const k = chainKit();
  const deposit = parseEther("0.01");
  const eventStart = (await k.now()) + 3600;
  const local = await deployLocalEvent({
    publicClient: k.client,
    walletClient: k.wallet(0),
    eventStart: BigInt(eventStart),
    depositAmount: deposit,
  });
  const cfg = core.normalizeConfig({
    chain: "local",
    chainId: 31337,
    rpcUrl: k.rpcUrl,
    contract: local.event,
    deposit: "0.01",
    deployBlock: Number(local.deployBlock),
    depositDeadline: new Date(eventStart * 1000).toISOString(),
    eventStart: new Date(eventStart * 1000).toISOString(),
    claimDeadline: new Date(Number(local.args[4]) * 1000).toISOString(),
    columns: {},
  });
  const pay = (account: number, value = deposit) => k.pay(account, local.event, value);
  const depositCall = async (account: number) =>
    (await k.kick(local.event, account, "deposit", [], deposit)).transactionHash;
  const tx = {
    ana: await depositCall(1),
    ben: await depositCall(2),
    cai: await pay(3),
    dev: await pay(4),
    eve: await depositCall(5),
    fay: await depositCall(6),
    fayAgain: await pay(6),
    gus: await pay(7),
    bot: await depositCall(8),
    wim: await pay(9, parseEther("0.005")),
    stray: await pay(10),
  };
  expect(await k.balance(local.event)).toBe(parseEther("0.105"));

  const ticket = "Committed Spot (0.01 ETH)";
  const csv = (checkedIn = "") =>
    [
      "name,email,ticket_name,approval_status,checked_in_at,eth_address,Deposit tx link (Committed Spot only)",
      `Ana,ana@x.io,${ticket},approved,${checkedIn},${k.addr(1)},https://etherscan.io/tx/${tx.ana}`,
      `Ben,ben@x.io,${ticket},approved,${checkedIn},${k.addr(2)},${tx.ben}`,
      `Cai,cai@x.io,${ticket},approved,${checkedIn},${k.addr(3)},${tx.cai}`,
      `Dev,dev@x.io,${ticket},approved,${checkedIn},,${tx.dev}`,
      `Eve,eve@x.io,${ticket},approved,,${k.addr(5)},${tx.eve}`,
      `Fay,fay@x.io,${ticket},approved,,${k.addr(6)},${tx.fay}`,
      `Fay again,fay+2@x.io,${ticket},declined,,${k.addr(6)},${tx.fayAgain}`,
      `Gus,gus@x.io,${ticket},approved,,${k.addr(7)},${tx.gus}`,
      `Bot,bot@x.io,${ticket},declined,,${k.addr(8)},${tx.bot}`,
      `Wim,wim@x.io,${ticket},approved,,${k.addr(9)},${tx.wim}`,
      `Cop,cop@x.io,${ticket},approved,,${k.addr(11)},${tx.ben}`,
      `Hal,hal@x.io,Request to Join (Free),approved,${checkedIn},,`,
    ].join("\n");
  const check = () =>
    core.checkGuests({
      client: k.client,
      cfg,
      rows: core.parseCsv(csv()),
      scanFrom: cfg.deployBlock,
    });
  const checked = await check();
  const wallets = (list: core.StampedList) => list.items.map((item) => item.wallet);
  const newStakers = wallets(checked.lists.newStakers);
  const refunds = wallets(checked.lists.refunds);
  expect(newStakers).toEqual([1, 2, 3, 4, 5, 6, 7].map(k.addr));
  expect(refunds).toEqual([k.addr(8)]);
  expect(checked.lists.newStakers).toMatchObject({
    contract: local.event,
    chainId: 31337,
    deposit: deposit.toString(),
    block: checked.snapshotBlock,
  });
  expect(Object.fromEntries(checked.issues.map((row) => [row.name, row.code]))).toEqual({
    Wim: "AMOUNT_TOO_LOW",
    Cop: "DUPLICATE_TX",
    "Fay again": "DUPLICATE_WALLET",
  });
  expect(checked.returns.map((row) => [row.wallet, row.to_return])).toEqual([
    [k.addr(9), "0.005"],
    [k.addr(6), "0.01"],
  ]);
  expect(checked.openUnmatched.map((row) => [row.from, row.tx, row.to_return])).toEqual([
    [k.addr(10), tx.stray, "0.01"],
  ]);

  await k.kick(local.event, 0, "registerStakers", [newStakers]);
  expect(await k.read<Address[]>(local.event, "stakers")).toEqual(newStakers);
  expect(await k.read<bigint>(local.event, "stakerCount")).toBe(7n);
  const botBalance = await k.balance(k.addr(8));
  await k.kick(local.event, 0, "rejectAndRefund", [refunds]);
  expect((await k.balance(k.addr(8))) - botBalance).toBe(deposit);
  expect(await k.read<number>(local.event, "status", [k.addr(8)])).toBe(core.STATUS.Rejected);
  for (const row of checked.returns) await k.kick(local.event, 0, "refund", [row.wallet, parseEther(row.to_return)]);
  for (const row of checked.openUnmatched)
    await k.kick(local.event, 0, "refund", [row.from, parseEther(row.to_return)]);
  expect(await k.balance(local.event)).toBe(deposit * 7n);
  expect(await k.read<bigint>(local.event, "spare")).toBe(0n);

  const rechecked = await check();
  expect(rechecked.lists.newStakers.items).toEqual([]);
  expect(rechecked.lists.refunds.items).toEqual([]);
  expect(rechecked.returns).toEqual([]);
  expect(rechecked.openUnmatched).toEqual([]);

  await k.warp(3600);
  const payout = await core.buildPayout({
    client: k.client,
    cfg,
    checkins: core.parseCsv(csv(new Date(eventStart * 1000).toISOString())),
    verified: rechecked.verified,
    claims: rechecked.claims,
  });
  expect(payout.plan).toEqual({
    contract: local.event,
    chainId: 31337,
    stakers: 7,
    attendees: [1, 2, 3, 4].map(k.addr),
    share: "17500000000000000",
    shareEth: "0.0175",
  });
  expect(payout.attendees.map((row) => row.wallet)).toEqual(payout.plan.attendees);
  expect(payout.unknown).toEqual([]);
  await k.kick(local.event, 0, "postAttendance", [payout.plan.attendees, BigInt(payout.plan.share)]);
  expect(await k.read<Address[]>(local.event, "attendees")).toEqual(payout.plan.attendees);
  expect(await k.read<bigint>(local.event, "attendeeCount")).toBe(4n);
  expect(await k.read<number>(local.event, "phase")).toBe(1);
});
