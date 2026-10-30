import { task } from "hardhat/config";
import type { EIP1193Provider } from "viem";

import { HAND_LISTED, LIFECYCLE_STEPS, runLifecycle } from "../scripts/lifecycle";

task(
  "simulate-lifecycle",
  "Runs the 31-step on-chain lifecycle with hand-written lists (MockKleros locally, mainnet Kleros on a fork), then reverts it",
).setAction(async (_args, hre) => {
  const mode = hre.network.name === "mainnet-fork" ? "fork" : "local";
  const results = await runLifecycle({
    provider: hre.network.provider as unknown as EIP1193Provider,
    mode,
    log: (line) => console.log(line),
  });
  const passed = results.filter((r) => r.ok).length;
  const handListed = results.filter((r) => r.name.startsWith(HAND_LISTED)).length;
  console.log("%d of the steps check hand-written guest and check-in lists, not a Luma or check-in CSV", handListed);
  if (passed !== LIFECYCLE_STEPS) {
    process.exitCode = 1;
    throw new Error(`simulate-lifecycle: ${passed}/${LIFECYCLE_STEPS} steps passed`);
  }
});
