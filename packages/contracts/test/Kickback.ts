import { expect } from "chai";
import { ZeroAddress } from "ethers";

import {
  D,
  DAY,
  E,
  EXTRA,
  FEE,
  MODE,
  POLICY,
  addr,
  bal,
  deploy,
  errName,
  factory,
  helpers,
  kickIface,
  logsOf,
  minedButReverted,
  now,
  prov,
  rejects,
  reverts,
  send,
  sendReverts,
  setup,
  warp,
  type Ctx,
} from "./fixtures/kickback";

// Ported from kickback-legacy test/contract.test.mjs: deposits, curation refunds, the attendance list, payouts,
// wallets that refuse ETH or burn gas, cancel, emergency exit and two-step ownership, against the live build.
describe("TruthPaysKickback: deposits, curation, payouts, exits", function () {
  let ctx: Ctx;
  let h: ReturnType<typeof helpers>;
  before(async function () {
    ctx = await setup();
    h = helpers(ctx);
  });

  it("constructor: checks the times, deposit, owner and Dispute Resolver, and reads Kleros Court from it", async function () {
    const { owner, proxy, liquid, TPL } = ctx;
    const t = await now();
    const f = factory("TruthPaysKickback", owner);
    const o = owner.address;
    const W = 7 * DAY; // the settlement window after the event must be at least 7 days
    for (const bad of [
      [D, "x", o, t + 100, t + 100, h.arb()],
      [D, "x", o, t + 100, t + 100 + W - 1, h.arb()],
      [D, "x", o, t + 100, t + 100 + W, [ZeroAddress, EXTRA, TPL.pieces, TPL.slots, POLICY]],
      [D, "x", o, t + 100, t + 100 + W, [o, EXTRA, TPL.pieces, TPL.slots, POLICY]], // a wallet, not a Dispute Resolver
      [0n, "x", o, t + 100, t + 100 + W, h.arb()],
      [D, "x", ZeroAddress, t + 100, t + 100 + W, h.arb()],
    ]) {
      await rejects(f.deploy(...bad));
    }
    const k = await deploy("TruthPaysKickback", owner, D, "x", o, t + 100, t + 100 + W, h.arb());
    expect(await k.depositAmount()).to.equal(D);
    expect(await k.disputeResolver()).to.equal(proxy.target);
    expect(await k.arbitrator()).to.equal(liquid.target);
    expect(await k.arbitratorExtraData()).to.equal(EXTRA);
    const [pieces, slots] = await k.metaEvidenceTemplate();
    expect([[...pieces], slots]).to.deep.equal([TPL.pieces, TPL.slots]);
    expect(await k.policyURI()).to.equal(POLICY);
    expect(await k.PAYOUT_GAS()).to.equal(40_000n);
    expect(await k.RULING_OPTIONS()).to.equal(2n);
    expect(await k.challengeDeposit()).to.equal(FEE); // KlerosLiquid: fee per juror x 3 jurors
  });

  it("deposits: a plain transfer or deposit() logs Deposited; zero, odd calls and late deposits are refused, so the ETH stays in the wallet", async function () {
    const kick = await h.freshKick({ startIn: 1 });
    const [a, b, c] = ctx.guests.slice(0, 3) as [Ctx["owner"], Ctx["owner"], Ctx["owner"]];
    const r1 = await send(a.sendTransaction({ to: kick.target as string, value: D }));
    const r2 = await send(kick.connect(b).deposit({ value: D + 5n }));
    const logs = [...logsOf(r1, kick, "Deposited"), ...logsOf(r2, kick, "Deposited")];
    expect(logs.map((l) => [l.args.from, l.args.amount])).to.deep.equal([
      [a.address, D],
      [b.address, D + 5n],
    ]);
    expect(await bal(kick)).to.equal(2n * D + 5n);
    expect(await kick.spare()).to.equal(2n * D + 5n); // nobody registered yet: nothing is reserved
    await reverts(kick.connect(c), "deposit", [{ value: 0n }], "ZeroDeposit");
    await sendReverts(kick, c, 0n, "ZeroDeposit");
    // no fallback: a call with unknown data is refused
    await rejects(prov().call({ from: c.address, to: kick.target as string, value: D, data: "0x12345678" }));

    await send(kick.registerStakers([a.address, b.address]));
    await warp(2);
    await send(kick.postAttendance([a.address], 2n * D));
    // the list is posted: no more deposits
    await sendReverts(kick, c, D, "NotOpen");
    await reverts(kick.connect(c), "deposit", [{ value: D }], "NotOpen");
    const e0 = await bal(c);
    // forced through anyway: mined, but reverted
    const receipt = await minedButReverted(
      c.sendTransaction({ to: kick.target as string, value: D, gasLimit: 100000 }),
    );
    expect(await bal(c)).to.equal(e0 - receipt.fee); // only the gas is spent
    await warp(DAY + 1);
    await send(kick.releasePayouts());
    await sendReverts(kick, c, D, "NotOpen"); // paid out
    const k2 = await h.freshKick();
    await send(k2.cancel());
    await sendReverts(k2, c, D, "NotOpen"); // cancelled
    await reverts(k2.connect(c), "deposit", [{ value: D }], "NotOpen");
  });

  it("rejectAndRefund: declined payers and dropped stakers get exactly their deposit back", async function () {
    const kick = await h.freshKick();
    const [a, b, c, d] = ctx.guests as [Ctx["owner"], Ctx["owner"], Ctx["owner"], Ctx["owner"]];
    await h.stake(kick, [a, b, c, d]);
    await send(kick.registerStakers([a.address, b.address]));
    const before = await bal(c);
    // c and d paid but are declined; b drops out after being registered
    const r = await send(kick.rejectAndRefund([c.address, d.address, b.address]));
    expect(logsOf(r, kick, "Payout").length).to.equal(3);
    expect(await bal(c)).to.equal(before + D);
    expect(await kick.stakerCount()).to.equal(1n);
    expect(await bal(kick)).to.equal(D);
    expect(await kick.status(c.address)).to.equal(3n); // Rejected
    // cannot reject twice
    await reverts(kick, "rejectAndRefund", [[c.address]], "CannotReject");
    // a rejected wallet may come back, but only once it has paid again
    await reverts(kick, "registerStakers", [[c.address]], "InsufficientBalance");
    await h.stake(kick, [c]);
    await send(kick.registerStakers([c.address]));
    expect(await kick.status(c.address)).to.equal(1n); // Staker
    expect(await kick.stakerCount()).to.equal(2n);
    // an unregistered wallet with no spare money behind it cannot be "refunded" out of the pool
    await reverts(kick, "rejectAndRefund", [[ctx.guests[10]!.address]], "InsufficientBalance");
    // the contract itself can never be registered or refunded
    await reverts(kick, "rejectAndRefund", [[kick.target]], "ZeroAddress");
    await reverts(kick, "registerStakers", [[kick.target]], "ZeroAddress");
    // only owner
    await reverts(kick.connect(a), "rejectAndRefund", [[a.address]], "NotOwner");
  });

  it("refund can only use spare money, never the pool", async function () {
    const kick = await h.freshKick();
    const [a, b] = ctx.guests.slice(20) as [Ctx["owner"], Ctx["owner"]];
    await h.stake(kick, [a, b]);
    const extra = E("0.005");
    await send(a.sendTransaction({ to: kick.target as string, value: extra })); // overpayment
    await send(kick.registerStakers([a.address, b.address]));
    expect(await kick.spare()).to.equal(extra);
    await reverts(kick, "refund", [a.address, extra + 1n], "InsufficientBalance");
    await reverts(kick, "refund", [kick.target, 1n], "ZeroAddress");
    const a0 = await bal(a);
    await send(kick.refund(a.address, extra));
    expect(await bal(a)).to.equal(a0 + extra);
    expect(await kick.spare()).to.equal(0n);
    await reverts(kick, "refund", [a.address, 1n], "InsufficientBalance");
  });

  it("registerStakers refuses wallets the balance does not cover", async function () {
    const kick = await h.freshKick();
    const [a, b] = ctx.guests.slice(30) as [Ctx["owner"], Ctx["owner"]];
    await h.stake(kick, [a]);
    await reverts(kick, "registerStakers", [[a.address, b.address]], "InsufficientBalance");
    await send(kick.registerStakers([a.address]));
  });

  it("postAttendance: not before the event, and only with the share the organiser confirmed", async function () {
    const { owner, guests } = ctx;
    const kick = await h.freshKick({ startIn: 3600 });
    const gs = guests.slice(40, 44);
    await h.stake(kick, gs);
    await send(kick.registerStakers(await Promise.all(gs.map(addr))));
    const att = await Promise.all(gs.slice(0, 3).map(addr)); // 3 of 4 show up
    const share = (D * 4n) / 3n;
    await reverts(kick, "postAttendance", [att, share], "TooEarly");
    await warp(3601);
    await reverts(kick, "postAttendance", [att, D], "ShareMismatch");
    await reverts(kick, "postAttendance", [[], 0n], "NoAttendees");
    await reverts(kick, "postAttendance", [[att[0], att[0]], 2n * D], "DuplicateAttendee");
    await reverts(kick, "postAttendance", [[guests[50]!.address], 4n * D], "NotAStaker");
    await reverts(kick.connect(gs[0]!), "postAttendance", [att, share], "NotOwner");
    await reverts(kick, "releasePayouts", [], "NotListed");
    const b0 = await bal(att[0]!);
    await send(kick.postAttendance(att, share));
    expect(await kick.phase()).to.equal(1n); // Listed
    expect(await kick.attendeeCount()).to.equal(3n);
    // the list is posted once; the pool stays locked during the challenge window
    await reverts(kick, "postAttendance", [att, share], "NotOpen");
    await reverts(kick, "cancel", [], "NotOpen");
    await reverts(kick, "rejectAndRefund", [[att[0]]], "CannotReject");
    await reverts(kick, "sweep", [owner.address], "NotSettled");
    expect(await kick.spare()).to.equal(0n);
    await reverts(kick, "releasePayouts", [], "TooEarly");
    await warp(DAY + 1);
    await send(kick.connect(guests[51]!).releasePayouts()); // anyone can release
    expect(await bal(att[0]!)).to.equal(b0 + share);
    expect(await kick.phase()).to.equal(2n); // Finalized
    expect(await kick.status(att[0])).to.equal(2n); // Paid
    expect(await kick.status(gs[3]!.address)).to.equal(1n); // no-show stays a Staker, deposit forfeited
    // dust only; sweep takes it, nothing else
    const dust = await bal(kick);
    expect(dust).to.equal(4n * D - 3n * share);
    expect(await kick.spare()).to.equal(dust);
    await send(kick.sweep(owner.address));
    expect(await bal(kick)).to.equal(0n);
  });

  it("a wallet that refuses ETH or burns its gas does not block the payout: its share waits in owed; a heavy smart wallet is paid directly", async function () {
    const { owner, guests } = ctx;
    const kick = await h.freshKick({ startIn: 1 });
    const g = guests[60]!;
    await h.stake(kick, [g]);
    const refuser = await h.testWallet(kick, MODE.Refuse);
    const burner = await h.testWallet(kick, MODE.BurnGas);
    const busy = await h.testWallet(kick, MODE.Busy);
    const all = [g.address, refuser.target, burner.target, busy.target] as string[];
    await send(kick.registerStakers(all));
    await warp(2);
    const g0 = await bal(g);
    const r = await h.settle(kick, all, D);
    expect(await bal(g)).to.equal(g0 + D);
    expect(await bal(busy)).to.equal(D); // needs ~28k gas: more than transfer's 2,300, within PAYOUT_GAS
    expect(await busy.received()).to.equal(1n);
    expect(logsOf(r, kick, "PayoutFailed").map((l) => l.args.to)).to.deep.equal([refuser.target, burner.target]);
    expect(await kick.owed(refuser.target)).to.equal(D);
    expect(await kick.owed(burner.target)).to.equal(D);
    expect(await kick.owedTotal()).to.equal(2n * D);
    expect(await kick.reserved()).to.equal(2n * D);
    // sweep must not take the unclaimed payments
    await send(kick.sweep(owner.address));
    expect(await bal(kick)).to.equal(2n * D);
    // the refuser claims to another address of its own
    const alt = guests[70]!.address;
    const altBefore = await bal(alt);
    await send(refuser.exec(kick.target, kickIface.encodeFunctionData("claim", [alt])));
    expect(await bal(alt)).to.equal(altBefore + D);
    await h.walletReverts(refuser, kick, "claim", [alt], "NothingToClaim");
    // a claim to an address that refuses ETH reverts and keeps the money owed
    await h.walletReverts(burner, kick, "claim", [refuser.target], "TransferFailed");
    await h.walletReverts(burner, kick, "claim", [ZeroAddress], "ZeroAddress");
    // once the burner accepts ETH it claims to itself (claim forwards all the gas)
    await send(burner.setMode(MODE.Accept));
    await send(burner.exec(kick.target, kickIface.encodeFunctionData("claim", [burner.target])));
    expect(await bal(burner)).to.equal(D);
    expect(await kick.owedTotal()).to.equal(0n);
    expect(await bal(kick)).to.equal(0n);
  });

  it("a caller cannot starve a payment into owed by sending too little gas (NotEnoughGas)", async function () {
    const { guests } = ctx;
    const kick = await h.freshKick({ startIn: 1 });
    const smart = await h.testWallet(kick, MODE.Busy); // a smart wallet that needs ~28k gas to receive
    await send(kick.registerStakers([smart.target]));
    await warp(2);
    await send(kick.postAttendance([smart.target], D));
    await warp(DAY + 1);
    const tryGas = (gasLimit: number) =>
      kick.releasePayouts.staticCall({ gasLimit }).then(
        () => null,
        (e: unknown) => errName(e) ?? "out of gas",
      );
    // with a little too little gas the smart wallet's call would fail; the contract refuses instead of recording it as owed
    const outcomes = new Set<string | null>();
    for (let g = 60_000; g <= 200_000; g += 2_000) outcomes.add(await tryGas(g));
    expect(outcomes.has("NotEnoughGas"), [...outcomes].join(", ")).to.equal(true);
    // whatever gas a caller picks, a release that goes through has paid the wallet directly
    let lo = 60_000;
    let hi = 400_000;
    while (hi - lo > 200) {
      const mid = Math.floor((lo + hi) / 2);
      if ((await tryGas(mid)) === null) hi = mid;
      else lo = mid;
    }
    const r = await send(kick.connect(guests[61]!).releasePayouts({ gasLimit: hi }));
    expect(logsOf(r, kick, "PayoutFailed").length).to.equal(0);
    expect(await bal(smart)).to.equal(D);
    expect(await kick.owedTotal()).to.equal(0n);

    // a wallet that burns all its gas is recorded as owed only after it had its full PAYOUT_GAS
    const k2 = await h.freshKick({ startIn: 1 });
    const burner = await h.testWallet(k2, MODE.BurnGas);
    await send(k2.registerStakers([burner.target]));
    await warp(2);
    await send(k2.postAttendance([burner.target], D));
    await warp(DAY + 1);
    const r2 = await send(k2.connect(guests[61]!).releasePayouts({ gasLimit: 1_000_000 }));
    expect(r2.gasUsed > 40_000n, `gas used ${r2.gasUsed}`).to.equal(true);
    expect(await k2.owed(burner.target)).to.equal(D);
  });

  it("cancel refunds every active staker; a wallet that refuses ETH can claim", async function () {
    const { guests } = ctx;
    const kick = await h.freshKick();
    const gs = guests.slice(80, 84);
    await h.stake(kick, gs);
    const refuser = await h.testWallet(kick, MODE.Refuse);
    await send(kick.registerStakers([...(await Promise.all(gs.map(addr))), refuser.target]));
    await send(kick.rejectAndRefund([gs[3]!.address]));
    const b0 = await bal(gs[0]!);
    await send(kick.cancel());
    expect(await bal(gs[0]!)).to.equal(b0 + D);
    expect(await kick.owed(refuser.target)).to.equal(D);
    expect(await kick.reserved()).to.equal(D);
    await reverts(kick, "registerStakers", [[guests[90]!.address]], "NotOpen");
    // a registered staker was already paid back by cancel; cannot be "rejected" again
    await reverts(kick, "rejectAndRefund", [[gs[0]!.address]], "CannotReject");
    // a payer who was never registered can't send after cancel (the deposit is refused), but one who paid
    // before cancel and was not registered can still be refunded from spare money
    const k2 = await h.freshKick();
    const late = guests[91]!;
    await h.stake(k2, [late]);
    await send(k2.cancel());
    const lb = await bal(late);
    await send(k2.rejectAndRefund([late.address]));
    expect(await bal(late)).to.equal(lb + D);
    await send(refuser.setMode(MODE.Accept));
    await send(refuser.exec(kick.target, kickIface.encodeFunctionData("claim", [refuser.target])));
    expect(await bal(kick)).to.equal(0n);
  });

  it("emergencyWithdraw only after the deadline, only for active stakers, only once", async function () {
    const { guests } = ctx;
    const W = 7 * 86400;
    const kick = await h.freshKick({ startIn: 10, deadlineIn: 10 + W });
    const gs = guests.slice(100, 103) as [Ctx["owner"], Ctx["owner"], Ctx["owner"]];
    await h.stake(kick, gs);
    await send(kick.registerStakers(await Promise.all(gs.map(addr))));
    const to0 = gs[0].address;
    await reverts(kick.connect(gs[0]), "emergencyWithdraw", [to0], "TooEarly");
    await warp(11 + W);
    // after the deadline the organiser can no longer settle: no last-second race with stakers
    await reverts(kick, "postAttendance", [[gs[1].address], 3n * D], "TooLate");
    await reverts(kick, "cancel", [], "TooLate");
    const b0 = await bal(gs[0]);
    const r = await send(kick.connect(gs[0]).emergencyWithdraw(to0));
    expect(await bal(gs[0])).to.equal(b0 + D - r.fee);
    expect(await kick.stakerCount()).to.equal(2n);
    await reverts(kick.connect(gs[0]), "emergencyWithdraw", [to0], "NotAStaker");
    await reverts(kick.connect(guests[105]!), "emergencyWithdraw", [guests[105]!.address], "NotAStaker");
    await reverts(kick.connect(gs[1]), "emergencyWithdraw", [kick.target], "ZeroAddress");
    // a staker can withdraw to another address of their own
    const alt = guests[106]!.address;
    const ab = await bal(alt);
    await send(kick.connect(gs[1]).emergencyWithdraw(alt));
    expect(await bal(alt)).to.equal(ab + D);
    await send(kick.connect(gs[2]).emergencyWithdraw(gs[2].address));
    expect(await bal(kick)).to.equal(0n);
  });

  it("a wallet that refuses ETH in a reject batch is kept for claim; the rest are refunded", async function () {
    const { owner, guests } = ctx;
    const kick = await h.freshKick();
    const gs = guests.slice(120, 122) as [Ctx["owner"], Ctx["owner"]];
    await h.stake(kick, gs);
    const refuser = await h.testWallet(kick, MODE.Refuse);
    const b = [await bal(gs[0]), await bal(gs[1])];
    await send(kick.rejectAndRefund([gs[0].address, refuser.target, gs[1].address]));
    expect(await bal(gs[0])).to.equal(b[0]! + D);
    expect(await bal(gs[1])).to.equal(b[1]! + D);
    expect(await kick.owed(refuser.target)).to.equal(D);
    expect(await kick.spare()).to.equal(0n); // the owed deposit is reserved, refund() cannot touch it
    await reverts(kick, "refund", [owner.address, 1n], "InsufficientBalance");
    await send(refuser.exec(kick.target, kickIface.encodeFunctionData("claim", [guests[123]!.address])));
    expect(await bal(kick)).to.equal(0n);
  });

  it("two-step ownership", async function () {
    const { owner, guests } = ctx;
    const kick = await h.freshKick();
    const [n, x] = guests.slice(110) as [Ctx["owner"], Ctx["owner"]];
    await send(kick.transferOwnership(n.address));
    expect(await kick.owner()).to.equal(owner.address);
    await reverts(kick.connect(x), "acceptOwnership", [], "NotPendingOwner");
    await send(kick.connect(n).acceptOwnership());
    expect(await kick.owner()).to.equal(n.address);
    await reverts(kick, "registerStakers", [[x.address]], "NotOwner");
  });
});
