import path from "node:path";

import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-viem";

import "./tasks/exportAbis";
import "./tasks/deployLocal";
import "./tasks/simulateLifecycle";

dotenv.config({ path: path.join(__dirname, "..", "..", ".env.mainnet-fork") });

const forkMainnet = process.env.HARDHAT_FORK === "mainnet" && !!process.env.MAINNET_FORK_RPC_URL;

// `hardhat test` runs unforked without the URL so the fork suites can skip; a fork node must not start unforked
if (process.env.HARDHAT_FORK === "mainnet" && !forkMainnet && !process.argv.includes("test")) {
  throw new Error("HARDHAT_FORK=mainnet needs MAINNET_FORK_RPC_URL in .env.mainnet-fork at the repo root");
}

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.28",
        // the settings the live contract was verified with on Etherscan
        settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: { timeout: 600_000 },
  networks: {
    hardhat: {
      // the release-payouts gas cap test sends one transaction near EIP-7825's 2^24 limit
      blockGasLimit: 36_000_000,
      // the ported contract suite uses an owner and 159 guests; the first 20 accounts are Hardhat's defaults
      accounts: { count: 160 },
      ...(forkMainnet && {
        chainId: 1,
        forking: {
          url: process.env.MAINNET_FORK_RPC_URL!,
          ...(process.env.MAINNET_FORK_BLOCK && { blockNumber: Number(process.env.MAINNET_FORK_BLOCK) }),
        },
      }),
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    "mainnet-fork": {
      url: "http://127.0.0.1:8545",
      chainId: 1,
      // a cold fork cache makes the first writes fetch remote state for minutes
      timeout: 600_000,
    },
  },
};

export default config;
