import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { task } from "hardhat/config";
import type { PublicClient } from "viem";

import { kickbackAbi } from "../generated/index";
import { deployLocalEvent, type LocalWalletClient } from "../local";

/** Accounts 1-4 deposit so the app has a few guests to show. */
export const SEEDED_GUESTS = 4;
export const LOCALHOST_JSON = path.join(__dirname, "..", "generated", "localhost.json");

export type LocalhostJson = {
  chainId: number;
  event: string;
  disputeResolver: string;
  arbitrator: string;
  deployBlock: number;
  owner: string;
};

/** Deploys one event owned by `owner`, has the first SEEDED_GUESTS `guests` deposit, and writes `file`. */
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
  log("TruthPaysKickback %s (block %d), owner %s", ev.event, Number(ev.deployBlock), ev.owner);
  log("Dispute Resolver %s, arbitrator %s", ev.disputeResolver, ev.arbitrator);

  const [depositAmount] = ev.args;
  for (const guest of guests.slice(0, SEEDED_GUESTS)) {
    const hash = await guest.writeContract({
      address: ev.event,
      abi: kickbackAbi,
      functionName: "deposit",
      value: depositAmount,
      chain: guest.chain ?? null,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    log("  deposit from %s: %s", guest.account.address, hash);
  }

  const out: LocalhostJson = {
    chainId: await publicClient.getChainId(),
    event: ev.event,
    disputeResolver: ev.disputeResolver,
    arbitrator: ev.arbitrator,
    deployBlock: Number(ev.deployBlock),
    owner: ev.owner,
  };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  log("Wrote %s", path.relative(process.cwd(), file));
  return out;
}

task("deploy-local", "Deploys MockKleros and one seeded Kickback event on the local node").setAction(
  async (_args, hre) => {
    const publicClient = await hre.viem.getPublicClient();
    const [owner, ...guests] = await hre.viem.getWalletClients();
    if (!owner) throw new Error(`deploy-local needs ${SEEDED_GUESTS + 1} accounts`);
    await deployAndSeed({
      publicClient,
      owner,
      guests,
      log: (...args) => console.log(...args),
    });
  },
);
