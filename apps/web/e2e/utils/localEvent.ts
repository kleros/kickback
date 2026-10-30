import { kickbackAbi } from "@kickback/contracts";
import { deployLocalEvent } from "@kickback/contracts/local";
import { describeWhen } from "@kickback/core";
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";

import { ACCOUNT_PKEYS } from "./accounts";

const DAY = 86_400;
const IST_MINUTES = 330;

/** An ISO time with the +05:30 offset, as describeWhen wants it. */
const istIso = (unix: number) => {
  const local = new Date((unix + IST_MINUTES * 60) * 1000).toISOString().slice(0, 19);
  return `${local}+05:30`;
};

/** Guests who deposit and are registered, so previewShare has stakers to divide. */
export const SEEDED_GUESTS = 10;

/**
 * Deploys the suite's event from alice on a fresh node (mocks, then the event at nonce 2), with its date
 * written on an IST clock, and has SEEDED_GUESTS of the node's other accounts deposit and get registered.
 */
export async function deploySuiteEvent(rpcUrl: string) {
  const chain = { ...hardhat, rpcUrls: { default: { http: [rpcUrl] } } };
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({
    chain,
    transport: http(rpcUrl),
    account: privateKeyToAccount(ACCOUNT_PKEYS.alice),
  });

  const now = Number((await publicClient.getBlock()).timestamp);
  // whole minutes: eventClock matches the written time to eventStart to the minute
  const eventStart = Math.ceil((now + 3 * DAY) / 60) * 60;
  const local = await deployLocalEvent({
    walletClient,
    publicClient,
    eventStart: BigInt(eventStart),
    details: {
      eventName: "Truth Pays Local",
      eventWhen: describeWhen(istIso(eventStart), istIso(eventStart + 4 * 3600), "IST"),
      eventLink: "https://luma.com/kickback-local",
    },
  });

  const node = createWalletClient({ chain, transport: http(rpcUrl) });
  const guests: Address[] = (await node.getAddresses()).slice(2, 2 + SEEDED_GUESTS);
  const amount = await publicClient.readContract({
    address: local.event,
    abi: kickbackAbi,
    functionName: "depositAmount",
  });
  for (const guest of guests) {
    const hash = await node.writeContract({
      account: guest,
      address: local.event,
      abi: kickbackAbi,
      functionName: "deposit",
      value: amount,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }
  const hash = await walletClient.writeContract({
    address: local.event,
    abi: kickbackAbi,
    functionName: "registerStakers",
    args: [guests],
  });
  await publicClient.waitForTransactionReceipt({ hash });

  return { event: local.event, eventStart, claimDeadline: Number(local.args[4]), amount, guests };
}
