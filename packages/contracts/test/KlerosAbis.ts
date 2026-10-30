import { expect } from "chai";
import { toEventSelector, toFunctionSelector, type AbiEvent, type AbiFunction } from "viem";

import { disputeResolverAbi, disputeResolverEventLayouts, klerosLiquidAbi } from "../abis/kleros";

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
});
