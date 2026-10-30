import { expect } from "chai";
import hre from "hardhat";
import {
  getAddress,
  parseEther,
  parseEventLogs,
  toEventSelector,
  toFunctionSelector,
  type AbiEvent,
  type AbiFunction,
} from "viem";

import { disputeResolverAbi, disputeResolverEventLayouts, klerosLiquidAbi } from "../abis/kleros";
import { mockArbitrableProxyAbi, mockKlerosLiquidAbi } from "../generated/index";
import { DAY, deployMockKleros, klerosExtraData } from "../local";

const selectors = (abi: readonly (AbiFunction | AbiEvent)[]) =>
  Object.fromEntries(
    abi.map((item) => [item.name, item.type === "function" ? toFunctionSelector(item) : toEventSelector(item)]),
  );

// The selectors and topics the legacy guest page hard-codes (site/index.html PSEL, KSEL, TOPIC).
describe("Kleros ABIs", function () {
  it("KlerosLiquid fragments have the selectors the legacy page calls", function () {
    const s = selectors(klerosLiquidAbi);
    expect(s).to.include({
      disputes: "0x564a565d",
      currentRuling: "0x1c3db16d",
      passPeriod: "0x115d5376",
      executeRuling: "0x8bb04875",
      appealCost: "0xf23f16e6",
    });
    expect(Object.keys(s)).to.have.members([
      "arbitrationCost",
      "appealCost",
      "appealPeriod",
      "currentRuling",
      "disputes",
      "passPeriod",
      "executeRuling",
    ]);
  });

  it("Dispute Resolver fragments have the selectors and topics the legacy page uses", function () {
    expect(selectors(disputeResolverAbi)).to.include({
      submitEvidence: "0xa6a7f0eb",
      fundAppeal: "0x4b2f0ea0",
      withdrawFeesAndRewardsForAllRounds: "0x0e274e4c",
      getTotalWithdrawableAmount: "0xc25516e9",
      disputes: "0x564a565d",
      disputeIDtoRoundArray: "0x3ef40ba7",
      getMultipliers: "0x79873f8a",
      Contribution: "0xcae597f39a3ad75c2e10d46b031f023c5c2babcd58ca0491b122acda3968d4c0",
      RulingFunded: "0x39493c1b78d9a13bcc9e1d532fc7faed3889248d93affa811416ce3c6bcb1a68",
    });
  });

  it("every event layout keeps the topic and indexes as many fields as its key says, less one", function () {
    for (const [name, layouts] of Object.entries(disputeResolverEventLayouts)) {
      const topic = selectors(disputeResolverAbi)[name];
      for (const [topics, event] of Object.entries(layouts)) {
        expect(toEventSelector(event)).to.equal(topic);
        expect(event.inputs.filter((i) => i.indexed).length + 1).to.equal(Number(topics));
      }
    }
  });

  it("decodes the Contribution and RulingFunded logs the mock Dispute Resolver emits", async function () {
    const publicClient = await hre.viem.getPublicClient();
    const [deployer, funder] = await hre.viem.getWalletClients();
    const { arbitrator, disputeResolver } = await deployMockKleros({ walletClient: deployer!, publicClient });
    const extra = klerosExtraData();
    const wait = async (hash: `0x${string}`) => publicClient.waitForTransactionReceipt({ hash });
    const fee = await publicClient.readContract({
      address: arbitrator,
      abi: klerosLiquidAbi,
      functionName: "arbitrationCost",
      args: [extra],
    });
    await wait(
      await deployer!.writeContract({
        address: disputeResolver,
        abi: mockArbitrableProxyAbi,
        functionName: "createDispute",
        args: [extra, "/ipfs/meta", 2n],
        value: fee,
      }),
    );
    const local = 0n;
    const id = await publicClient.readContract({
      address: disputeResolver,
      abi: disputeResolverAbi,
      functionName: "disputes",
      args: [local],
    });
    const disputeID = id[3];
    await wait(
      await deployer!.writeContract({
        address: arbitrator,
        abi: mockKlerosLiquidAbi,
        functionName: "startAppealPeriod",
        args: [disputeID, 2n, BigInt(3 * DAY)],
      }),
    );
    const cost = await publicClient.readContract({
      address: arbitrator,
      abi: klerosLiquidAbi,
      functionName: "appealCost",
      args: [disputeID, extra],
    });
    // ruling 1 lost the vote: the loser stake multiplier (2x) is added to the appeal cost
    const total = 3n * cost;
    const receipt = await wait(
      await funder!.writeContract({
        address: disputeResolver,
        abi: disputeResolverAbi,
        functionName: "fundAppeal",
        args: [local, 1n],
        value: parseEther("1"),
      }),
    );
    const logs = parseEventLogs({ abi: disputeResolverAbi, logs: receipt.logs, strict: true });
    const contribution = logs.find((l) => l.eventName === "Contribution");
    const funded = logs.find((l) => l.eventName === "RulingFunded");
    expect(contribution?.args).to.deep.equal({
      localDisputeID: local,
      round: 0n,
      ruling: 1n,
      contributor: getAddress(funder!.account.address),
      amount: total,
    });
    expect(funded?.args).to.deep.equal({ localDisputeID: local, round: 0n, ruling: 1n });
    // the 4-topic layouts are the exported ABI's own indexing
    for (const [name, log] of [
      ["Contribution", contribution!],
      ["RulingFunded", funded!],
    ] as const) {
      expect(log.topics.length).to.equal(4);
      const [again] = parseEventLogs({ abi: [disputeResolverEventLayouts[name][4]], logs: [log], strict: true });
      expect(again?.args).to.deep.equal(log.args);
    }
  });
});
