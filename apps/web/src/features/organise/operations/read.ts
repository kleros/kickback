import { kickbackAbi } from "@kickback/contracts";
import {
  checkDeployBlock,
  contractConfig,
  errorText,
  findDeployBlock,
  incomingDeposits,
  isKnownResolver,
  KLEROS,
  TX_GAS_CAP,
  readEvent,
  type NetworkInput,
} from "@kickback/core";
import { encodeFunctionData, zeroAddress, type Address, type PublicClient } from "viem";

import { pinnedRead } from "./pinned";
import { releasePlan, type ChallengeFact } from "../model/payout";
import { gate, type EventScope } from "../model/shared";

export async function readEventState(client: PublicClient, scope: EventScope) {
  const block = await client.getBlock();
  if (block.number === null) throw new Error("Wait for a confirmed block.");
  const blockNumber = block.number;
  const readContract = pinnedRead(client, blockNumber);
  const event = await readEvent(
    { getCode: (args) => client.getCode({ address: args.address, blockNumber }), readContract },
    scope.address,
  );
  const read = { address: scope.address, abi: kickbackAbi, blockNumber } as const;
  const [registered, attendees, challengeEndsAt, openChallenges, spare, wallets, payoutShare, heldBack] =
    await Promise.all([
      client.readContract({ ...read, functionName: "stakerCount" }),
      client.readContract({ ...read, functionName: "attendeeCount" }),
      client.readContract({ ...read, functionName: "challengeEndsAt" }),
      client.readContract({ ...read, functionName: "pendingChallenges" }),
      client.readContract({ ...read, functionName: "spare" }),
      client.readContract({ ...read, functionName: "challengers" }),
      client.readContract({ ...read, functionName: "payoutShare" }),
      client.readContract({ ...read, functionName: "heldBack" }),
    ]);
  const challenges: ChallengeFact[] = await Promise.all(
    wallets.map(async (wallet) => {
      const c = await client.readContract({ ...read, functionName: "challenges", args: [wallet] });
      return { wallet, state: Number(c[0]), matchEndsAt: Number(c[2]), matched: c[1] !== zeroAddress };
    }),
  );
  return {
    event,
    blockNumber,
    now: Number(block.timestamp),
    registered: Number(registered),
    attendees: Number(attendees),
    challengeEndsAt: Number(challengeEndsAt),
    openChallenges: Number(openChallenges),
    spare,
    challenges,
    payoutShare,
    heldBack,
  };
}
export type EventState = Awaited<ReturnType<typeof readEventState>>;

export async function readRelease(
  client: Pick<PublicClient, "call" | "estimateGas">,
  state: EventState,
  account?: Address,
) {
  const request = {
    to: state.event.contract,
    data: encodeFunctionData({ abi: kickbackAbi, functionName: "releasePayouts" }),
    ...(account ? { account } : {}),
    blockNumber: state.blockNumber,
  };
  const prerequisite =
    state.event.phase !== 1
      ? "Post the attendance list first."
      : state.now <= state.challengeEndsAt
        ? "The challenge window is still open."
        : state.challenges.some((c) => c.state === 1 && state.now <= c.matchEndsAt)
          ? "A challenge is still waiting for a match; wait for its deadline."
          : null;
  if (prerequisite) return { ...gate(prerequisite), ...releasePlan([], state.now, null) };
  let dryRunError: string | null = null;
  try {
    await client.call(request);
  } catch (error) {
    dryRunError = errorText(error);
  }
  let estimate: bigint | null = null;
  try {
    estimate = await client.estimateGas(request);
  } catch {
    /* A failed estimate can require pre-settlement of expired unmatched challenges. */
  }
  const plan = releasePlan(state.challenges, state.now, estimate);
  return {
    ...gate(
      plan.needsPreSettlement
        ? "Settle the expired unmatched challenges one at a time, then check payouts again."
        : (dryRunError ??
            (estimate === null
              ? "Could not estimate the payout; try again."
              : (estimate * 13n) / 10n > TX_GAS_CAP
                ? "The payout exceeds one transaction's gas limit."
                : null)),
    ),
    ...plan,
  };
}

export async function openEvent(client: PublicClient, scope: EventScope, network: NetworkInput) {
  const state = await readEventState(client, scope);
  const deployBlock = scope.deployBlock ?? (await findDeployBlock(client, scope.address));
  if (scope.deployBlock !== undefined) {
    const result = await checkDeployBlock(client, scope.address, deployBlock);
    if (!result.confirmed)
      throw new Error("Could not confirm the deployment block; verify the creation transaction and try again.");
  }
  const cfg = contractConfig(state.event, network, deployBlock);
  const deposits = await incomingDeposits(client, cfg, deployBlock, state.blockNumber);
  const release = await readRelease(client, state);
  return {
    ...state,
    cfg,
    deployBlock,
    deposits: deposits.length,
    release,
    verifiedKleros:
      isKnownResolver(scope.chainId, state.event.disputeResolver) &&
      KLEROS[scope.chainId]?.arbitrator.toLowerCase() === state.event.arbitrator.toLowerCase(),
  };
}
