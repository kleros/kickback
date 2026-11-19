import { deployLocalEvent } from "@kickback/contracts/local";
import { createPublicClient, createWalletClient, http } from "viem";
import { hardhat } from "viem/chains";

/** Hardhat's first account, unlocked on the local node (the node signs). */
const DEPLOYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

/** Deploys the Kleros mocks, the protocol and one event on a fresh local node: the suite's event. */
export async function deploySuiteEvent(nodeUrl: string) {
  const chain = { ...hardhat, rpcUrls: { default: { http: [nodeUrl] } } };
  const transport = http(nodeUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ chain, transport, account: DEPLOYER });
  const deployed = await deployLocalEvent({ publicClient, walletClient });
  return {
    event: deployed.event,
    eventStart: Number(deployed.config.eventStart),
    eventEnd: Number(deployed.config.eventEnd),
    claimDeadline: Number(deployed.config.claimDeadline),
  };
}
