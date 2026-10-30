import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { task } from "hardhat/config";

import { kickbackAbi } from "../generated/index";
import { deployLocalEvent } from "../local";

/** Accounts 1-4 deposit so the app has a few guests to show. */
const SEEDED_GUESTS = 4;

task("deploy-local", "Deploys MockKleros and one seeded Kickback event on the local node").setAction(
  async (_args, hre) => {
    const publicClient = await hre.viem.getPublicClient();
    const [owner, ...guests] = await hre.viem.getWalletClients();
    if (!owner || guests.length < SEEDED_GUESTS) throw new Error(`deploy-local needs ${SEEDED_GUESTS + 1} accounts`);

    const ev = await deployLocalEvent({ walletClient: owner, publicClient });
    console.log("TruthPaysKickback %s (block %d), owner %s", ev.event, Number(ev.deployBlock), ev.owner);
    console.log("Dispute Resolver %s, arbitrator %s", ev.disputeResolver, ev.arbitrator);

    const [depositAmount] = ev.args;
    for (const guest of guests.slice(0, SEEDED_GUESTS)) {
      const hash = await guest.writeContract({
        address: ev.event,
        abi: kickbackAbi,
        functionName: "deposit",
        value: depositAmount,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log("  deposit from %s: %s", guest.account.address, hash);
    }

    const chainId = await publicClient.getChainId();
    const file = path.join(__dirname, "..", "generated", "localhost.json");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify(
        {
          chainId,
          event: ev.event,
          disputeResolver: ev.disputeResolver,
          arbitrator: ev.arbitrator,
          deployBlock: Number(ev.deployBlock),
          owner: ev.owner,
        },
        null,
        2,
      ) + "\n",
    );
    console.log("Wrote %s", path.relative(process.cwd(), file));
  },
);
