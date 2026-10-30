import { kickbackAbi } from "@kickback/contracts";
import { deployLocalEvent } from "@kickback/contracts/local";
import { describeWhen } from "@kickback/core";
import { createPublicClient, createWalletClient, http, type Address, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { LOCAL_CHAIN, LOCAL_RPC_URL } from "@/config/chains";
import { LOCAL_KLEROS } from "@/config/kleros";

import { ACCOUNT_PKEYS } from "./accounts";

const publicClient = createPublicClient({ chain: LOCAL_CHAIN, transport: http(LOCAL_RPC_URL) });
const alice = createWalletClient({
  chain: LOCAL_CHAIN,
  transport: http(LOCAL_RPC_URL),
  account: privateKeyToAccount(ACCOUNT_PKEYS.alice),
});
const node = createWalletClient({ chain: LOCAL_CHAIN, transport: http(LOCAL_RPC_URL) });

const iso = (unix: number) => `${new Date(unix * 1000).toISOString().slice(0, 19)}+00:00`;

/** The node's unlocked accounts from index 12 on, clear of the suite's seeded guests (2 to 11). */
export async function guestAccounts(count: number): Promise<Address[]> {
  return (await node.getAddresses()).slice(12, 12 + count);
}

/** Deploys an event from alice on the suite's mock court, starting `startIn` seconds after the chain's now. */
export async function deployOrganiserEvent(name: string, startIn: number) {
  const now = Number((await publicClient.getBlock()).timestamp);
  const eventStart = Math.ceil((now + startIn) / 60) * 60;
  const local = await deployLocalEvent({
    walletClient: alice,
    publicClient,
    eventStart: BigInt(eventStart),
    disputeResolver: LOCAL_KLEROS.disputeResolver,
    details: {
      eventName: name,
      eventWhen: describeWhen(iso(eventStart), iso(eventStart + 3 * 3600), "UTC"),
      eventLink: "https://luma.com/kickback-organiser",
    },
  });
  return { address: local.event, deployBlock: Number(local.deployBlock), eventStart };
}

export async function deposit(event: Address, from: Address): Promise<Hash> {
  const value = await publicClient.readContract({ address: event, abi: kickbackAbi, functionName: "depositAmount" });
  const hash = await node.writeContract({
    account: from,
    address: event,
    abi: kickbackAbi,
    functionName: "deposit",
    value,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function register(event: Address, wallets: Address[]) {
  const hash = await alice.writeContract({
    address: event,
    abi: kickbackAbi,
    functionName: "registerStakers",
    args: [wallets],
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

export const balanceOf = (address: Address) => publicClient.getBalance({ address });

export interface LumaGuest {
  wallet: Address;
  tx: Hash;
  checkedIn?: boolean;
}

/** A Luma guest export with the two registration questions the create page asks the organiser to add. */
export function lumaCsv(guests: readonly LumaGuest[]) {
  const head = "name,email,ticket_name,approval_status,checked_in_at,Deposit transaction link,eth_address";
  const rows = guests.map((g, i) =>
    [
      `Guest ${i + 1}`,
      `guest${i + 1}@example.com`,
      "Standard",
      "approved",
      g.checkedIn ? "2026-11-01T18:30:00.000Z" : "",
      g.tx,
      g.wallet,
    ].join(","),
  );
  return [head, ...rows].join("\n");
}
