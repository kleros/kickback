import { expect } from "chai";
import hre from "hardhat";
import type { EIP1193Provider } from "viem";

import { LIFECYCLE_STEPS, runLifecycle } from "../../scripts/lifecycle";
import { skipUnlessForked } from "./forked";

describe("event lifecycle on a mainnet fork with Kleros's Dispute Resolver and KlerosLiquid", function () {
  before(function () {
    skipUnlessForked(this);
  });

  it(`runs all ${LIFECYCLE_STEPS} steps with balances right to the wei`, async function () {
    const lines: string[] = [];
    const results = await runLifecycle({
      provider: hre.network.provider as unknown as EIP1193Provider,
      mode: "fork",
      log: (line) => {
        lines.push(line);
        console.log(`      ${line}`);
      },
    });
    expect(
      results.filter((r) => !r.ok),
      lines.join("\n"),
    ).to.deep.equal([]);
    expect(results.length).to.equal(LIFECYCLE_STEPS);
  });
});
