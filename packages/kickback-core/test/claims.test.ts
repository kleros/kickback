// pairReturns' staking and refund-ordering rules and resolveClaims' ownership tiers, on hand-made deposits and rows.
import { describe, expect, test } from "vitest";

import * as core from "../src";

import { hashOf } from "./stubs";

const W = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const V = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";
const D = 25n;

describe("pairReturns", () => {
  const dep = (n: number, amount: bigint, block: number, logIndex = 0): core.DepositIn => ({
    tx: hashOf(n),
    from: W,
    amount,
    block,
    logIndex,
  });
  const ev = (type: core.ReturnEvent["type"], amount: bigint, block: number, logIndex = 0): core.ReturnEvent => ({
    type,
    wallet: W,
    amount,
    block,
    logIndex,
    tx: hashOf(100 + block),
  });

  test("a wallet registered before the scanned range is staked on a whole deposit it made since", () => {
    const { byDeposit, unbacked } = core.pairReturns([dep(1, D, 10)], [], {
      deposit: D,
      stakers: new Set([W.toLowerCase()]),
    });
    expect([...byDeposit.values()].map((d) => d.staked)).toEqual([true]);
    expect(unbacked).toEqual([]);
  });

  test("a deposit short of the full amount never backs a registration", () => {
    const reg = ev("StakerRegistered", 0n, 11);
    const { byDeposit, unbacked } = core.pairReturns([dep(1, D - 1n, 10)], [reg], { deposit: D });
    expect([...byDeposit.values()].map((d) => d.staked)).toEqual([false]);
    expect(unbacked).toEqual([reg]);
    const later = core.pairReturns([dep(1, D - 1n, 10)], [], { deposit: D, stakers: new Set([W.toLowerCase()]) });
    expect([...later.byDeposit.values()].map((d) => d.staked)).toEqual([false]);
  });

  test("a Refunded of the same size goes to a deposit nobody pasted before a verified one", () => {
    const { byDeposit } = core.pairReturns([dep(1, D, 10), dep(2, D, 11)], [ev("Refunded", D, 12)], {
      deposit: D,
      prefer: new Set([hashOf(1)]),
    });
    expect([...byDeposit.values()].map((d) => [d.tx, d.remaining])).toEqual([
      [hashOf(1), D],
      [hashOf(2), 0n],
    ]);
  });

  test("within one block, a return covers only deposits logged before it", () => {
    const early = ev("Refunded", D, 10, 0);
    const { byDeposit, unpaired } = core.pairReturns([dep(1, D, 10, 3)], [early], { deposit: D });
    expect([...byDeposit.values()].map((d) => d.remaining)).toEqual([D]);
    expect(unpaired).toEqual([{ ...early, left: D }]);
    const late = core.pairReturns([dep(1, D, 10, 3)], [ev("Refunded", D, 10, 5)], { deposit: D });
    expect([...late.byDeposit.values()].map((d) => d.remaining)).toEqual([0n]);
  });
});

describe("resolveClaims", () => {
  const row = (over: Partial<core.GuestCheck>): core.GuestCheck => ({
    name: "",
    email: "",
    ticket: "Committed Spot",
    approval: "approved",
    decision: "approved",
    wallet: W,
    tx: hashOf(1),
    ok: true,
    code: "VERIFIED",
    note: "",
    inferred: false,
    ...over,
  });
  const codes = (r: { kept: core.GuestCheck[]; issues: core.GuestCheck[] }) => ({
    kept: r.kept.map((x) => x.email),
    issues: r.issues.map((x) => [x.email, x.code]),
  });

  test("against a wrong-sender row, a blank-address row whose wallet is registered keeps the tx; others do not", () => {
    const rows = [
      row({ email: "liar@x.io", wallet: V, ok: false, code: "WRONG_SENDER" }),
      row({ email: "owner@x.io", inferred: true }),
    ];
    expect(codes(core.resolveClaims(rows, { isStaker: (w) => w === W }))).toEqual({
      kept: ["owner@x.io"],
      issues: [["liar@x.io", "DUPLICATE_TX"]],
    });
    expect(codes(core.resolveClaims(rows))).toEqual({
      kept: [],
      issues: [
        ["owner@x.io", "DUPLICATE_CLAIM"],
        ["liar@x.io", "WRONG_SENDER"],
      ],
    });
  });

  test("of one wallet's registrations, the only one not declined is kept", () => {
    const rows = [
      row({ email: "old@x.io", tx: hashOf(1), approval: "declined", decision: "declined" }),
      row({ email: "new@x.io", tx: hashOf(2) }),
    ];
    expect(codes(core.resolveClaims(rows))).toEqual({ kept: ["new@x.io"], issues: [["old@x.io", "DUPLICATE_WALLET"]] });
  });

  test("of one wallet's held deposits, the one that verifies is kept over a late one", () => {
    const rows = [
      row({ email: "late@x.io", tx: hashOf(1), ok: false, code: "OUTSIDE_WINDOW" }),
      row({ email: "good@x.io", tx: hashOf(2) }),
    ];
    expect(codes(core.resolveClaims(rows))).toEqual({
      kept: ["good@x.io"],
      issues: [["late@x.io", "DUPLICATE_WALLET"]],
    });
  });
});
