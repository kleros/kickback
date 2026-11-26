import { presenceEventAbi } from "@kickback/contracts";
import { readGuest } from "@kickback/core";
import { encodeFunctionData, erc20Abi, parseAbi, zeroAddress, type Address, type PublicClient } from "viem";

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
    token
      ? client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [wallet] })
      : undefined,
  ]);
  // a settled Kleros case: read its ruling, so "did not rule" is not shown as "ruled you were not there"
  let ruling: number | undefined;
  if (guest.challenge.state === 3 && !guest.attended && guest.challenge.matcher !== zeroAddress) {
    try {
      const resolver = await client.readContract({
        address: contract,
        abi: presenceEventAbi,
        functionName: "disputeResolver",
      });
      const d = await client.readContract({
        address: resolver,
        abi: RESOLVER_ABI,
        functionName: "disputes",
        args: [guest.challenge.localDisputeID],
      });
      ruling = Number(d[2]);
    } catch {
      // unknown: the card keeps the plain wording
    }
  }
  return { ...guest, challenge: { ...guest.challenge, ruling }, allowance, tokenBalance };
}

/** The Dispute Resolver's case record: (extra data, isRuled, ruling, the arbitrator's dispute ID). */
export const RESOLVER_ABI = parseAbi(["function disputes(uint256) view returns (bytes, bool, uint256, uint256)"]);

/** What a claim or withdrawal pays: both amounts in an ETH event; the asset first, else the ETH, in a token event. */
export const claimAmount = (amount: bigint, ethAmount: bigint, token: Address | undefined) =>
  !token ? amount + ethAmount : amount > 0n ? amount : ethAmount;

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
    const cost = await client.readContract({
      address: contract,
      abi: presenceEventAbi,
      functionName: "challengeDeposit",
    });
    if (cost !== shownAmount) throw new Error("The Kleros fee changed. Try again.");
    return {
      to: contract,
      value: cost,
      data: encodeFunctionData({ abi: presenceEventAbi, functionName: "challenge" }),
    };
  }
  if (action === "resolve")
    return {
      to: contract,
      value: 0n,
      data: encodeFunctionData({ abi: presenceEventAbi, functionName: "resolveChallenge", args: [wallet] }),
    };
  if (action === "approve") {
    const amount = await client.readContract({
      address: contract,
      abi: presenceEventAbi,
      functionName: "depositAmount",
    });
    if (amount !== shownAmount || !token) throw new Error("The deposit changed. Reload the page.");
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
  if (claimAmount(amount, ethAmount, token) !== shownAmount) throw new Error("The amount changed. Try again.");
  return withdrawRequest(contract, wallet);
}
