import { presenceEventAbi } from "@kickback/contracts";
import { challengeOf } from "@kickback/core";
import { encodeFunctionData, parseAbi, type Address, type PublicClient } from "viem";

/** The arbitrator's standard calls: a dispute's status (2 = Solved) and recording its final ruling. */
export const ARBITRATOR_ABI = parseAbi([
  "function disputeStatus(uint256) view returns (uint8)",
  "function executeRuling(uint256)",
]);

/** Whether the arbitrator says the case's ruling is final; false when it cannot be read. */
export async function readSolved(
  client: Pick<PublicClient, "readContract">,
  contract: Address,
  arbitratorDisputeID: bigint,
  arbitrator?: Address,
): Promise<boolean> {
  try {
    const at =
      arbitrator ??
      (await client.readContract({ address: contract, abi: presenceEventAbi, functionName: "arbitrator" }));
    const status = await client.readContract({
      address: at,
      abi: ARBITRATOR_ABI,
      functionName: "disputeStatus",
      args: [arbitratorDisputeID],
    });
    return Number(status) === 2;
  } catch {
    return false;
  }
}

/** executeRuling on the arbitrator: records a final ruling, so the case can be settled. Anyone can send it. */
export async function executeRulingRequest(
  client: Pick<PublicClient, "readContract">,
  contract: Address,
  staker: Address,
) {
  const c = { address: contract, abi: presenceEventAbi } as const;
  const [arbitrator, raw] = await Promise.all([
    client.readContract({ ...c, functionName: "arbitrator" }),
    client.readContract({ ...c, functionName: "challenges", args: [staker] }),
  ]);
  const ch = challengeOf(raw);
  if (ch.state !== 2) throw new Error("This case has already been settled. Reload the page.");
  return {
    to: arbitrator,
    value: 0n,
    data: encodeFunctionData({ abi: ARBITRATOR_ABI, functionName: "executeRuling", args: [ch.arbitratorDisputeID] }),
  };
}
