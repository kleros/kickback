import hre from "hardhat";
import type { HardhatNetworkConfig } from "hardhat/types";

/** True when the in-process network forks mainnet (HARDHAT_FORK=mainnet with MAINNET_FORK_RPC_URL set). */
export const forkedMainnet = () =>
  hre.network.name === "hardhat" && !!(hre.network.config as HardhatNetworkConfig).forking?.enabled;

export function skipUnlessForked(ctx: Mocha.Context) {
  if (!forkedMainnet()) {
    console.log("      skipped: needs HARDHAT_FORK=mainnet and MAINNET_FORK_RPC_URL in .env.mainnet-fork");
    ctx.skip();
  }
}
