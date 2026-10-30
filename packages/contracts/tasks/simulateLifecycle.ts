import { task } from "hardhat/config";
import type { EIP1193Provider } from "viem";

import { LIFECYCLE_STEPS, runLifecycle } from "../scripts/lifecycle";

task(
  "simulate-lifecycle",
  "Runs the 31-step event lifecycle against the connected node (MockKleros locally, mainnet Kleros on a fork), then reverts it",
).setAction(async (_args, hre) => {
  const mode = hre.network.name === "mainnet-fork" ? "fork" : "local";
  const results = await runLifecycle({
    provider: hre.network.provider as unknown as EIP1193Provider,
    mode,
    log: (line) => console.log(line),
  });
  const passed = results.filter((r) => r.ok).length;
  if (passed !== LIFECYCLE_STEPS) {
    process.exitCode = 1;
    throw new Error(`simulate-lifecycle: ${passed}/${LIFECYCLE_STEPS} steps passed`);
  }
});
