import { presenceEventAbi } from "@kickback/contracts";
import { challengeOf, readGuest } from "@kickback/core";
import { encodeFunctionData, erc20Abi, parseAbi, zeroAddress, type Address, type PublicClient } from "viem";

import { executeRulingRequest, readSolved } from "@/lib/kleros/ruling";

import type { AppealInfo, GuestState, MoneyAction } from "../model/depositState";

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
  // a Kleros case: read whether it is ruled and how, so a ruled case can be settled and "did not rule" is not
  // shown as "ruled you were not there"
  let ruling: number | undefined;
  let isRuled: boolean | undefined;
  if (
    (guest.challenge.state === 2 || (guest.challenge.state === 3 && !guest.attended)) &&
    guest.challenge.matcher !== zeroAddress
  ) {
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
      isRuled = d[1];
      ruling = Number(d[2]);
    } catch {
      // unknown: the card keeps the plain wording
    }
  }
  // with Kleros and not final yet: the jurors' current ruling and the appeal window (a funded appeal starts a
  // new round, so this is read on every poll)
  const appeal =
    guest.challenge.state === 2 && isRuled !== true
      ? await readAppeal(client, contract, wallet, guest.challenge.arbitratorDisputeID)
      : undefined;
  // an attendee's held share can wait on another guest's ruled case: find one anyone can settle now
  const ruledCase = guest.attended ? await readRuledCase(client, contract, wallet) : undefined;
  return {
    ...guest,
    challenge: { ...guest.challenge, ruling, isRuled, appeal },
    ...(ruledCase ? { ruledCase } : {}),
    allowance,
    tokenBalance,
  };
}

/** The first other guest's Kleros case that is ruled (0, 1 or 2) and not settled yet, or undefined. */
export async function readRuledCase(
  client: PublicClient,
  contract: Address,
  wallet: Address,
): Promise<{ wallet: Address; ruling: number } | undefined> {
  try {
    const c = { address: contract, abi: presenceEventAbi } as const;
    const open = await client.readContract({ ...c, functionName: "openCases" });
    if (open === 0n) return undefined;
    const challengers = (await client.readContract({ ...c, functionName: "challengers" })).filter(
      (s) => s.toLowerCase() !== wallet.toLowerCase(),
    );
    const raw = await Promise.all(
      challengers.map((s) => client.readContract({ ...c, functionName: "challenges", args: [s] })),
    );
    const disputed = challengers
      .map((s, i) => ({ wallet: s, ...challengeOf(raw[i]!) }))
      .filter((ch) => ch.state === 2 && ch.matcher !== zeroAddress);
    if (disputed.length === 0) return undefined;
    const resolver = await client.readContract({ ...c, functionName: "disputeResolver" });
    for (const ch of disputed) {
      const d = await client.readContract({
        address: resolver,
        abi: RESOLVER_ABI,
        functionName: "disputes",
        args: [ch.localDisputeID],
      });
      if (d[1] && Number(d[2]) <= 2) return { wallet: ch.wallet, ruling: Number(d[2]) };
    }
    return undefined;
  } catch {
    // unknown: the card keeps the plain wording
    return undefined;
  }
}

/** appealStatus(staker), or undefined when it cannot be read (the page keeps the plain wording). */
export async function readAppeal(
  client: Pick<PublicClient, "readContract">,
  contract: Address,
  staker: Address,
  arbitratorDisputeID?: bigint,
  arbitrator?: Address,
): Promise<AppealInfo | undefined> {
  try {
    const [ruling, start, end, loserEnd, costAttended, costAbsent] = await client.readContract({
      address: contract,
      abi: presenceEventAbi,
      functionName: "appealStatus",
      args: [staker],
    });
    // outside an appeal window: the jurors may be deciding (status Waiting), or the ruling may be final but not
    // recorded yet (status Solved, before executeRuling)
    const final =
      Number(end) === 0 && arbitratorDisputeID !== undefined
        ? await readSolved(client, contract, arbitratorDisputeID, arbitrator)
        : false;
    return {
      ruling: Number(ruling),
      start: Number(start),
      end: Number(end),
      loserEnd: Number(loserEnd),
      costAttended,
      costAbsent,
      final,
    };
  } catch {
    return undefined;
  }
}

/** After the challenge window: the challenges releasePayouts must be given, and whether one still blocks it. */
export async function readRelease(client: PublicClient, contract: Address) {
  const c = { address: contract, abi: presenceEventAbi } as const;
  const [block, challengers] = await Promise.all([
    client.getBlock(),
    client.readContract({ ...c, functionName: "challengers" }),
  ]);
  const now = Number(block.timestamp);
  const raw = await Promise.all(
    challengers.map((s) => client.readContract({ ...c, functionName: "challenges", args: [s] })),
  );
  const waiting = challengers.map((wallet, i) => ({ wallet, ...challengeOf(raw[i]!) })).filter((ch) => ch.state === 1);
  return {
    // an unanswered challenge past its answer time is accepted by the release itself
    expired: waiting.filter((ch) => now > ch.matchEndsAt).map((ch) => ch.wallet),
    // one still inside its answer time makes releasePayouts revert
    blocked: waiting.some((ch) => now <= ch.matchEndsAt),
  };
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
  /** "settle" only: the guest whose ruled case is settled (never the connected wallet's own). */
  staker?: Address,
) {
  if (action === "settle") {
    if (!staker) throw new Error("No ruled case to settle. Reload the page.");
    return {
      to: contract,
      value: 0n,
      data: encodeFunctionData({ abi: presenceEventAbi, functionName: "resolveChallenge", args: [staker] }),
    };
  }
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
  if (action === "release") {
    const { expired, blocked } = await readRelease(client, contract);
    if (blocked) throw new Error("A challenge is still open. Try again later.");
    return {
      to: contract,
      value: 0n,
      data: encodeFunctionData({ abi: presenceEventAbi, functionName: "releasePayouts", args: [expired] }),
    };
  }
  if (action === "execute") return executeRulingRequest(client, contract, wallet);
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
  if (claimAmount(amount, ethAmount, token) !== shownAmount) throw new Error("The amount changed. Try again.");
  return withdrawRequest(contract, wallet);
}
