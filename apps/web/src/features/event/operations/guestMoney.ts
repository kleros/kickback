import { presenceEventAbi } from "@kickback/contracts";
import { readGuest } from "@kickback/core";
import { encodeFunctionData, erc20Abi, type Address, type PublicClient } from "viem";

import type { GuestState, MoneyAction } from "../model/depositState";

/** The wallet's place in the event, plus what it lets the event take (token events). */
export async function readGuestMoney(
  client: PublicClient,
  contract: Address,
  wallet: Address,
  token: Address | undefined,
): Promise<GuestState & { allowance?: bigint; tokenBalance?: bigint }> {
  const [guest, allowance, tokenBalance] = await Promise.all([
    readGuest(client, contract, wallet),
    token
      ? client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [wallet, contract] })
      : undefined,
    token ? client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }) : undefined,
  ]);
  return { ...guest, allowance, tokenBalance };
}

/** withdraw(to = the wallet itself): payouts, refunds and challenge money all come out this way. */
export const withdrawRequest = (contract: Address, wallet: Address) => ({
  to: contract,
  value: 0n,
  data: encodeFunctionData({ abi: presenceEventAbi, functionName: "withdraw", args: [wallet] }),
});

/** Re-reads the contract right before the wallet prompt, so the amount on the card is the amount signed. */
export async function prepareGuestMoney(
  client: PublicClient,
  contract: Address,
  wallet: Address,
  action: MoneyAction,
  shownAmount: bigint,
  token?: Address,
) {
  if (action === "challenge") {
    const cost = await client.readContract({ address: contract, abi: presenceEventAbi, functionName: "challengeDeposit" });
    if (cost !== shownAmount) throw new Error("Kleros's fee changed. Check the card and try again.");
    return { to: contract, value: cost, data: encodeFunctionData({ abi: presenceEventAbi, functionName: "challenge" }) };
  }
  if (action === "approve") {
    const amount = await client.readContract({ address: contract, abi: presenceEventAbi, functionName: "depositAmount" });
    if (amount !== shownAmount || !token) throw new Error("The deposit amount changed. Reload the page.");
    // exactly the deposit, never an unlimited allowance
    return {
      to: token,
      value: 0n,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [contract, amount] }),
    };
  }
  const [amount, ethAmount] = await client.readContract({
    address: contract,
    abi: presenceEventAbi,
    functionName: "claimable",
    args: [wallet],
  });
  if ((amount > 0n ? amount : ethAmount) !== shownAmount)
    throw new Error("The amount changed. Check the card and try again.");
  return withdrawRequest(contract, wallet);
}
