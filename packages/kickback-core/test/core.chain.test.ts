// On a local chain: a contract deployed from the new-event form with the generic template is read back by readEvent,
// its case descriptions are the core's (same IPFS path as the contract's caseMetaEvidence), and checkGuests,
// depositsOverview and buildPayout give the lists the organiser acts on, which the contract then accepts.
import { parseEther, zeroHash, type Address } from "viem";
import { expect, test } from "vitest";

import * as core from "../src";

import { chainKit } from "./chain";
import { read } from "./docs";

const E = (x: string | number) => parseEther(String(x));
const DAY = 86400;
const GENERIC_TEXT = read(core.GENERIC_METAEVIDENCE_TEMPLATE);
const GENERIC_POLICY_PATH = core.ipfsPathOf(read(core.GENERIC_POLICY));
const FORM = {
  eventTitle: 'Onchain Justice Night: Talks & "Dinner"',
  eventName: "Onchain Justice Night, Berlin 2027",
  eventWhen: "Friday 12 March 2027, 19:00-23:00 CET",
  eventWhere: "Café Example, Main Street 1, Berlin",
  hosts: "Kleros and friends",
  eventLink: "https://luma.com/your-event",
  deposit: "0.01",
};

test(
  "checkGuests, depositsOverview and buildPayout on a contract made from the new-event form",
  { timeout: 120_000 },
  async () => {
    const k = chainKit();
    const { client } = k;
    // owner, ana, ben, cai, dan, eve, gus, sid, pat
    const [OWNER, ANA, BEN, CAI, DAN, EVE, GUS, SID, PAT] = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
    const me = k.addr(OWNER);
    const { liquid, proxy } = await k.mocks();

    // the organiser fills in the form; the contract is deployed with the core's constructor arguments and the generic template
    const t0 = await k.now();
    const network: core.NetworkInput = {
      chainId: 31337,
      rpcUrl: k.rpcUrl,
      explorer: "https://etherscan.io",
      logChunk: 7,
      kleros: { disputeResolver: proxy, arbitrator: liquid, policyURI: GENERIC_POLICY_PATH },
    };
    const newCfg = core.newEventConfig(
      { ...FORM, eventStart: new Date((t0 + 3600) * 1000).toISOString() },
      network,
      me,
    );
    const kick = await k.deployKickback(core.deployArgs(newCfg, me, GENERIC_TEXT));
    const deployBlock = Number(await client.getBlockNumber());

    // everything about the event, read back on-chain
    const ev = await core.readEvent(client, kick.toLowerCase());
    expect([ev.contract, ev.eventName, ev.depositAmount, ev.eventStart, ev.claimDeadline, ev.owner, ev.disputeResolver, ev.arbitrator, ev.policyURI, ev.phase]).toEqual([
    kick, FORM.eventName, E("0.01"), t0 + 3600, t0 + 3600 + 14 * DAY, me, proxy, liquid, GENERIC_POLICY_PATH, 0,
  ]); // prettier-ignore
    expect(core.isKnownResolver(31337, ev.disputeResolver)).toBe(false); // a page warns: not Kleros's own Dispute Resolver
    expect(core.isKnownResolver(1, core.KLEROS[1]!.disputeResolver.toUpperCase().replace("0X", "0x"))).toBe(true);
    // the contract's case description and its IPFS path are the core's
    const [caseText, caseUri] = await k.read<[string, string]>(kick, "caseMetaEvidence", [k.addr(ANA)]);
    expect(caseText).toBe(core.renderCase(ev.metaEvidenceTemplate, k.addr(ANA), kick));
    expect(caseUri).toBe(core.ipfsPathOf(caseText));
    expect(caseUri).toBe(`/ipfs/${core.ipfsCidV0(caseText)}`);
    expect(JSON.parse(caseText).description).toContain(FORM.eventWhere);
    await expect(core.readEvent(client, k.addr(EVE))).rejects.toMatchObject({
      code: "NO_KICKBACK_CONTRACT",
      message: expect.stringMatching(/no contract at/),
    });
    await expect(core.readEvent(client, liquid)).rejects.toMatchObject({
      code: "NOT_KICKBACK",
      message: expect.stringMatching(/not a kickback deposit contract/),
    });
    await expect(core.readEvent(client, "0x1234")).rejects.toMatchObject({ code: "NOT_KICKBACK" });
    // its code is the live build's, but for the constructor's values (zeroed): answers alone can be faked
    const runtime = core.KICKBACK_RUNTIME;
    expect(runtime.immutables.length > 0 && /^0x[0-9a-f]{64}$/.test(runtime.sha256)).toBe(true);
    const code = await client.getCode({ address: kick });
    expect(core.codeFingerprint(code, runtime.immutables)).toBe(runtime.sha256);
    expect(core.codeFingerprint(code)).not.toBe(runtime.sha256); // the immutables do differ from the compiled code's zeros
    expect(await core.readEvent(client, kick, { runtime: null })).toEqual(ev);
    await expect(core.readEvent(client, kick, { runtime: { ...runtime, sha256: zeroHash } })).rejects.toMatchObject({
      code: "UNKNOWN_CODE",
      message: expect.stringMatching(/answers like a kickback deposit contract, but its code is not/),
    });
    await expect(core.readEvent(client, liquid, { runtime })).rejects.toMatchObject({ code: "NOT_KICKBACK" });
    // the deploy block, found by binary search over past states and confirmed by the creation transaction
    expect(await core.findDeployBlock(client, kick)).toBe(deployBlock);
    expect(await core.checkDeployBlock(client, kick, deployBlock)).toEqual({ confirmed: true });
    await expect(core.checkDeployBlock(client, kick, deployBlock + 1)).rejects.toMatchObject({
      code: "DEPLOY_BLOCK_TOO_LATE",
    });
    expect(await core.checkDeployBlock(client, kick, deployBlock - 1)).toEqual({ confirmed: false });
    await expect(core.findDeployBlock(client, k.addr(EVE))).rejects.toMatchObject({ code: "DEPLOY_BLOCK_NOT_FOUND" });

    const cfg = core.contractConfig(ev, network, deployBlock);
    expect(await core.depositsOverview({ client, cfg, scanFrom: deployBlock })).toEqual({
      deposits: [],
      returns: [],
      check: null,
    }); // no deposit yet
    expect(cfg.receiver).toBe(kick);
    expect(cfg.depositUnits).toBe(E("0.01"));
    await expect(
      core.checkContract(client, { ...cfg, depositUnits: E("0.02"), deposit: "0.02" }),
    ).rejects.toMatchObject({
      code: "DEPOSIT_MISMATCH",
      depositAmount: E("0.01"),
    });

    // guests pay: approved, declined, waiting, overpaid, short, a stray nobody claims, a copied tx link
    const pay = (i: number, eth: string) => k.pay(i, kick, E(eth));
    const tx = {
      ana: await pay(ANA, "0.01"),
      ben: await pay(BEN, "0.01"),
      cai: await pay(CAI, "0.015"),
      dan: await pay(DAN, "0.01"),
      eve: await pay(EVE, "0.005"),
      pat: await pay(PAT, "0.01"),
    };
    await pay(SID, "0.01"); // a stray: nobody pastes it
    const H = "name,email,ticket_name,approval_status,checked_in_at,eth_address,Deposit tx link (Committed Spot only)";
    const T = "Committed Spot (0.01 ETH)";
    const row = (name: string, w: number | null, status: string, txLink: string, checkedIn = "") =>
      `${name},${name.toLowerCase()}@x.io,${T},${status},${checkedIn},${w === null ? "" : k.addr(w)},${txLink}`;
    const lines = (checked: Record<string, string> = {}) => [
      row("Ana", ANA, "approved", `https://etherscan.io/tx/${tx.ana}`, checked.Ana),
      row("Ben", BEN, "declined", tx.ben),
      row("Cai", CAI, "approved", `"see ${tx.cai}, thanks"`, checked.Cai),
      row("Dan", null, "approved", tx.dan, checked.Dan), // wallet taken from the sender
      row("Eve", EVE, "approved", tx.eve),
      row("Gus", GUS, "approved", tx.ana), // a copy of Ana's link
      row("Pat", PAT, "pending_approval", tx.pat),
      `Hal,hal@x.io,Request to Join (Free),approved,${checked.Hal ?? ""},,`,
      `=Mal,"mal@x.io",${T},approved,,,not sure`,
    ];
    const guestsCsv = "﻿" + [H, ...lines()].join("\r\n") + "\r\n";

    const check = async () => {
      const info: string[] = [];
      const warnings: string[] = [];
      const r = await core.checkGuests({
        client,
        cfg,
        rows: core.parseCsv(guestsCsv),
        scanFrom: cfg.deployBlock,
        log: { info: (m) => info.push(m), warn: (m) => warnings.push(m) },
      });
      expect(warnings).toEqual(r.warnings);
      expect(info[0]).toMatch(/^Columns used: /);
      // every list writes as CSV with its columns
      for (const key of ["verified", "issues", "toReview", "returns", "claims", "unmatched"] as const)
        expect(core.parseCsv(core.toCsv(r[key], core.CHECK_COLUMNS[key]))).toHaveLength(r[key].length);
      return r;
    };
    let r = await check();
    const wallets = (list: core.StampedList) => list.items.map((i) => i.wallet);
    expect(wallets(r.lists.newStakers)).toEqual([k.addr(ANA), k.addr(CAI), k.addr(DAN)]);
    expect(wallets(r.lists.refunds)).toEqual([k.addr(BEN)]);
    expect(r.lists.newStakers).toMatchObject({
      contract: kick,
      chainId: 31337,
      deposit: E("0.01").toString(),
      block: r.snapshotBlock,
    });
    expect(r.toReview.map((v) => v.name)).toEqual(["Pat"]);
    expect(r.returns.map((x) => [x.name, x.code, x.to_return])).toEqual([
      ["Cai", "OVERPAID", "0.005"],
      ["Eve", "AMOUNT_TOO_LOW", "0.005"],
    ]);
    expect(r.issueCounts).toEqual({ BAD_TX_HASH: 1, DUPLICATE_TX: 1, AMOUNT_TOO_LOW: 1, OVERPAID: 1 });
    expect(r.openUnmatched.map((u) => u.from)).toEqual([k.addr(SID)]);
    expect(r.held).toHaveLength(5);

    // a page's Deposits table, with no Luma export: every deposit, checked by the same rules
    const people: Record<string, number> = { Ana: ANA, Ben: BEN, Cai: CAI, Dan: DAN, Eve: EVE, Pat: PAT, Sid: SID };
    const nameOf = new Map(Object.entries(people).map(([n, w]) => [k.addr(w), n]));
    const overview = async () => {
      const o = await core.depositsOverview({ client, cfg, scanFrom: cfg.deployBlock });
      return {
        ...o,
        rows: o.deposits.map((d) => [
          nameOf.get(d.from),
          d.status,
          core.fmt(d.held),
          d.code,
          d.canRegister,
          d.canRefund,
        ]),
      };
    };
    let o = await overview();
    expect(o.rows).toEqual([
    ["Ana", "unregistered", "0.01", "VERIFIED", true, true], ["Ben", "unregistered", "0.01", "VERIFIED", true, true],
    ["Cai", "unregistered", "0.015", "VERIFIED", true, true], ["Dan", "unregistered", "0.01", "VERIFIED", true, true],
    ["Eve", "unregistered", "0.005", "AMOUNT_TOO_LOW", false, false], ["Pat", "unregistered", "0.01", "VERIFIED", true, true],
    ["Sid", "unregistered", "0.01", "VERIFIED", true, true],
  ]); // prettier-ignore
    expect(o.returns.map((x) => [nameOf.get(x.wallet as Address), x.code, x.to_return])).toEqual([
      ["Cai", "OVERPAID", "0.005"],
      ["Eve", "AMOUNT_TOO_LOW", "0.005"],
    ]);
    const first = o.deposits[0]!;
    const firstBlock = await client.getBlock({ blockNumber: BigInt(first.block) });
    expect([first.tx, first.amount, first.explorer, first.sentAt]).toEqual([
      tx.ana,
      E("0.01"),
      `https://etherscan.io/tx/${tx.ana}`,
      new Date(Number(firstBlock.timestamp) * 1000).toISOString(),
    ]);
    expect(o.deposits[2]!.note).toMatch(/overpaid by 0\.005 ETH/);
    expect([o.check!.unmatched, o.check!.warnings]).toEqual([[], []]);

    // the organiser registers and refunds from the lists, and checks again: nothing left to do
    await k.kick(kick, OWNER, "registerStakers", [wallets(r.lists.newStakers)]);
    await k.kick(kick, OWNER, "rejectAndRefund", [wallets(r.lists.refunds)]);
    r = await check();
    expect([r.lists.newStakers.items.length, r.lists.refunds.items.length]).toEqual([0, 0]);
    expect(r.verified.map((v) => [v.name, v.onchain])).toEqual([
    ["Ana", "registered"], ["Ben", "refunded"], ["Cai", "registered"], ["Dan", "registered"], ["Pat", "unregistered"],
  ]); // prettier-ignore
    o = await overview();
    expect(o.rows).toEqual([
    ["Ana", "registered", "0.01", "VERIFIED", false, true], ["Ben", "refunded", "0.0", "VERIFIED", false, false],
    ["Cai", "registered", "0.015", "VERIFIED", false, true], ["Dan", "registered", "0.01", "VERIFIED", false, true],
    ["Eve", "unregistered", "0.005", "AMOUNT_TOO_LOW", false, false], ["Pat", "unregistered", "0.01", "VERIFIED", true, true],
    ["Sid", "unregistered", "0.01", "VERIFIED", true, true],
  ]); // prettier-ignore
    // whether a whole deposit of each payment is still held for a spot (staked, or not returned)
    expect(o.deposits.map((d) => [nameOf.get(d.from), d.heldForSpot])).toEqual([
    ["Ana", true], ["Ben", false], ["Cai", true], ["Dan", true], ["Eve", false], ["Pat", true], ["Sid", true],
  ]); // prettier-ignore
    // Ben, refunded, pays again: the new deposit can be registered (the contract accepts a refunded wallet)
    const benAgain = await pay(BEN, "0.01");
    o = await overview();
    const benNew = o.deposits.find((d) => d.tx === benAgain)!;
    expect([benNew.status, benNew.code, benNew.heldForSpot, benNew.canRegister, benNew.canRefund]).toEqual([
      "refunded, paid again",
      "VERIFIED",
      true,
      true,
      false,
    ]);

    // after the event: Ana checked in on Luma, Cai is on the door list, Dan did not come
    await k.warp(3600 + 600);
    // a late payment: "unregistered" whatever happens to it, so only heldForSpot says whether it is still there
    const gusLate = await pay(GUS, "0.01");
    const gusRow = async () =>
      (await core.depositsOverview({ client, cfg, scanFrom: cfg.deployBlock })).deposits.find((d) => d.tx === gusLate)!;
    let g = await gusRow();
    expect([g.status, g.code, g.heldForSpot, g.canRegister]).toEqual(["unregistered", "OUTSIDE_WINDOW", true, false]);
    await k.kick(kick, OWNER, "refund", [k.addr(GUS), E("0.01")]); // returned with "Return a stray transfer"
    g = await gusRow();
    expect([g.status, g.held, g.heldForSpot]).toEqual(["unregistered", 0n, false]);
    const afterCsv = [H, ...lines({ Ana: "2027-03-12T19:30:00.000Z", Hal: "2027-03-12T19:40:00.000Z" })].join("\n");
    const doorCsv = "email,note\ncai@x.io,came late\nnobody@x.io,\n";
    const p = await core.buildPayout({
      client,
      cfg,
      checkins: core.parseCsv(afterCsv),
      verified: r.verified,
      claims: r.claims,
      extra: core.parseCsv(doorCsv),
      extraName: "door.csv",
    });
    expect(p.door).toEqual({ rows: 2, unmatched: [{ email: "nobody@x.io", wallet: null }] });
    expect([p.plan.attendees, p.plan.share, p.unknown]).toEqual([
      [k.addr(ANA), k.addr(CAI)],
      E("0.015").toString(),
      [],
    ]);
    expect(p.plan).toEqual({
      contract: kick,
      chainId: 31337,
      stakers: 3,
      attendees: [k.addr(ANA), k.addr(CAI)],
      share: E("0.015").toString(),
      shareEth: "0.015",
    });
    expect(core.toCsv(p.payoutRows, core.PAYOUT_COLUMNS)).toBe(
      "name,email,wallet,attended,payout\n" +
        `Ana,ana@x.io,${k.addr(ANA)},yes,0.015\nCai,cai@x.io,${k.addr(CAI)},yes,0.015\nDan,dan@x.io,${k.addr(DAN)},no,0\n`,
    );
    expect(p.summaryMarkdown).toBe(`# Truth Pays: deposit settlement

| | |
|---|---|
| Stakers | 3 |
| Showed up | 2 |
| No-shows | 1 |
| Pool | 0.03 ETH |
| Payout per attendee (if nobody is added by a challenge) | 0.015 ETH (deposit 0.01 ETH + 0.005 ETH bonus) |
| Rounding dust | 0.0 ETH |
| Contract | https://etherscan.io/address/${kick} |
`);
    // a heading for any event
    const titled = await core.buildPayout({
      client,
      cfg,
      checkins: core.parseCsv(afterCsv),
      verified: r.verified,
      claims: r.claims,
      title: ev.eventName,
    });
    expect(titled.summaryMarkdown).toMatch(/^# Onchain Justice Night, Berlin 2027: deposit settlement/);
    expect(titled.plan.attendees).toEqual([k.addr(ANA)]); // without the door list Cai is a no-show
    // a registered staker no verified registration names is reported, for the caller to decide
    const lost = await core.buildPayout({
      client,
      cfg,
      checkins: core.parseCsv(afterCsv),
      verified: r.verified.filter((v) => v.name !== "Dan"),
      claims: [],
    });
    expect(lost.unknown).toEqual([k.addr(DAN)]);
    expect(lost.unknownNote).toMatch(/^1 registered stakers have no Luma registration that verified their wallet/);
    // a door list with a wallet column alone (no Luma export)
    const doorOnly = await core.buildPayout({
      client,
      cfg,
      checkins: null,
      extra: core.parseCsv(`wallet\n${k.addr(ANA)}\n${k.addr(CAI)}\n`),
      extraName: "door.csv",
    });
    expect([doorOnly.plan.attendees, doorOnly.plan.share, doorOnly.plan.stakers]).toEqual([
      [k.addr(ANA), k.addr(CAI)],
      E("0.015").toString(),
      3,
    ]);
    expect(doorOnly.unknown).toEqual([k.addr(ANA), k.addr(CAI), k.addr(DAN)]); // nobody verified: the caller decides about Dan
    await expect(core.buildPayout({ client, cfg, checkins: null })).rejects.toThrow(
      /Give the Luma export after the event, a door list, or both/,
    );

    // the plan is what the contract accepts: post it, wait out the challenge window, pay
    await k.kick(kick, OWNER, "postAttendance", [p.plan.attendees, BigInt(p.plan.share)]);
    // once the list is posted: nobody can be registered or have their stake refunded; an unregistered payer still can
    o = await overview();
    expect(o.rows.filter((x) => ["Ana", "Pat"].includes(x[0] as string))).toEqual([
      ["Ana", "registered", "0.01", "VERIFIED", false, false],
      ["Pat", "unregistered", "0.01", "VERIFIED", false, true],
    ]);
    await k.warp(core.CHALLENGE_PERIOD + 60);
    const before = await Promise.all([ANA, CAI, DAN].map((w) => k.balance(k.addr(w))));
    await k.kick(kick, OWNER, "releasePayouts");
    const after = await Promise.all([ANA, CAI, DAN].map((w) => k.balance(k.addr(w))));
    expect(after.map((x, i) => x - before[i]!)).toEqual([E("0.015"), E("0.015"), 0n]);
  },
);
