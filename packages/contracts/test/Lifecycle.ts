import { expect } from "chai";
import hre from "hardhat";
import type { EIP1193Provider } from "viem";

import { HAND_LISTED, HAND_LISTED_STEPS, LIFECYCLE_STEPS, runLifecycle } from "../scripts/lifecycle";

describe("on-chain event lifecycle with MockKleros and hand-written lists", function () {
  it(`runs all ${LIFECYCLE_STEPS} steps with balances right to the wei`, async function () {
    const lines: string[] = [];
    const results = await runLifecycle({
      provider: hre.network.provider as unknown as EIP1193Provider,
      mode: "local",
      log: (line) => lines.push(line),
    });
    const failed = results.filter((r) => !r.ok);
    expect(failed, lines.join("\n")).to.deep.equal([]);
    expect(results.length, lines.join("\n")).to.equal(LIFECYCLE_STEPS);
    expect(lines).to.include(
      "On-chain lifecycle only: guest deposit verification, verification reruns and payout-plan generation are not exercised.",
    );
    expect([results[2]!.name, results[6]!.name, results[9]!.name]).to.deep.equal([
      "hand-listed: Deposited logs match the hand-written registration and refund lists",
      "hand-listed: registered statuses and Refunded events match the hand-written lists",
      "hand-listed: previewShare for the hand-written attendee list equals pool / 4",
    ]);
    // the guest and check-in lists of these steps are written in scripts/lifecycle.ts, not checked against a CSV
    expect(results.filter((r) => r.name.startsWith(HAND_LISTED)).map((r) => r.name)).to.have.length(HAND_LISTED_STEPS);
  });
});
