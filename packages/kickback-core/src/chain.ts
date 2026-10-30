import { kickbackAbi, kickbackFingerprint, kickbackImmutables } from "@kickback/contracts";
import { getAddress, isAddress, type Address, type Hex, type PublicClient } from "viem";

import { codeFingerprint } from "./caseText";
import type { Config, EventInfo } from "./config";
import { isContractCode } from "./deposits";
import { KickbackError, shortMessage } from "./kickbackError";
import { fmt } from "./text";

export interface Runtime {
  /** codeFingerprint of the build */
  sha256: Hex;
  /** [start, length] byte ranges of the immutables in the runtime code */
  immutables: readonly (readonly [number, number])[];
}
/** The live v7 build (@kickback/contracts). */
export const KICKBACK_RUNTIME: Runtime = { sha256: kickbackFingerprint, immutables: kickbackImmutables };

type EventGetter =
  | "eventName"
  | "depositAmount"
  | "eventStart"
  | "claimDeadline"
  | "owner"
  | "disputeResolver"
  | "arbitrator"
  | "policyURI"
  | "metaEvidenceTemplate"
  | "phase";

/**
 * Everything about an event its deposit contract knows, read on-chain. Throws a KickbackError with
 * code NO_KICKBACK_CONTRACT (no contract at the address on this network), NOT_KICKBACK (it does not
 * answer like a kickback deposit contract) or UNKNOWN_CODE (its code is not `runtime`'s build: answers
 * can be faked, the code can't). `runtime: null` skips the code check.
 */
export async function readEvent(
  client: Pick<PublicClient, "getCode" | "readContract">,
  address: string | undefined,
  { runtime = KICKBACK_RUNTIME }: { runtime?: Runtime | null } = {},
): Promise<EventInfo> {
  if (!isAddress(address ?? "", { strict: false }))
    throw new KickbackError(
      `"${address ?? ""}" is not a contract address (0x… with 40 characters after it).`,
      "NOT_KICKBACK",
    );
  const contract = getAddress(String(address).toLowerCase());
  const code = await client.getCode({ address: contract });
  if (!isContractCode(code))
    throw new KickbackError(`There is no contract at ${contract} on this network.`, "NO_KICKBACK_CONTRACT");
  const read = <F extends EventGetter>(functionName: F) =>
    client.readContract({ address: contract, abi: kickbackAbi, functionName });
  let v;
  try {
    v = await Promise.all([
      read("eventName"),
      read("depositAmount"),
      read("eventStart"),
      read("claimDeadline"),
      read("owner"),
      read("disputeResolver"),
      read("arbitrator"),
      read("policyURI"),
      read("metaEvidenceTemplate"),
      read("phase"),
    ]);
  } catch (e) {
    throw new KickbackError(
      `The contract at ${contract} is not a kickback deposit contract (${shortMessage(e)}).`,
      "NOT_KICKBACK",
      { cause: e },
    );
  }
  if (runtime && codeFingerprint(code, runtime.immutables) !== runtime.sha256)
    throw new KickbackError(
      `The contract at ${contract} answers like a kickback deposit contract, but its code is not the kickback deposit contract's.`,
      "UNKNOWN_CODE",
    );
  const [
    eventName,
    depositAmount,
    eventStart,
    claimDeadline,
    owner,
    disputeResolver,
    arbitrator,
    policyURI,
    [pieces, slots],
    phase,
  ] = v;
  return {
    contract,
    eventName,
    depositAmount,
    eventStart: Number(eventStart),
    claimDeadline: Number(claimDeadline),
    owner,
    disputeResolver,
    arbitrator,
    policyURI,
    metaEvidenceTemplate: { pieces: [...pieces], slots },
    phase: Number(phase),
  };
}

/**
 * The deposit contract at cfg.receiver, checked: it has code, and its depositAmount is the config's.
 * Throws a KickbackError with code NO_KICKBACK_CONTRACT or DEPOSIT_MISMATCH (with `depositAmount`).
 */
