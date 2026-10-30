import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { task } from "hardhat/config";
import { getAddress, parseEther, type Address, type Hex } from "viem";

import { DAY, deployLocalEvent, deployMockKleros } from "../local";

export const SEPOLIA_JSON = path.join(__dirname, "..", "deployments-live", "sepolia.json");

export type SepoliaDeployment = {
  chainId: number;
  klerosLiquid: Address;
  disputeResolver: Address;
  deployBlock: number;
  deployer: Address;
  txs: { klerosLiquid: Hex; disputeResolver: Hex };
  sampleEvent?: { address: Address; deployBlock: number; tx: Hex };
};

type DeploySepoliaArgs = {
  force: boolean;
  event: boolean;
  testOnlyAllowHardhat: boolean;
  output: string;
};

task("deploy-sepolia-kleros", "Deploys mock Kleros and Dispute Resolver on Sepolia")
  .addFlag("force", "Replace an existing deployment manifest")
  .addFlag("event", "Deploy a sample Kickback event with the generic template")
  .addFlag("testOnlyAllowHardhat", "Allow chain 31337 on the in-process Hardhat network for tests")
  .addOptionalParam("output", "Deployment manifest path", SEPOLIA_JSON)
  .setAction(async ({ force, event, testOnlyAllowHardhat, output }: DeploySepoliaArgs, hre) => {
    const publicClient = await hre.viem.getPublicClient();
    const chainId = await publicClient.getChainId();
    if (testOnlyAllowHardhat) {
      if (hre.network.name !== "hardhat" || chainId !== 31337)
        throw new Error("The test-only override requires the in-process Hardhat network (31337)");
      if (path.resolve(output) === path.resolve(SEPOLIA_JSON))
        throw new Error("The test-only override requires a separate output path");
    } else if (chainId !== 11155111) {
      throw new Error(`deploy-sepolia-kleros requires chainId 11155111; got ${chainId}`);
    }

    if (existsSync(output) && !force) {
      const existing = JSON.parse(readFileSync(output, "utf8"));
      if (existing.klerosLiquid || existing.disputeResolver || existing.sampleEvent)
        throw new Error(`Deployment addresses already exist in ${output}; use --force to replace them`);
    }

    const [walletClient] = await hre.viem.getWalletClients();
    if (!walletClient) throw new Error("deploy-sepolia-kleros needs DEPLOYER_PRIVATE_KEY");
    const clients = { walletClient, publicClient };
    // Sepolia has KlerosLiquid but no Dispute Resolver; both contracts here are mocks.
    const mocks = await deployMockKleros(clients);
    const deployment: SepoliaDeployment = {
      chainId,
      klerosLiquid: mocks.arbitrator,
      disputeResolver: mocks.disputeResolver,
      deployBlock: Number(mocks.receipts.arbitrator.blockNumber),
      deployer: getAddress(walletClient.account.address),
      txs: {
        klerosLiquid: mocks.receipts.arbitrator.transactionHash,
        disputeResolver: mocks.receipts.disputeResolver.transactionHash,
      },
    };
    const save = () => {
      mkdirSync(path.dirname(output), { recursive: true });
      writeFileSync(output, JSON.stringify(deployment, null, 2) + "\n");
    };
    // Persist the mocks before the optional event so an event failure does not lose their addresses.
    save();

    if (event) {
      const now = (await publicClient.getBlock({ blockTag: "latest" })).timestamp;
      const eventStart = now + BigInt(2 * DAY);
      const sample = await deployLocalEvent({
        ...clients,
        disputeResolver: mocks.disputeResolver,
        depositAmount: parseEther("0.001"),
        eventStart,
        claimDeadline: eventStart + BigInt(7 * DAY),
        explorer: "https://sepolia.etherscan.io",
        details: {
          eventTitle: "Kickback Sepolia test event",
          eventName: "Kickback Sepolia",
          eventWhere: "Sepolia test venue",
          hosts: "Kickback test stack",
          eventLink: "https://example.com/kickback-sepolia",
        },
      });
      deployment.sampleEvent = {
        address: sample.event,
        deployBlock: Number(sample.deployBlock),
        tx: sample.receipt.transactionHash,
      };
      save();
    }
    console.log("Wrote %s", path.relative(process.cwd(), output));
    return deployment;
  });
