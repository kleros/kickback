import { kickbackAbi } from "@kickback/contracts";
import { encodeFunctionData, type Address, type PublicClient } from "viem";

export async function readGuestMoney(client: PublicClient, contract: Address, wallet: Address) {
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const read = { address: contract, abi: kickbackAbi, blockNumber } as const;
  const [status, owed, attended, payoutShare, phase] = await Promise.all([
    client.readContract({ ...read, functionName: "status", args: [wallet] }),
    client.readContract({ ...read, functionName: "owed", args: [wallet] }),
    client.readContract({ ...read, functionName: "attended", args: [wallet] }),
    client.readContract({ ...read, functionName: "payoutShare" }),
    client.readContract({ ...read, functionName: "phase" }),
  ]);
  return { status, owed, attended, payoutShare, phase };
}

export function guestMoneyRequest(contract: Address, wallet: Address, action: "withdraw" | "claim") {
  return {
    to: contract,
    value: 0n,
    data: encodeFunctionData({
      abi: kickbackAbi,
      functionName: action === "withdraw" ? "emergencyWithdraw" : "claim",
      args: [wallet],
    }),
  };
}

export async function prepareGuestMoney(
  client: PublicClient,
  contract: Address,
  wallet: Address,
  action: "withdraw" | "claim",
  shownAmount: bigint,
) {
  const amount =
    action === "claim"
      ? await client.readContract({ address: contract, abi: kickbackAbi, functionName: "owed", args: [wallet] })
      : await client.readContract({ address: contract, abi: kickbackAbi, functionName: "depositAmount" });
  if (amount !== shownAmount) throw new Error("The amount changed. Check the ticket and try again.");
  return guestMoneyRequest(contract, wallet, action);
}