export async function checkContract(
  client: Pick<PublicClient, "getCode" | "readContract">,
  cfg: Pick<Config, "receiver" | "chainName" | "depositUnits" | "deposit">,
): Promise<{ contract: Address; depositAmount: bigint }> {
  if (!isContractCode(await client.getCode({ address: cfg.receiver })))
    throw new KickbackError(`No deposit contract at ${cfg.receiver} on ${cfg.chainName}.`, "NO_KICKBACK_CONTRACT");
  const depositAmount = await client.readContract({
    address: cfg.receiver,
    abi: kickbackAbi,
    functionName: "depositAmount",
  });
  if (depositAmount !== cfg.depositUnits)
    throw new KickbackError(
      `The settings say the deposit is ${cfg.deposit} ETH, but the contract at ${cfg.receiver} was deployed with ${fmt(depositAmount)} ETH.`,
      "DEPOSIT_MISMATCH",
      { depositAmount },
    );
  return { contract: cfg.receiver, depositAmount };
}

type BlockClient = Pick<PublicClient, "getBlock" | "getTransactionReceipt">;

/** True when the contract was created by a transaction of this block (directly, not by another contract). */
export async function createdIn(client: BlockClient, address: Address, block: number | bigint): Promise<boolean> {
  try {
    const b = await client.getBlock({ blockNumber: BigInt(block), includeTransactions: true });
    for (const tx of b.transactions) {
      if (tx.to) continue;
      const r = await client.getTransactionReceipt({ hash: tx.hash });
      if (r.contractAddress && getAddress(r.contractAddress) === getAddress(address)) return true;
    }
  } catch {
    // an RPC that can't serve the block: not confirmed
  }
  return false;
}

/**
 * The block a contract was created in: the first block with its code (a binary search over past
 * states), confirmed by its creation transaction. Throws DEPLOY_BLOCK_NOT_FOUND when the RPC can't
 * read old states (public RPCs often can't): then ask for the block.
 */
export async function findDeployBlock(
  client: BlockClient & Pick<PublicClient, "getBlockNumber" | "getCode">,
  address: Address,
  { explorer = "https://etherscan.io" }: { explorer?: string } = {},
): Promise<number> {
  const ask = () =>
    new KickbackError(
      `Could not find the block this contract was created in (the network connection can't look that far back). On ${explorer}/address/${address}, find its "Contract Creation" transaction and give that transaction's block number as the deploy block.`,
      "DEPLOY_BLOCK_NOT_FOUND",
    );
  let lo = 0n;
  try {
    let hi = await client.getBlockNumber({ cacheTime: 0 });
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      if (isContractCode(await client.getCode({ address, blockNumber: mid }))) hi = mid;
      else lo = mid + 1n;
    }
  } catch {
    throw ask();
  }
  if (!(await createdIn(client, address, lo))) throw ask();
  return Number(lo);
}

/**
 * A deploy block given by hand: throws DEPLOY_BLOCK_TOO_LATE when the contract already existed the
 * block before (deposits sent before it would be missed). `confirmed` is false when its creation
 * transaction could not be found in that block.
 */
export async function checkDeployBlock(
  client: BlockClient & Pick<PublicClient, "getCode">,
  address: Address,
  from: number,
  { explorer = "https://etherscan.io" }: { explorer?: string } = {},
): Promise<{ confirmed: boolean }> {
  if (await createdIn(client, address, from)) return { confirmed: true };
  let before: boolean | null = null;
  try {
    before = from > 0 && isContractCode(await client.getCode({ address, blockNumber: BigInt(from - 1) }));
  } catch {
    // unknown: the caller warns
  }
  if (before === true)
    throw new KickbackError(
      `The contract already existed before block ${from}, so deposits sent before that block would be missed. Use the block of its "Contract Creation" transaction (${explorer}/address/${address}), or leave the deploy block empty.`,
      "DEPLOY_BLOCK_TOO_LATE",
    );
  return { confirmed: false };
}
