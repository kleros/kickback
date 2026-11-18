import path from "node:path";

import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-viem";

import "./tasks/exportAbis";
import "./tasks/deployLocal";
import "./tasks/deploySepolia";
import { localNodeUrl } from "./tasks/localNode";

dotenv.config({ path: path.join(__dirname, "..", "..", ".env.mainnet-fork") });
dotenv.config({ path: path.join(__dirname, "..", "..", ".env.sepolia") });

const LOCAL_NODE_URL = localNodeUrl();

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
        // Solidity 0.8.28, optimizer 200, EVM paris: the settings the contracts are verified with on Etherscan
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
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      chainId: 11155111,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
    hardhat: {
      // the contract suite uses an owner, an organiser and 38 guests; the first 20 accounts are Hardhat's defaults
      accounts: { count: 40 },
      ...(forkMainnet && {
        chainId: 1,
        forking: {
          url: process.env.MAINNET_FORK_RPC_URL!,
          ...(process.env.MAINNET_FORK_BLOCK && { blockNumber: Number(process.env.MAINNET_FORK_BLOCK) }),
        },
      }),
    },
    localhost: {
      url: LOCAL_NODE_URL,
      chainId: 31337,
    },
    "mainnet-fork": {
      url: LOCAL_NODE_URL,
      chainId: 1,
      // a cold fork cache makes the first writes fetch remote state for minutes
      timeout: 600_000,
    },
  },
};

export default config;
