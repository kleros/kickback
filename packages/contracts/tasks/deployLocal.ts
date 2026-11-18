import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { task } from "hardhat/config";
import type { Address, PublicClient } from "viem";

import { presenceEventAbi } from "../generated/index";
import { deployLocalEvent, type LocalWalletClient } from "../local";

/** Accounts 1-4 deposit so the app has a few guests to show. */
export const SEEDED_GUESTS = 4;
export const LOCALHOST_JSON = path.join(__dirname, "..", "generated", "localhost.json");

/** The local protocol and its seeded event, in the shape of deployments-live/<network>.json plus the event. */
export type LocalhostJson = {
  chainId: number;
  factory: Address;
  implementation: Address;
  caseWriter: Address;
  fromBlock: number;
  policyURI: string;
  disputeResolver: Address;
  arbitrator: Address;
  subcourt: number;
  jurors: number;
  event: Address;
  organiser: Address;
};

/** Deploys the Kleros mocks, the protocol and one event organised by `owner`; the first SEEDED_GUESTS `guests` book. */
export async function deployAndSeed({
  publicClient,
  owner,
  guests,
  file = LOCALHOST_JSON,
  log = () => {},
}: {
  publicClient: PublicClient;
  owner: LocalWalletClient;
  guests: LocalWalletClient[];
  file?: string;
  log?: (...args: unknown[]) => void;
}): Promise<LocalhostJson> {
  if (guests.length < SEEDED_GUESTS) throw new Error(`deploy-local needs ${SEEDED_GUESTS + 1} accounts`);

  const ev = await deployLocalEvent({ walletClient: owner, publicClient });
  const { kleros, protocol } = ev;
  log("PresenceFactory %s (block %d)", ev.factory, Number(protocol!.deployBlock));
  log("Dispute Resolver %s, arbitrator %s", kleros!.disputeResolver, kleros!.arbitrator);
  log("PresenceEvent %s, organiser %s", ev.event, ev.organiser);

  for (const guest of guests.slice(0, SEEDED_GUESTS)) {
    const hash = await guest.writeContract({
      address: ev.event,
      abi: presenceEventAbi,
      functionName: "deposit",
      value: ev.config.depositAmount,
      chain: guest.chain ?? null,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    log("  deposit from %s: %s", guest.account.address, hash);
  }

  const out: LocalhostJson = {
    chainId: await publicClient.getChainId(),
    factory: ev.factory,
    implementation: protocol!.implementation,
    caseWriter: protocol!.caseWriter,
    fromBlock: Number(protocol!.deployBlock),
    policyURI: protocol!.policyURI,
    disputeResolver: kleros!.disputeResolver,
    arbitrator: kleros!.arbitrator,
    subcourt: 0,
    jurors: 3,
    event: ev.event,
    organiser: ev.organiser,
  };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  log("Wrote %s", path.relative(process.cwd(), file));
  return out;
}

task("deploy-local", "Deploys the Kleros mocks, the protocol and one seeded event on the local node").setAction(
  async (_args, hre) => {
    const publicClient = await hre.viem.getPublicClient();
    const [owner, ...guests] = await hre.viem.getWalletClients();
    if (!owner) throw new Error(`deploy-local needs ${SEEDED_GUESTS + 1} accounts`);
    await deployAndSeed({ publicClient, owner, guests, log: (...args) => console.log(...args) });
  },
);
