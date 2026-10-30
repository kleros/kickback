// verifyTx, verifyRegistrations and buildPayout over stub clients: the deposit window and amount at their edges, the
// link picked from several, free guests with a tx, and buildPayout's cross-checks against the contract.
import { parseEther, type Address, type Hash } from "viem";
import { describe, expect, test } from "vitest";

import * as core from "../src";

import { hashOf, readClient, verifyClient, type StubTx } from "./stubs";

const RECEIVER: Address = "0x259a1084C2043a7B3b5b288596E05C41b8EFa5d6";
const ANA: Address = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const BEN: Address = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";
const CAI: Address = "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB";
const D = parseEther("0.01");
const CFG = {
  receiver: RECEIVER,
  opensAt: 1000,
  deadline: 2000,
  depositUnits: D,
  deposit: "0.01",
  decimals: 18 as const,
  columns: {},
  explorer: "https://etherscan.io",
};

describe("verifyTx", () => {
  const check = (tx: StubTx) => core.verifyTx(verifyClient(RECEIVER, { [hashOf(1)]: tx }), CFG, hashOf(1), tx.from);
  test("the deposit window includes both ends, and nothing outside them", async () => {
    const at = async (ts: number) => (await check({ from: ANA, amount: D, ts })).code;
    expect(await Promise.all([999, 1000, 2000, 2001].map(at))).toEqual([
      "OUTSIDE_WINDOW",
      "VERIFIED",
      "VERIFIED",
      "OUTSIDE_WINDOW",
    ]);
    expect((await check({ from: ANA, amount: D, ts: 999 })).note).toBe("Sent at 1970-01-01T00:16:39.000Z");
  });
  test("one wei short of the deposit is too low; the deposit itself verifies", async () => {
    const short = await check({ from: ANA, amount: D - 1n, ts: 1500 });
    expect([short.code, short.amount]).toEqual(["AMOUNT_TOO_LOW", D - 1n]);
    expect(short.note).toMatch(/^Sent 0\.009999999999999999 ETH, need 0\.01 ETH\./);
    expect((await check({ from: ANA, amount: D, ts: 1500 })).code).toBe("VERIFIED");
  });
});

describe("verifyRegistrations", () => {
  const H = "name,email,ticket_name,approval_status,eth_address,Deposit tx link";
  const verify = (txs: Record<Hash, StubTx>, lines: string[]) =>
    core.verifyRegistrations(verifyClient(RECEIVER, txs), CFG, core.parseCsv([H, ...lines].join("\n")));
  const T = "Committed Spot";

  test("of several links, the one that verifies beats a late or short payment listed before it", async () => {
    const txs = {
      [hashOf(1)]: { from: ANA, amount: D, ts: 2500 }, // late
      [hashOf(2)]: { from: ANA, amount: D / 2n, ts: 1500 }, // short
      [hashOf(3)]: { from: ANA, amount: D, ts: 1500 },
    };
    const { results } = await verify(txs, [
      `Ana,ana@x.io,${T},approved,${ANA},"${hashOf(1)} then ${hashOf(3)}"`,
      `Ana2,ana2@x.io,${T},approved,${ANA},"${hashOf(2)} then ${hashOf(3)}"`,
      `Ana3,ana3@x.io,${T},approved,${ANA},"${hashOf(1)} then ${hashOf(2)}"`,
    ]);
    expect(results.map((r) => [r.code, r.tx])).toEqual([
      ["VERIFIED", hashOf(3)],
      ["VERIFIED", hashOf(3)],
      ["OUTSIDE_WINDOW", hashOf(1)],
    ]);
    expect(results[0]!.note).toBe(`2 tx links pasted; checked ${hashOf(3)}`);
  });

  test("of links that can't be read yet, a pending tx is named rather than one that was never found", async () => {
    const txs = { [hashOf(2)]: { from: ANA, amount: D, ts: 1500, pending: true } };
    const { results } = await verify(txs, [`Ana,ana@x.io,${T},approved,${ANA},"${hashOf(1)} ${hashOf(2)}"`]);
    expect(results.map((r) => [r.code, r.tx, r.unread])).toEqual([["TX_PENDING", hashOf(2), [hashOf(1), hashOf(2)]]]);
    expect(core.UNREAD_CODES).toEqual(new Set(["RPC_ERROR", "TX_PENDING", "TX_NOT_FOUND"]));
  });

  test("a free 'Request to Join' guest is checked when they pasted a tx hash, and skipped otherwise", async () => {
    const txs = { [hashOf(1)]: { from: BEN, amount: D, ts: 1500 } };
    const FREE = "Request to Join (Free)";
    const { results } = await verify(txs, [
      `Ben,ben@x.io,${FREE},approved,${BEN},https://etherscan.io/tx/${hashOf(1)}`,
      `Cai,cai@x.io,${FREE},approved,${CAI},`,
      `Dan,dan@x.io,${FREE},approved,,not paid`,
    ]);
    expect(results.map((r) => [r.name, r.code, r.ticket])).toEqual([["Ben", "VERIFIED", FREE]]);
  });
});

describe("buildPayout cross-checks the contract", () => {
  const cfg = { contract: RECEIVER, columns: {}, depositUnits: 7n, deposit: "0.000000000000000007", chainId: 1, explorer: "" }; // prettier-ignore
  const verified = [ANA, BEN, CAI].map((wallet, i) => ({
    wallet,
    email: `${i}@x.io`,
    name: `G${i}`,
    approval: "approved",
  }));
  const checkins = core.parseCsv("email,checked_in_at\n0@x.io,2027-03-12T19:30:00Z\n1@x.io,2027-03-12T19:40:00Z\n");
  const payout = (client: ReturnType<typeof readClient>, over: Partial<typeof cfg> = {}, warn = (_: string) => {}) =>
    core.buildPayout({ client, cfg: { ...cfg, ...over }, checkins, verified, log: { info() {}, warn } });

  test("the share and the rounding dust: 3 stakers of 7 wei, 2 attendees", async () => {
    const p = await payout(readClient({ stakers: [ANA, BEN, CAI], depositAmount: 7n }));
    expect([p.pool, p.share, p.dust, p.plan.share]).toEqual([21n, 10n, 1n, "10"]);
    expect(p.summaryMarkdown).toContain("| Rounding dust | 0.000000000000000001 ETH |");
  });

  test("a contract that computes another share stops it", async () => {
    const client = readClient({ stakers: [ANA, BEN, CAI], depositAmount: 7n, previewShare: () => 11n });
    await expect(payout(client)).rejects.toThrow(
      /The contract computes a different share for this list; stop and investigate/,
    );
  });

  test("a staker list that disagrees with stakerCount stops it", async () => {
    const client = readClient({ stakers: [ANA, BEN, CAI], stakerCount: 4n, depositAmount: 7n });
    await expect(payout(client)).rejects.toThrow(
      "On-chain staker list (3) and stakerCount (4) disagree; stop and investigate",
    );
  });

  test("the pool is the contract's deposit, whatever the config says (with a warning)", async () => {
    const warnings: string[] = [];
    const p = await payout(readClient({ stakers: [ANA, BEN, CAI], depositAmount: 9n }), {}, (m) => warnings.push(m));
    expect([p.deposit, p.pool, p.share, p.dust]).toEqual([9n, 27n, 13n, 1n]);
    expect(warnings).toEqual([
      `⚠️  The contract's deposit is 0.000000000000000009 ETH but the config says 0.000000000000000007 ETH: using the contract's amount. Fix "deposit" in the config.`,
    ]);
    expect(p.summaryMarkdown).toContain("| Pool | 0.000000000000000027 ETH |");
  });
});
