import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { task } from "hardhat/config";
import { getAddress, parseEther, type Address } from "viem";

import { createEvent, deployMockKleros, deployProtocol, localEventConfig, MIN_SETTLEMENT_WINDOW } from "../local";

export const SEPOLIA_JSON = path.join(__dirname, "..", "deployments-live", "sepolia.json");

/** deployments-live/sepolia.json: Kleros stand-ins (Sepolia has no Dispute Resolver), then the protocol on top. */
export type SepoliaDeployment = {
  chainId: number;
  name: string;
  explorer: string;
  currency: string;
  klerosLiquid: Address;
  disputeResolver: Address;
  subcourt: number;
  jurors: number;
  deployer: Address;
  factory?: Address;
  implementation?: Address;
  caseWriter?: Address;
  fromBlock?: number;
  policyURI?: string;
  sampleEvent?: Address;
};

type DeploySepoliaArgs = { force: boolean; event: boolean; testOnlyAllowHardhat: boolean; output: string };

task("deploy-sepolia", "Deploys Kleros stand-ins (if missing) and the Proof of Presence protocol on Sepolia")
  .addFlag("force", "Redeploy the Kleros stand-ins and the protocol even if the manifest has them")
  .addFlag("event", "Also create a sample event")
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
      throw new Error(`deploy-sepolia requires chainId 11155111; got ${chainId}`);
    }
    const [walletClient] = await hre.viem.getWalletClients();
    if (!walletClient) throw new Error("deploy-sepolia needs DEPLOYER_PRIVATE_KEY");
    const clients = { walletClient, publicClient };

    const existing: Partial<SepoliaDeployment> =
      existsSync(output) && !force ? JSON.parse(readFileSync(output, "utf8")) : {};
    if (existing.factory) throw new Error(`The protocol is already in ${output}; use --force to replace it`);
    const save = (d: SepoliaDeployment) => {
      mkdirSync(path.dirname(output), { recursive: true });
      writeFileSync(output, JSON.stringify(d, null, 2) + "\n");
    };

    const kleros =
      existing.klerosLiquid && existing.disputeResolver
        ? { arbitrator: existing.klerosLiquid, disputeResolver: existing.disputeResolver }
        : await deployMockKleros(clients);
    const d: SepoliaDeployment = {
      chainId,
      name: "Sepolia testnet",
      explorer: "https://sepolia.etherscan.io",
      currency: "SepoliaETH",
      klerosLiquid: getAddress(kleros.arbitrator),
      disputeResolver: getAddress(kleros.disputeResolver),
      subcourt: 0,
      jurors: 3,
      deployer: getAddress(walletClient.account.address),
    };
    // keep the stand-ins' addresses even if the protocol deploy fails
    save(d);

    const p = await deployProtocol(clients, {
      disputeResolver: d.disputeResolver,
      network: d.name,
      explorer: d.explorer,
    });
    Object.assign(d, {
      factory: p.factory,
      implementation: p.implementation,
      caseWriter: p.caseWriter,
      fromBlock: Number(p.deployBlock),
      policyURI: p.policyURI,
    });
    save(d);

    if (event) {
      const now = (await publicClient.getBlock({ blockTag: "latest" })).timestamp;
      const config = localEventConfig(now, {
        name: "Proof of Presence Sepolia test",
        url: "https://example.com/proof-of-presence-sepolia",
        depositAmount: parseEther("0.001"),
        startIn: 2n * 86_400n,
      });
      config.claimDeadline = config.eventEnd + BigInt(MIN_SETTLEMENT_WINDOW);
      d.sampleEvent = (await createEvent(clients, p.factory, config)).event;
      save(d);
    }
    console.log("Wrote %s", path.relative(process.cwd(), output));
    return d;
  });
