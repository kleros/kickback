import { kickbackAbi } from "@kickback/contracts";
import { erc20Abi, isAddressEqual, type Address, type PublicClient } from "viem";

import { readEventState, readRelease } from "./read";
import { payoutFigures, payoutGates } from "../model/payout";
import { gate, type EventScope } from "../model/shared";

export interface PayoutInput {
  confirmation?: string;
  amount?: bigint;
  token?: Address;
  guest?: Address;
}

export async function readPayoutActions(
  client: PublicClient,
  scope: EventScope,
  account: Address | undefined,
  input: PayoutInput,
) {
  const state = await readEventState(client, scope);
  const release = await readRelease(client, state, account);
  const token = input.token
    ? {
        balance: await client.readContract({
          address: input.token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [scope.address],
          blockNumber: state.blockNumber,
        }),
        decimals: await client
          .readContract({ address: input.token, abi: erc20Abi, functionName: "decimals" })
          .catch(() => null),
        symbol: await client
          .readContract({ address: input.token, abi: erc20Abi, functionName: "symbol" })
          .catch(() => null),
      }
    : null;
  const guestStatus = input.guest
    ? await client.readContract({
        address: scope.address,
        abi: kickbackAbi,
        functionName: "status",
        args: [input.guest],
        blockNumber: state.blockNumber,
      })
    : undefined;
  const gates = payoutGates({
    ...input,
    ...state,
    isOwner: !!account && isAddressEqual(account, state.event.owner),
    release: account ? release : gate("Connect your wallet to release payouts."),
    attendees: BigInt(state.attendees),
    matchedCases: BigInt(state.challenges.filter((c) => c.matched).length),
    tokenBalance: token?.balance,
    guestStatus,
  });
  return {
    ...gates,
    registered: state.registered,
    preSettlement: release.wallets,
    nextPreSettlement: release.wallets[0] ?? null,
    ...payoutFigures({ ...state, phase: state.event.phase, deposit: state.event.depositAmount }),
    openChallenges: state.openChallenges,
    spare: state.spare,
    token,
    removeGuestList:
      gates.removeGuest.enabled && input.guest
        ? {
            contract: scope.address,
            chainId: scope.chainId,
            deposit: state.event.depositAmount.toString(),
            block: Number(state.blockNumber),
            generatedAt: "",
            items: [{ wallet: input.guest, name: "", email: "", onchain: "registered", status: guestStatus }],
          }
        : null,
  };
}
