import { expect } from "chai";

import {
  D,
  DAY,
  E,
  FEE,
  KGAS,
  MODE,
  TX_GAS_CAP,
  addr,
  bal,
  deploy,
  helpers,
  kickIface,
  logsOf,
  rejects,
  send,
  setup,
  warp,
  type C,
  type Ctx,
  type Signer,
} from "./fixtures/kickback";

// Ported from kickback-legacy test/contract.test.mjs: 150 guests, and the worst 150-wallet batches inside one
// mainnet transaction's gas cap (EIP-7825) with the console's 30% margin over the estimate.
describe("TruthPaysKickback: 150 guests and the 2^24 gas cap", function () {
  let ctx: Ctx;
  let h: ReturnType<typeof helpers>;
  before(async function () {
    ctx = await setup();
    h = helpers(ctx);
  });

  // a batch that goes through with this limit is estimated at most this much, and x1.3 stays under the cap
  // (a limit cut too fine would revert with NotEnoughGas rather than give a wallet less than PAYOUT_GAS)
  const LIMIT = (TX_GAS_CAP * 10n) / 13n;
  const BIG = { gasLimit: 12_000_000 };

  it("150 guests: register in batches, post 120 attendees and release, all fit easily in a block", async function () {
    const kick = await h.freshKick({ startIn: 1 });
    const gs = ctx.guests.slice(0, 150);
    await h.stake(kick, gs);
    const all = await Promise.all(gs.map(addr));
    let regGas = 0n;
    for (let i = 0; i < 150; i += 50) regGas += (await send(kick.registerStakers(all.slice(i, i + 50)))).gasUsed;
    await warp(2);
    const att = all.slice(0, 120);
    const share = (D * 150n) / 120n;
    expect(share).to.equal(E("0.0125"));
    const p = await send(kick.postAttendance(att, share));
    await warp(DAY + 1);
    const r = await send(kick.releasePayouts());
    console.log(`      gas: register 150 = ${regGas}, post 120 = ${p.gasUsed}, release 120 = ${r.gasUsed}`);
    expect(p.gasUsed < 10_000_000n && r.gasUsed < 10_000_000n).to.equal(true);
    expect(await bal(kick)).to.equal(0n);
  });

  it("worst case: 150 attendees whose wallets burn all their gas still fit in one mainnet transaction (2^24 gas), with the console's 30% margin", async function () {
    const { owner, guests, liquid } = ctx;
    const factory = await deploy("GasBurners", owner);
    const burners = async (n: number): Promise<string[]> => {
      const ws = await factory.make.staticCall(n);
      await send(factory.make(n, BIG));
      return [...ws];
    };
    const gas: string[] = [];
    const fits = async (what: string, p: Promise<{ wait(): Promise<unknown> }>) => {
      let r;
      try {
        r = await send(p as Parameters<typeof send>[0]);
      } catch (e) {
        return expect.fail(
          `${what} does not go through with ${LIMIT} gas (x1.3 = the 2^24 cap): ${(e as Error).message}`,
        );
      }
      gas.push(`${what} ${r.gasUsed}`);
      return r;
    };
    // the contract counts money in total: one transfer covers every burner's deposit
    async function registered(ws: string[], extra: Signer[] = []) {
      const kick = await h.freshKick({ startIn: 1 });
      await send(owner.sendTransaction({ to: kick.target as string, value: D * BigInt(ws.length + extra.length) }));
      const all = [...ws, ...(await Promise.all(extra.map(addr)))];
      for (let i = 0; i < all.length; i += 50) await send(kick.registerStakers(all.slice(i, i + 50), BIG));
      return kick;
    }
    const caller = guests[157]!;

    // releasePayouts: every share fails after burning the full PAYOUT_GAS and waits in owed
    const ws = await burners(150);
    const kick = await registered(ws);
    await warp(2);
    await send(kick.postAttendance(ws, D, BIG));
    await warp(DAY + 1);
    const r = await fits("release", kick.connect(caller).releasePayouts({ gasLimit: LIMIT }));
    expect(logsOf(r, kick, "PayoutFailed").length).to.equal(150);
    expect(await kick.owedTotal()).to.equal(150n * D);

    // a case lost after payout pays every attendee a part of the set-aside share: that second batch fits too
    const g = guests[158]!;
    const ws2 = await burners(150);
    const k2 = await registered(ws2, [g]);
    await warp(2);
    await send(k2.postAttendance(ws2, (D * 151n) / 150n, BIG));
    await send(k2.connect(g).challenge({ value: FEE }));
    await send(k2.matchChallenge(g.address, { value: FEE }));
    await warp(DAY + 1);
    await fits("release with a case open", k2.connect(caller).releasePayouts({ gasLimit: LIMIT }));
    expect((await k2.challenges(g.address)).heldShare).to.equal(D);
    await send(liquid.giveFinalRuling((await k2.challenges(g.address)).arbitratorDisputeID, 2, KGAS));
    const rl = await fits("lost case", k2.connect(caller).resolveChallenge(g.address, { gasLimit: LIMIT }));
    expect(logsOf(rl, k2, "PayoutFailed").length).to.equal(150);
    expect(await k2.heldBack()).to.equal(0n);

    // cancel refunds every staker in one batch
    const k3 = await registered(await burners(150));
    await fits("cancel", k3.cancel({ gasLimit: LIMIT }));
    expect(await k3.owedTotal()).to.equal(150n * D);
    console.log(`      gas with 150 gas-burning wallets (limit ${LIMIT}, cap ${TX_GAS_CAP}): ${gas.join(", ")}`);
  });

  it("unmatched challenges from gas-burning wallets: settled one by one first (console, owner.mjs), the payout then fits in one mainnet transaction", async function () {
    const { owner, guests } = ctx;
    const N = 75;
    const caller = guests[157]!;
    // 75 attendees and 75 stakers left off the list, all wallets that burn their whole PAYOUT_GAS
    const factory = await deploy("GasBurners", owner);
    const ws: string[] = [...(await factory.make.staticCall(N))];
    await send(factory.make(N, BIG));
    const cs: C[] = [];
    for (let i = 0; i < N; ++i) cs.push(await deploy("TestWallet", owner));
    const kick = await h.freshKick({ startIn: 1 });
    await send(owner.sendTransaction({ to: kick.target as string, value: D * BigInt(2 * N) }));
    const all = [...ws, ...cs.map((w) => w.target as string)];
    for (let i = 0; i < all.length; i += 50) await send(kick.registerStakers(all.slice(i, i + 50), BIG));
    await warp(2);
    await send(kick.postAttendance(ws, 2n * D, BIG));
    // every one left off challenges, nobody matches
    for (const w of cs) {
      await send(w.exec(kick.target, kickIface.encodeFunctionData("challenge"), { value: FEE }));
      await send(w.setMode(MODE.BurnGas));
    }
    await warp(DAY + 10);
    // accepting them all inside releasePayouts (each burns its gas twice: the deposit back, then the share) would not fit
    await rejects(kick.connect(caller).releasePayouts.staticCall({ gasLimit: LIMIT }));
    let worst = 0n;
    for (const w of cs) {
      const r = await send(kick.connect(caller).resolveChallenge(w.target, { gasLimit: 1_000_000 }));
      if (r.gasUsed > worst) worst = r.gasUsed;
    }
    expect(await kick.pendingChallenges()).to.equal(0n);
    const r = await send(kick.connect(caller).releasePayouts({ gasLimit: LIMIT }));
    expect(logsOf(r, kick, "PayoutFailed").length).to.equal(2 * N);
    expect(await kick.payoutShare()).to.equal(D);
    expect(await kick.owedTotal()).to.equal(BigInt(2 * N) * D + BigInt(N) * FEE);
    console.log(
      `      gas: settle one unmatched challenge <= ${worst}, then release ${2 * N} = ${r.gasUsed} (limit ${LIMIT})`,
    );
  });
});
