import { expect } from "chai";
import { ZeroAddress } from "ethers";

import {
  D,
  DAY,
  E,
  FEE,
  KGAS,
  MODE,
  addr,
  bal,
  deploy,
  helpers,
  kickIface,
  logsOf,
  reverts,
  send,
  setup,
  warp,
  type Ctx,
} from "./fixtures/kickback";

// Ported from kickback-legacy test/contract.test.mjs: ETH accounting (refund / sweep only touch spare ETH),
// wallets that refuse their challenge money, tokens sent by mistake (returnToken) and reentrancy.
describe("TruthPaysKickback: accounting, tokens, reentrancy", function () {
  let ctx: Ctx;
  let h: ReturnType<typeof helpers>;
  before(async function () {
    ctx = await setup();
    h = helpers(ctx);
  });

  it("a wallet that refuses ETH keeps its challenge money and share in owed, and claims them to another address", async function () {
    const { guests } = ctx;
    const kick = await h.freshKick({ startIn: 1 });
    const gs = guests.slice(41, 43);
    await h.stake(kick, gs);
    const refuser = await h.testWallet(kick); // accepts ETH for now
    await send(kick.registerStakers([...(await Promise.all(gs.map(addr))), refuser.target]));
    await warp(2);
    await send(kick.postAttendance(await Promise.all(gs.map(addr)), (D * 3n) / 2n));
    await send(refuser.exec(kick.target, kickIface.encodeFunctionData("challenge"), { value: FEE + 3n })); // the extra 3 wei come back
    expect(await bal(refuser)).to.equal(3n);
    await send(refuser.setMode(MODE.Refuse));
    await warp(DAY + 1);
    await send(kick.releasePayouts({ gasLimit: 1_000_000 })); // unmatched: accepted, but the challenge deposit and the share bounce
    const share = D; // 3 deposits / 3 attendees
    expect(await kick.owed(refuser.target)).to.equal(FEE + share);
    expect(await kick.reserved()).to.equal(FEE + share);
    const to = guests[155]!.address;
    const e0 = await bal(to);
    await send(refuser.exec(kick.target, kickIface.encodeFunctionData("claim", [to])));
    expect(await bal(to)).to.equal(e0 + FEE + share);
    expect(await kick.owed(refuser.target)).to.equal(0n);
    expect(await bal(kick)).to.equal(0n);
  });

  it("refund and sweep only ever move spare ETH: never the pool, unclaimed payments, challenge money or set-aside shares", async function () {
    const { owner, liquid, guests } = ctx;
    const kick = await h.freshKick({ startIn: 1 });
    const gs = guests.slice(43, 49); // 6 guests
    await h.stake(kick, gs);
    const refuser = await h.testWallet(kick); // will refuse its share
    const extra = E("0.003");
    await send(gs[0]!.sendTransaction({ to: kick.target as string, value: extra })); // an overpayment
    const stray = guests[49]!;
    await h.stake(kick, [stray]); // paid, never registered
    const stakers = [...(await Promise.all(gs.map(addr))), refuser.target as string];
    await send(kick.registerStakers(stakers)); // 7 stakers
    const expectSpare = async (v: bigint) => {
      expect(await kick.spare()).to.equal(v);
      expect(await bal(kick)).to.equal((await kick.reserved()) + v);
    };
    await expectSpare(extra + D);
    await reverts(kick, "refund", [owner.address, extra + D + 1n], "InsufficientBalance");
    await warp(2);
    // 5 on the list; gs[4] and gs[5] left off
    await send(kick.postAttendance([...stakers.slice(0, 4), refuser.target], (7n * D) / 5n));
    await send(kick.connect(gs[4]!).challenge({ value: FEE })); // will go unmatched
    await send(kick.connect(gs[5]!).challenge({ value: FEE }));
    await send(kick.matchChallenge(stakers[5], { value: FEE })); // a Kleros case
    expect(await kick.challengeEscrow()).to.equal(2n * FEE); // gs[4]'s deposit + both of gs[5]'s, less the Kleros fee
    await expectSpare(extra + D);
    await reverts(kick, "refund", [owner.address, extra + D + 1n], "InsufficientBalance");
    await reverts(kick, "sweep", [owner.address], "NotSettled");
    await warp(DAY + 1);
    await send(refuser.setMode(MODE.Refuse));
    await send(kick.connect(guests[150]!).releasePayouts({ gasLimit: 2_000_000 })); // 7 deposits / (6 attendees + 1 open case) = 1 each
    expect(await kick.payoutShare()).to.equal(D);
    expect(await kick.owed(refuser.target)).to.equal(D);
    expect(await kick.heldBack()).to.equal(D);
    expect(await kick.challengeEscrow()).to.equal(FEE);
    expect(await kick.reserved()).to.equal(D + D + FEE); // set-aside share + owed share + the open case's challenge money
    await expectSpare(extra + D);
    // the organiser returns the stray deposit and the overpayment; nothing more can leave
    await send(kick.refund(stray.address, D));
    await send(kick.refund(gs[0]!.address, extra));
    await expectSpare(0n);
    await reverts(kick, "refund", [owner.address, 1n], "InsufficientBalance");
    // a late payer can't be refunded out of the challenge money either (FEE > D is sitting there)
    await reverts(kick, "rejectAndRefund", [[guests[60]!.address]], "InsufficientBalance");
    const o0 = await bal(kick);
    await send(kick.sweep(owner.address));
    expect(await bal(kick)).to.equal(o0); // nothing spare to sweep
    // the case is lost: the matcher gets the challenge money back, the held share is split over the 6 attendees
    await send(liquid.giveFinalRuling((await kick.challenges(stakers[5])).arbitratorDisputeID, 2, KGAS));
    await send(kick.connect(guests[150]!).resolveChallenge(stakers[5], { gasLimit: 2_000_000 }));
    const each = D / 6n;
    expect(await kick.owed(refuser.target)).to.equal(D + each);
    await expectSpare(D - 6n * each); // rounding dust only
    await send(kick.sweep(owner.address));
    await expectSpare(0n);
    expect(await bal(kick)).to.equal(D + each); // only the refuser's unclaimed payments are left
    await send(refuser.exec(kick.target, kickIface.encodeFunctionData("claim", [guests[150]!.address])));
    expect(await bal(kick)).to.equal(0n);
  });

  it("tokens sent by mistake (USDC) are never deposits; the owner can send them back, and returnToken never moves ETH", async function () {
    const { owner, guests } = ctx;
    const kick = await h.freshKick({ startIn: 1 });
    const [g, hh, x] = guests.slice(54, 57) as [Ctx["owner"], Ctx["owner"], Ctx["owner"]];
    await h.stake(kick, [g]);
    await send(kick.registerStakers([g.address]));
    const usdc = await deploy("TestToken", owner);
    await send(usdc.mint(hh.address, 25_000_000n));
    // a guest sends 25 USDC to the deposit address: no Deposited event, nothing counted
    const r = await send(usdc.connect(hh).transfer(kick.target, 25_000_000n));
    expect(logsOf(r, kick, "Deposited").length).to.equal(0);
    expect(await usdc.balanceOf(kick.target)).to.equal(25_000_000n);
    const eth0 = await bal(kick);
    await reverts(kick.connect(hh), "returnToken", [usdc.target, hh.address, 25_000_000n], "NotOwner");
    await reverts(kick, "returnToken", [usdc.target, ZeroAddress, 1n], "ZeroAddress");
    await reverts(kick, "returnToken", [usdc.target, kick.target, 1n], "ZeroAddress");
    await reverts(kick, "returnToken", [x.address, hh.address, 1n], "TransferFailed"); // not a token: no code
    await reverts(kick, "returnToken", [usdc.target, hh.address, 25_000_001n], "TransferFailed"); // more than it holds
    await send(usdc.setStyle(2)); // a token that answers false
    await reverts(kick, "returnToken", [usdc.target, hh.address, 1n], "TransferFailed");
    await send(usdc.setStyle(1)); // a token that answers nothing (like USDT)
    const rr = await send(kick.returnToken(usdc.target, hh.address, 5_000_000n));
    expect(logsOf(rr, kick, "TokenReturned").map((l) => [...l.args])).to.deep.equal([
      [usdc.target, hh.address, 5_000_000n],
    ]);
    await send(usdc.setStyle(0)); // like USDC: answers true
    await send(kick.returnToken(usdc.target, hh.address, 20_000_000n));
    expect(await usdc.balanceOf(hh.address)).to.equal(25_000_000n);
    expect(await usdc.balanceOf(kick.target)).to.equal(0n);
    // the ETH side never moved
    expect(await bal(kick)).to.equal(eth0);
    expect(await kick.reserved()).to.equal(D);
    // also after the list is posted and the pool is paid out
    await send(usdc.mint(kick.target, 7n));
    await h.settle(kick, [g.address], D);
    await send(kick.returnToken(usdc.target, x.address, 7n));
    expect(await usdc.balanceOf(x.address)).to.equal(7n);
  });

  it("reentrancy: a recipient calling back into the contract is refused, and its payment still arrives", async function () {
    const { guests } = ctx;
    const kick = await h.freshKick({ startIn: 1 });
    const g = guests[52]!;
    await h.stake(kick, [g]);
    const [w1, w2, w3, w4] = [
      await h.testWallet(kick),
      await h.testWallet(kick),
      await h.testWallet(kick),
      await h.testWallet(kick),
    ];
    const reentrancy = kickIface.getError("Reentrancy")!.selector;
    const notOpen = kickIface.getError("NotOpen")!.selector;
    await send(kick.registerStakers([g.address, w1.target, w2.target, w3.target, w4.target]));

    // while Open, a refunded wallet may deposit again during its refund: that only adds spare ETH
    await send(w1.setReentry(kick.target, kickIface.encodeFunctionData("deposit"), D));
    const r1 = await send(kick.rejectAndRefund([w1.target], { gasLimit: 1_000_000 }));
    expect(await w1.reentryOk()).to.equal(true);
    expect(logsOf(r1, kick, "Deposited").map((l) => [l.args.from, l.args.amount])).to.deep.equal([[w1.target, D]]);
    expect(await kick.stakerCount()).to.equal(4n);
    expect(await kick.spare()).to.equal(D); // the new deposit, not registered
    await reverts(kick, "rejectAndRefund", [[w1.target]], "CannotReject"); // already refunded once
    await send(kick.refund(w1.target, D)); // the organiser returns it as a stray transfer
    expect(await kick.spare()).to.equal(0n);

    // during the payout: w2 tries to release again, w3 tries to deposit, w4 refuses its share
    await send(w2.setReentry(kick.target, kickIface.encodeFunctionData("releasePayouts"), 0n));
    await send(w3.setReentry(kick.target, kickIface.encodeFunctionData("deposit"), D));
    await send(w4.setMode(MODE.Refuse));
    await warp(2);
    const list = [g.address, w2.target, w3.target, w4.target];
    await send(kick.postAttendance(list, D));
    await warp(DAY + 1);
    await send(kick.connect(guests[53]!).releasePayouts({ gasLimit: 2_000_000 }));
    expect([await w2.reentryOk(), await w2.reentryError()]).to.deep.equal([false, reentrancy]);
    expect([await w3.reentryOk(), await w3.reentryError()]).to.deep.equal([false, notOpen]); // paid out: deposits are closed
    expect(await bal(w2)).to.equal(D); // the reentry failed, the payment arrived
    expect(await bal(w3)).to.equal(D);
    expect(await kick.owed(w4.target)).to.equal(D);

    // a claim that calls claim again: refused, and the money is paid exactly once
    await send(w4.setReentry(kick.target, kickIface.encodeFunctionData("claim", [w4.target]), 0n));
    await send(w4.exec(kick.target, kickIface.encodeFunctionData("claim", [w4.target])));
    expect([await w4.reentryOk(), await w4.reentryError()]).to.deep.equal([false, reentrancy]);
    expect(await bal(w4)).to.equal(D);
    expect(await kick.owedTotal()).to.equal(0n);
    await h.walletReverts(w4, kick, "claim", [w4.target], "NothingToClaim");
    expect(await bal(kick)).to.equal(0n);
  });
});
