import { expect } from "chai";
import type { EventLog } from "ethers";

import { ipfsPathOf, renderCase } from "../local/caseTemplate";
import {
  D,
  DAY,
  E,
  EXTRA,
  FEE,
  FEE_PER_JUROR,
  KGAS,
  MAX,
  POLICY,
  addr,
  bal,
  helpers,
  logsOf,
  prov,
  rejects,
  reverts,
  send,
  setup,
  warp,
  type Ctx,
} from "./fixtures/kickback";

const W_ALL = "withdrawFeesAndRewardsForAllRounds";
/** 4 stakers, 3 final attendees */
const THIRD = (4n * D) / 3n;

// Ported from kickback-legacy test/contract.test.mjs: Kleros Court v1 challenges through the Dispute Resolver
// (evidence, appeals funded from the funders' own wallets, the one-side-funded override, refusal to rule) and
// payouts with shares set aside for open cases, fair in any settlement order.
describe("TruthPaysKickback: Kleros challenges", function () {
  let ctx: Ctx;
  let h: ReturnType<typeof helpers>;
  before(async function () {
    ctx = await setup();
    h = helpers(ctx);
  });

  it("challenge guards: only listed-out stakers, inside the window, with the Kleros fee", async function () {
    const { kick, gs } = await h.listed([140, 144], 2); // gs[2], gs[3] left off
    expect(await kick.challengeDeposit()).to.equal(FEE);
    await reverts(kick.connect(gs[0]!), "challenge", [{ value: FEE }], "AlreadyAttending");
    await reverts(kick.connect(ctx.guests[145]!), "challenge", [{ value: FEE }], "NotAStaker");
    await reverts(kick.connect(gs[2]!), "challenge", [{ value: FEE - 1n }], "WrongDeposit");
    await reverts(kick, "matchChallenge", [gs[2]!.address, { value: FEE }], "NoChallenge");
    // overpaying is fine: the extra comes straight back
    const e0 = await bal(gs[2]!);
    const r = await send(kick.connect(gs[2]!).challenge({ value: FEE * 2n }));
    expect(await bal(gs[2]!)).to.equal(e0 - FEE - r.fee);
    expect(await kick.challengeEscrow()).to.equal(FEE);
    expect(await kick.reserved()).to.equal(4n * D + FEE);
    await reverts(kick.connect(gs[2]!), "challenge", [{ value: FEE }], "AlreadyChallenged");
    await reverts(kick, "resolveChallenge", [gs[2]!.address], "TooEarly");
    await reverts(kick, "matchChallenge", [gs[2]!.address, { value: FEE - 1n }], "WrongDeposit");
    // the challenge window closes after 1 day
    await warp(DAY + 1);
    await reverts(kick.connect(gs[3]!), "challenge", [{ value: FEE }], "TooLate");
    // the match window (1 day from the challenge) has closed too
    await reverts(kick, "matchChallenge", [gs[2]!.address, { value: FEE }], "TooLate");
  });

  it("unmatched challenge: the guest counts as attended, gets the deposit back, shares the pool", async function () {
    const { kick, gs } = await h.listed([0, 4], 2);
    const g = gs[2]!;
    await send(kick.connect(g).challenge({ value: FEE }));
    expect(await bal(kick)).to.equal(4n * D + FEE);
    await warp(DAY + 1);
    const e0 = await bal(g);
    // releasePayouts accepts the unmatched challenge on its own: 4 deposits over 3 attendees
    await send(kick.connect(ctx.guests[150]!).releasePayouts());
    expect(await bal(g)).to.equal(e0 + FEE + THIRD);
    expect(await kick.attendeeCount()).to.equal(3n);
    expect(await kick.challengeEscrow()).to.equal(0n);
    expect(await bal(kick)).to.equal(4n * D - 3n * THIRD); // rounding dust only
    const c = await kick.challenges(g.address);
    expect(c.state).to.equal(3n); // Resolved
  });

  it("matched challenge opens a Kleros v1 case through the Dispute Resolver; payouts go out anyway, with the challenger's share set aside", async function () {
    const { owner, liquid, proxy, TPL, guests } = ctx;
    const { kick, gs } = await h.listed([4, 8], 2);
    const [g, m] = [gs[2]!, owner];
    await send(kick.connect(g).challenge({ value: FEE }));
    const l0 = await bal(liquid);
    const r = await send(kick.connect(m).matchChallenge(g.address, { value: FEE + 7n })); // extra comes back
    const c = await kick.challenges(g.address);
    expect(c.state).to.equal(2n); // Disputed
    expect(c.matcher).to.equal(m.address);
    expect(c.arbitratorDisputeID).to.equal(1000n + c.localDisputeID); // two numbers for one case, like on mainnet
    expect(await proxy.externalIDtoLocalID(c.arbitratorDisputeID)).to.equal(c.localDisputeID);
    expect(await bal(liquid)).to.equal(l0 + FEE); // Kleros got exactly its fee
    expect(await bal(kick)).to.equal(4n * D + FEE); // the pool + what is left of the two deposits
    expect(await kick.challengeEscrow()).to.equal(FEE);
    const [ev] = logsOf(r, kick, "ChallengeMatched");
    expect([...ev!.args]).to.deep.equal([g.address, m.address, c.arbitratorDisputeID, c.localDisputeID]);
    // the Dispute Resolver opened the case with this case's own description, 2 ruling options and the court settings
    const pd = await proxy.disputes(c.localDisputeID);
    expect(pd.disputeIDOnArbitratorSide).to.equal(c.arbitratorDisputeID);
    expect(pd.arbitratorExtraData).to.equal(EXTRA);
    expect(pd.isRuled).to.equal(false);
    expect(await proxy.numberOfRulingOptions(c.localDisputeID)).to.equal(2n);
    const [meta] = logsOf(r, proxy, "MetaEvidence");
    const [text, uri] = await kick.caseMetaEvidence(g.address);
    expect(text).to.equal(renderCase(TPL, g.address, kick.target as string));
    expect(uri).to.equal(ipfsPathOf(text));
    expect([...meta!.args]).to.deep.equal([c.localDisputeID, uri]);
    const json = JSON.parse(text);
    expect(
      json.question.includes(g.address) && json.description.includes(kick.target),
      "names the wallet and the deposit contract",
    ).to.equal(true);
    expect(json.description.includes(owner.address), "names the organiser's wallet").to.equal(true);
    // Kleros Court labels evidence with aliases[sender], the sender in lower case
    expect(json.aliases[g.address.toLowerCase()]).to.equal("Challenger (the guest's wallet)");
    expect(json.aliases[owner.address.toLowerCase()]).to.equal("Organiser (Truth Pays owner wallet)");
    expect(json.fileURI).to.equal(POLICY);
    expect(r.gasUsed < 800_000n, `matchChallenge used ${r.gasUsed} gas`).to.equal(true); // about 650,000 with this template
    const [disp] = logsOf(r, proxy, "Dispute");
    expect([...disp!.args]).to.deep.equal([liquid.target, c.arbitratorDisputeID, c.localDisputeID, c.localDisputeID]);
    const ld = await liquid.disputes(c.arbitratorDisputeID);
    expect(ld.arbitrated).to.equal(proxy.target);
    expect(ld.numberOfChoices).to.equal(2n);
    expect(ld.drawsInRound).to.equal(3n); // 3 jurors, from the extra data
    await reverts(kick, "addAttendees", [[g.address]], "InDispute"); // the jurors decide now
    await warp(DAY * 3);
    await reverts(kick, "resolveChallenge", [g.address], "NotRuled");
    const [a0, a1] = [await bal(gs[0]!), await bal(gs[1]!)];
    await send(kick.connect(guests[151]!).releasePayouts()); // 3 shares: two attendees paid, one set aside
    expect(await bal(gs[0]!)).to.equal(a0 + THIRD);
    expect(await bal(gs[1]!)).to.equal(a1 + THIRD);
    expect(await kick.heldBack()).to.equal(THIRD);
    expect((await kick.challenges(g.address)).heldShare).to.equal(THIRD);
    expect(await kick.reserved()).to.equal(THIRD + FEE);
    expect(await kick.spare()).to.equal(4n * D - 3n * THIRD); // rounding dust only
    await send(liquid.giveFinalRuling(c.arbitratorDisputeID, 1, KGAS)); // jurors: attended
    const e0 = await bal(g);
    const rr = await send(kick.connect(guests[151]!).resolveChallenge(g.address));
    expect(await bal(g)).to.equal(e0 + FEE + THIRD); // the other side's deposit (after the fee) and the share set aside
    expect(logsOf(rr, kick, "Payout").map((l) => [l.args.to, l.args.amount])).to.deep.equal([[g.address, THIRD]]);
    expect(await kick.attended(g.address)).to.equal(true);
    expect(await kick.heldBack()).to.equal(0n);
    expect(await kick.challengeEscrow()).to.equal(0n);
    expect((await kick.challenges(g.address)).heldShare).to.equal(0n);
    expect(await bal(kick)).to.equal(4n * D - 3n * THIRD);
    await reverts(kick, "resolveChallenge", [g.address], "WrongChallengeState");
  });

  it("evidence goes to the Dispute Resolver under the case's local ID, from anyone's wallet, until the case is ruled", async function () {
    const { owner, liquid, proxy } = ctx;
    const { kick, gs } = await h.listed([8, 12], 2);
    const g = gs[2]!;
    await send(kick.connect(g).challenge({ value: FEE }));
    await send(kick.matchChallenge(g.address, { value: FEE }));
    const c = await kick.challenges(g.address);
    const r1 = await send(proxy.connect(g).submitEvidence(c.localDisputeID, "/ipfs/QmGuestEvidence/photo.json"));
    const r2 = await send(
      proxy.connect(owner).submitEvidence(c.localDisputeID, "/ipfs/QmOrganiserEvidence/door-list.json"),
    );
    const evs = [...logsOf(r1, proxy, "Evidence"), ...logsOf(r2, proxy, "Evidence")];
    expect(evs.map((e) => [e.args._arbitrator, e.args._evidenceGroupID, e.args._party])).to.deep.equal([
      [liquid.target, c.localDisputeID, g.address],
      [liquid.target, c.localDisputeID, owner.address],
    ]);
    // the Dispute event links Kleros's case number to that evidence group
    const [disp] = (await proxy.queryFilter(
      proxy.filters.Dispute!(liquid.target, c.arbitratorDisputeID),
    )) as EventLog[];
    expect(disp!.args._evidenceGroupID).to.equal(c.localDisputeID);
    await send(liquid.giveFinalRuling(c.arbitratorDisputeID, 2, KGAS));
    await rejects(
      proxy.submitEvidence.staticCall(c.localDisputeID, "/ipfs/QmLate/x.json"),
      /Cannot submit evidence to a resolved dispute/,
    );
  });

  it("Kleros rules absent: the matcher is repaid and the guest forfeits", async function () {
    const { owner, liquid, guests } = ctx;
    const { kick, gs } = await h.listed([12, 16], 2);
    const [g, m] = [gs[2]!, guests[152]!];
    await send(kick.connect(g).challenge({ value: FEE }));
    await send(kick.connect(m).matchChallenge(g.address, { value: FEE }));
    const c = await kick.challenges(g.address);
    await send(liquid.giveFinalRuling(c.arbitratorDisputeID, 2, KGAS));
    const [em, eg] = [await bal(m), await bal(g)];
    await send(kick.connect(owner).resolveChallenge(g.address));
    expect(await bal(m)).to.equal(em + FEE);
    expect(await bal(g)).to.equal(eg);
    await warp(DAY + 1);
    const [u0, a0] = [await bal(g), await bal(gs[0]!)];
    await send(kick.connect(owner).releasePayouts());
    expect(await bal(g)).to.equal(u0); // nothing
    expect(await bal(gs[0]!)).to.equal(a0 + 2n * D); // 4 deposits over 2 attendees
    expect(await bal(kick)).to.equal(0n);
  });

  it("Kleros refuses to arbitrate (ruling 0): both sides get half back, guest stays off the list", async function () {
    const { owner, liquid, guests } = ctx;
    const { kick, gs } = await h.listed([16, 19], 2);
    const [g, m] = [gs[2]!, guests[153]!];
    await send(kick.connect(g).challenge({ value: FEE }));
    await send(kick.connect(m).matchChallenge(g.address, { value: FEE }));
    await send(liquid.giveFinalRuling((await kick.challenges(g.address)).arbitratorDisputeID, 0, KGAS));
    const [eg, em] = [await bal(g), await bal(m)];
    await send(kick.connect(owner).resolveChallenge(g.address));
    expect(await bal(g)).to.equal(eg + FEE / 2n);
    expect(await bal(m)).to.equal(em + FEE - FEE / 2n);
    expect(await kick.attended(g.address)).to.equal(false);
    expect(await kick.challengeEscrow()).to.equal(0n);
  });

  it("the organiser can add a forgotten guest during the window; a waiting challenge is refunded", async function () {
    const { kick, gs } = await h.listed([19, 23], 2);
    const g = gs[2]!;
    await send(kick.connect(g).challenge({ value: FEE }));
    const e0 = await bal(g);
    await reverts(kick.connect(g), "addAttendees", [[g.address]], "NotOwner");
    await send(kick.addAttendees([g.address, gs[3]!.address]));
    expect(await bal(g)).to.equal(e0 + FEE);
    expect(await kick.attendeeCount()).to.equal(4n);
    expect(await kick.pendingChallenges()).to.equal(0n);
    expect(await kick.challengeEscrow()).to.equal(0n);
    await reverts(kick, "addAttendees", [[g.address]], "DuplicateAttendee");
    await warp(DAY + 1);
    await reverts(kick, "addAttendees", [[ctx.guests[154]!.address]], "TooLate");
    await send(kick.releasePayouts());
    expect(await bal(kick)).to.equal(0n);
  });

  it("a match is refused if the Kleros fee more than doubled since the challenge", async function () {
    const { liquid } = ctx;
    const { kick, gs } = await h.listed([23, 26], 2);
    const g = gs[2]!;
    await send(kick.connect(g).challenge({ value: FEE }));
    try {
      await send(liquid.setFeeForJuror(2n * FEE_PER_JUROR + 1n, KGAS));
      await reverts(kick, "matchChallenge", [g.address, { value: FEE }], "ArbitrationCostTooHigh");
      await send(liquid.setFeeForJuror(2n * FEE_PER_JUROR, KGAS)); // exactly double: both deposits pay the fee
      await send(kick.matchChallenge(g.address, { value: FEE }));
      expect((await kick.challenges(g.address)).arbitrationPaid).to.equal(2n * FEE);
      expect(await kick.challengeEscrow()).to.equal(0n);
    } finally {
      await send(liquid.setFeeForJuror(FEE_PER_JUROR, KGAS));
    }
  });

  it("appeals are funded on the Dispute Resolver from the funders' own wallets; it pays them directly; only the final ruling counts", async function () {
    const { owner, liquid, proxy, guests } = ctx;
    const { kick, gs } = await h.listed([26, 30], 2);
    const [g, m, crowd, bot] = [gs[2]!, guests[156]!, guests[157]!, guests[151]!];
    await send(kick.connect(g).challenge({ value: FEE }));
    await send(kick.connect(m).matchChallenge(g.address, { value: FEE }));
    const { arbitratorDisputeID: id, localDisputeID: local } = await kick.challenges(g.address);
    await warp(DAY + 1);
    await reverts(kick, "appealStatus", [gs[3]!.address], "NotAppealable");
    expect((await kick.appealStatus(g.address)).end).to.equal(0n); // the jurors have not voted yet

    // round 1: jurors say "did not attend"; the guest's side appeals (cost + 2x), the matcher's side defends (cost + 1x)
    await send(liquid.startAppealPeriod(id, 2, 3 * DAY, KGAS));
    await reverts(kick, "resolveChallenge", [g.address], "NotRuled"); // a round-1 vote is not final
    const cost: bigint = await liquid.appealCost(id, EXTRA);
    expect(cost).to.equal(7n * FEE_PER_JUROR); // next jury: 2 x 3 + 1 jurors
    const st = await kick.appealStatus(g.address);
    expect(st.ruling).to.equal(2n);
    expect(st.costAttended).to.equal(3n * cost); // lost the vote: cost + 2x
    expect(st.costAbsent).to.equal(2n * cost); // won the vote: cost + 1x
    const [start, end]: bigint[] = [st.start, st.end];
    expect(st.loserEnd).to.equal(start! + (end! - start!) / 2n);
    const part = E("0.02");
    await send(proxy.connect(crowd).fundAppeal(local, 1, { value: part, gasLimit: 500000 })); // crowdfunding: anyone can chip in
    const e0 = await bal(g);
    const r = await send(proxy.connect(g).fundAppeal(local, 1, { value: 3n * cost, gasLimit: 500000 })); // more than missing
    const rest = 3n * cost - part;
    expect(await bal(g)).to.equal(e0 - rest - r.fee); // the Dispute Resolver returned the surplus to the funder
    const contributions = (await proxy.queryFilter(proxy.filters.Contribution!(local))) as EventLog[];
    expect(contributions.map((l) => [l.args.contributor, l.args.ruling, l.args.amount])).to.deep.equal([
      [crowd.address, 1n, part],
      [g.address, 1n, rest],
    ]); // Kleros records the real funders, never the deposit contract
    await send(proxy.connect(m).fundAppeal(local, 2, { value: 2n * cost, gasLimit: 500000 }));
    expect(await liquid.rounds(id)).to.equal(2n); // both sides funded: a new, bigger jury
    expect((await liquid.disputes(id)).period).to.equal(0n); // evidence period again
    expect((await kick.appealStatus(g.address)).end).to.equal(0n); // round 2 is not in its appeal period yet
    expect(await bal(kick)).to.equal(4n * D + FEE); // only the pool and what is left of the challenge deposits
    await reverts(kick, "resolveChallenge", [g.address], "NotRuled");

    // round 2: jurors say "attended"; nobody appeals; the ruling becomes final
    await send(liquid.startAppealPeriod(id, 1, DAY, KGAS));
    expect((await kick.appealStatus(g.address)).costAbsent).to.equal(3n * 15n * FEE_PER_JUROR); // 15 jurors next, loser pays 3x
    await warp(DAY + 1);
    await reverts(kick, "resolveChallenge", [g.address], "NotRuled");
    await send(liquid.passPeriod(id, KGAS));
    await send(liquid.executeRuling(id, KGAS));
    const pd = await proxy.disputes(local);
    expect([pd.isRuled, pd.ruling]).to.deep.equal([true, 1n]);
    // funders collect refunds and rewards from the Dispute Resolver straight to their wallets (anyone can trigger it)
    const rewards = 3n * cost + 2n * cost - cost; // both sides' funding minus the appeal fee, to the "attended" funders
    expect(await proxy.getTotalWithdrawableAmount(local, crowd.address, [1, 2])).to.equal(
      (part * rewards) / (3n * cost),
    );
    const c0 = await bal(crowd);
    await send(proxy.connect(bot)[W_ALL](local, crowd.address, [1, 2], KGAS));
    expect(await bal(crowd)).to.equal(c0 + (part * rewards) / (3n * cost));
    const g0 = await bal(g);
    await send(proxy.connect(bot)[W_ALL](local, g.address, [1, 2], KGAS));
    expect(await bal(g)).to.equal(g0 + (rest * rewards) / (3n * cost));
    expect(await proxy.getTotalWithdrawableAmount(local, m.address, [1, 2])).to.equal(0n); // backed the losing side
    expect(await proxy.getTotalWithdrawableAmount(local, kick.target, [1, 2])).to.equal(0n); // nothing is owed to the deposit contract
    expect(await bal(kick)).to.equal(4n * D + FEE);

    // the deposit contract settles from the final ruling alone
    const e1 = await bal(g);
    await send(kick.connect(owner).resolveChallenge(g.address));
    expect(await bal(g)).to.equal(e1 + FEE); // the final winner gets what is left of both deposits
    expect(await kick.attended(g.address)).to.equal(true);
    await reverts(kick, "appealStatus", [g.address], "NotAppealable");
    const u0 = await bal(g);
    await send(kick.connect(bot).releasePayouts());
    expect(await bal(g)).to.equal(u0 + THIRD);
    expect(await bal(kick)).to.equal(4n * D - 3n * THIRD); // dust only: no appeal money ever passes through this contract
  });

  it("an appeal funded by one side only wins the case (the Dispute Resolver's override); the contract follows the final ruling", async function () {
    const { owner, liquid, proxy, guests } = ctx;
    const { kick, gs } = await h.listed([30, 34], 2); // 4 stakers, 2 on the list
    const [g, m, crowd] = [gs[2]!, guests[155]!, guests[158]!];
    await send(kick.connect(g).challenge({ value: FEE }));
    await send(kick.connect(m).matchChallenge(g.address, { value: FEE }));
    const { arbitratorDisputeID: id, localDisputeID: local } = await kick.challenges(g.address);
    await warp(DAY + 1);
    await send(kick.releasePayouts()); // 4 deposits / (2 + 1); the challenger's share is set aside
    expect((await kick.challenges(g.address)).heldShare).to.equal(THIRD);

    // round 1: jurors say "did not attend". The crowd and the guest fully fund "attended";
    // the matcher's side raises only part of "did not attend" and nobody completes it
    await send(liquid.startAppealPeriod(id, 2, 2 * DAY, KGAS));
    const cost: bigint = await liquid.appealCost(id, EXTRA);
    await send(proxy.connect(crowd).fundAppeal(local, 1, { value: cost, gasLimit: 500000 }));
    await send(proxy.connect(g).fundAppeal(local, 1, { value: 2n * cost, gasLimit: 500000 }));
    await send(proxy.connect(m).fundAppeal(local, 2, { value: cost, gasLimit: 500000 }));
    await warp(Math.floor(1.5 * DAY)); // past the losing side's deadline (half the period)
    await rejects(
      proxy.connect(crowd).fundAppeal.staticCall(local, 1, { value: 1n }),
      /Funding must be made within the appeal period/,
    );
    await warp(DAY);
    await rejects(
      proxy.connect(m).fundAppeal.staticCall(local, 2, { value: cost }),
      /Funding must be made within the appeal period/,
    );
    await send(liquid.passPeriod(id, KGAS));
    await send(liquid.executeRuling(id, KGAS));
    expect(await liquid.rounds(id)).to.equal(1n); // no new round
    expect(await liquid.currentRuling(id)).to.equal(2n); // the jurors voted "absent"...
    expect((await proxy.disputes(local)).ruling).to.equal(1n); // ...but only "attended" was funded: final ruling "attended"

    const e0 = await bal(g);
    await send(kick.connect(owner).resolveChallenge(g.address));
    expect(await kick.attended(g.address)).to.equal(true);
    expect(await bal(g)).to.equal(e0 + THIRD + FEE); // the share set aside and what is left of both challenge deposits
    expect(await kick.heldBack()).to.equal(0n);
    // no appeal took place, so the Dispute Resolver reimburses every funder in full, directly
    for (const [w, paid] of [
      [crowd, cost],
      [m, cost],
      [g, 2n * cost],
    ] as const) {
      const b0 = await bal(w);
      await send(proxy.connect(guests[151]!)[W_ALL](local, w.address, [1, 2], KGAS));
      expect(await bal(w)).to.equal(b0 + paid);
    }
    expect(await bal(kick)).to.equal(4n * D - 3n * THIRD);
  });

  it("appealStatus matches the Dispute Resolver's saturating maths when Kleros quotes a non-payable appeal", async function () {
    const { liquid } = ctx;
    const { kick, gs } = await h.listed([34, 37], 2);
    const g = gs[2]!;
    await send(kick.connect(g).challenge({ value: FEE }));
    await send(kick.matchChallenge(g.address, { value: FEE }));
    const { arbitratorDisputeID: id } = await kick.challenges(g.address);
    try {
      await send(liquid.setJurorsForCourtJump(3, KGAS)); // the General Court cannot grow further
      await send(liquid.startAppealPeriod(id, 1, DAY, KGAS));
      const N_: bigint = await liquid.NON_PAYABLE_AMOUNT();
      expect(await liquid.appealCost(id, EXTRA)).to.equal(N_);
      const mulCap = (a: bigint, b: bigint) => (a * b > MAX ? MAX : a * b);
      const addCap = (a: bigint, b: bigint) => (a + b > MAX ? MAX : a + b);
      const st = await kick.appealStatus(g.address);
      expect(st.costAttended).to.equal(addCap(N_, mulCap(N_, 10000n) / 10000n));
      expect(st.costAbsent).to.equal(addCap(N_, mulCap(N_, 20000n) / 10000n));
    } finally {
      await send(liquid.setJurorsForCourtJump(511, KGAS));
    }
  });

  // Several Kleros cases open at payout. Stakers: the first `listedCount` are on the list, then one matched
  // challenger per entry of `rulings`, the rest are no-shows. Settles the cases in `order` and checks after every
  // step that heldBack is the sum of the open cases' set-aside amounts, that the balance covers reserved(), and
  // that every attendee so far has received what each open case holds (pool money only, from Payout events).
  async function heldCases(slice: [number, number], listedCount: number, rulings: number[], order: number[]) {
    const { owner, liquid, guests } = ctx;
    const kick = await h.freshKick({ startIn: 1 });
    const gs = guests.slice(...slice);
    const all = await Promise.all(gs.map(addr));
    await Promise.all(gs.map((g) => send(g.sendTransaction({ to: kick.target as string, value: D })))); // different senders: in parallel
    await send(kick.registerStakers(all));
    await warp(2);
    await send(kick.postAttendance(all.slice(0, listedCount), (D * BigInt(gs.length)) / BigInt(listedCount)));
    const chs = all.slice(listedCount, listedCount + rulings.length);
    for (const [i, c] of chs.entries()) {
      await send(kick.connect(gs[listedCount + i]!).challenge({ value: FEE, gasLimit: 500000 }));
      await send(kick.matchChallenge(c, { value: FEE, gasLimit: 1_000_000 }));
    }
    await warp(DAY + 1);
    const from = await prov().getBlockNumber();
    const received = async () => {
      const got = new Map<string, bigint>(all.map((a) => [a, 0n]));
      for (const l of (await kick.queryFilter(kick.filters.Payout!(), from + 1)) as EventLog[])
        got.set(l.args.to, got.get(l.args.to)! + l.args.amount);
      return got;
    };
    const check = async () => {
      const held: bigint[] = await Promise.all(chs.map(async (c) => (await kick.challenges(c)).heldShare));
      expect(await kick.heldBack()).to.equal(held.reduce((x, y) => x + y, 0n));
      expect((await bal(kick)) >= (await kick.reserved())).to.equal(true);
      const got = await received();
      const paid = [...new Set(((await kick.attendees()) as string[]).map((a) => got.get(a)))];
      expect(paid.length, `attendees received different totals: ${paid}`).to.equal(1);
      for (const x of held) if (x > 0n) expect(x).to.equal(paid[0]); // a later winner gets exactly what attendees got
    };
    await send(kick.releasePayouts({ gasLimit: 3_000_000 }));
    await check();
    for (const i of order) {
      await send(liquid.giveFinalRuling((await kick.challenges(chs[i])).arbitratorDisputeID, rulings[i], KGAS));
      await send(kick.resolveChallenge(chs[i], { gasLimit: 3_000_000 }));
      await check();
    }
    expect(await kick.heldBack()).to.equal(0n);
    expect(await kick.challengeEscrow()).to.equal(0n);
    expect(await kick.reserved()).to.equal(0n);
    const got = await received();
    const atts: string[] = await kick.attendees();
    expect(atts.length).to.equal(listedCount + rulings.filter((r) => r === 1).length);
    const total = got.get(atts[0]!)!;
    const pool = D * BigInt(gs.length);
    const dust = await bal(kick);
    expect(total * BigInt(atts.length) + dust).to.equal(pool); // nothing lost: the pool is paid out, dust aside
    expect(dust < BigInt(atts.length) * 3n, `dust ${dust}`).to.equal(true);
    for (const c of chs) if (!atts.includes(c)) expect(got.get(c)).to.equal(0n); // lost cases get nothing
    await send(kick.sweep(owner.address)); // only the rounding dust is spare
    expect(await bal(kick)).to.equal(0n);
    return { total, got };
  }

  it("two Kleros cases open at payout (one won, one lost): every final attendee gets the same, in either settlement order", async function () {
    // 8 stakers; 5 on the list; A wins, B loses; 1 no-show. 8 / 7 leaves rounding dust
    const won = await heldCases([0, 8], 5, [1, 2], [0, 1]);
    const lost = await heldCases([0, 8], 5, [1, 2], [1, 0]);
    expect(won.total).to.equal(lost.total);
    const ideal = (8n * D) / 6n;
    expect(ideal - won.total <= 2n, `${won.total} vs ${ideal}`).to.equal(true); // 8 deposits / 6 attendees, less a few wei of rounding dust
  });

  it("three Kleros cases open at payout: every final attendee gets the same total whether the winner settles first, between or last", async function () {
    // 10 stakers; 4 on the list; A wins, B is ruled absent, C gets a refusal to arbitrate (0); 3 no-shows
    const totals: bigint[] = [];
    for (const order of [
      [0, 1, 2],
      [1, 0, 2],
      [2, 1, 0],
    ]) {
      totals.push((await heldCases([8, 18], 4, [1, 2, 0], order)).total);
    }
    const [lo, hi] = [totals.reduce((a, b) => (a < b ? a : b)), totals.reduce((a, b) => (a > b ? a : b))];
    expect(hi - lo <= 2n, `totals differ by more than rounding dust: ${totals}`).to.equal(true);
    expect(hi <= 2n * D && 2n * D - lo <= 5n, `${totals}`).to.equal(true); // 10 deposits / 5 attendees, less a few wei
  });

  it("a lost case's set-aside share is split among the attendees; a challenge waiting for a match still holds the payout", async function () {
    const { owner, liquid, guests } = ctx;
    const { kick, gs } = await h.listed([37, 41], 2); // 4 stakers, 2 on the list
    const [g, late] = [gs[2]!, gs[3]!];
    await send(kick.connect(g).challenge({ value: FEE }));
    await send(kick.matchChallenge(g.address, { value: FEE }));
    await warp(DAY - 60);
    await send(kick.connect(late).challenge({ value: FEE })); // last-minute challenge: its match window runs 1 more day
    await warp(120);
    await reverts(kick, "releasePayouts", [], "ChallengesPending");
    await warp(DAY);
    const watched = [gs[0]!, gs[1]!, late];
    const before = await Promise.all(watched.map(bal));
    const g0 = await bal(g);
    await send(kick.connect(guests[150]!).releasePayouts()); // late is accepted unmatched; g's case is open: 4 deposits / (3 + 1)
    const mid = await Promise.all(watched.map(bal));
    expect(mid.map((b, i) => b - before[i]!)).to.deep.equal([D, D, D + FEE]); // late also gets the challenge deposit back
    expect(await kick.payoutShare()).to.equal(D);
    expect(await kick.heldBack()).to.equal(D);
    expect(await kick.spare()).to.equal(0n); // the set-aside share and the case's challenge money cannot be swept or refunded
    await reverts(kick, "refund", [owner.address, 1n], "InsufficientBalance");
    await send(liquid.giveFinalRuling((await kick.challenges(g.address)).arbitratorDisputeID, 2, KGAS)); // jurors: absent
    await send(kick.connect(guests[150]!).resolveChallenge(g.address));
    const each = D / 3n;
    const end = await Promise.all(watched.map(bal));
    expect(end.map((b, i) => b - mid[i]!)).to.deep.equal([each, each, each]);
    expect(await bal(g)).to.equal(g0); // the challenger lost: nothing
    expect(await bal(kick)).to.equal(D - 3n * each); // rounding dust
    await reverts(kick.connect(late), "claim", [kick.target], "NothingToClaim");
  });
});
