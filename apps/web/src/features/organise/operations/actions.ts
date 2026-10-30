import { kickbackAbi } from "@kickback/contracts";
import { assertBatchable, type BuildPayoutResult, type StampedList } from "@kickback/core";
import {
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isAddressEqual,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";

import { checkSnapshot } from "./guests";
import { readEventState, readRelease } from "./read";
import { attendanceGates } from "../model/attendance";
import { payoutGates, payoutFigures } from "../model/payout";
import { requireEnabled, type EventScope } from "../model/shared";

export interface ActionInputs {
  registerStakers: { list: StampedList };
  rejectAndRefund: { list: StampedList };
  postAttendance: { plan: BuildPayoutResult; confirmation: string; noShowConfirmation?: string };
  addAttendees: { wallets: Address[] };
  releasePayouts: {
    confirmation: string;
    expected: { pool: bigint; attendees: number; share: bigint; heldBack: bigint };
  };
  resolveChallenge: { wallet: Address; confirmation: string };
  sweep: { confirmation?: string; expectedSpare: bigint };
  cancel: { confirmation: string; expectedRegistered: number };
  refund: { to: Address; amount: bigint };
  returnToken: { token: Address; to: Address; amount: bigint };
}
export type OrganiserAction = { [K in keyof ActionInputs]: { name: K; input: ActionInputs[K] } }[keyof ActionInputs];

export function validRecipient(to: Address, contract: Address) {
  const address = getAddress(to);
  if (isAddressEqual(address, zeroAddress) || isAddressEqual(address, contract))
    throw new Error("Choose a recipient other than the event or zero address.");
  return address;
}

export async function prepareAction(
  client: PublicClient,
  scope: EventScope,
  account: Address | undefined,
  action: OrganiserAction,
) {
  if (!account) throw new Error("Connect your wallet first.");
  if (client.chain && client.chain.id !== scope.chainId) throw new Error("Switch to the event's network.");
  const state = await readEventState(client, scope);
  const { event, now } = state;
  const isOwner = isAddressEqual(account, event.owner);
  if (!isOwner && action.name !== "releasePayouts" && action.name !== "resolveChallenge")
    throw new Error("Connect the organiser's wallet.");
  const base = {
    event,
    now,
    isOwner,
    release: { enabled: false, lockedReason: "Check payouts first." },
    spare: state.spare,
    attendees: BigInt(state.attendees),
    matchedCases: BigInt(state.challenges.filter((c) => c.matched).length),
  };
  let data;
  switch (action.name) {
    case "registerStakers":
    case "rejectAndRefund": {
      const list = action.input.list;
      const wallets = list.items.map((i) => validRecipient(getAddress(i.wallet), scope.address));
      assertBatchable(wallets);
      if (!wallets.length || wallets.length > 100) throw new Error("Select between 1 and 100 guests per transaction.");
      await checkSnapshot(client, { receiver: scope.address, chainId: scope.chainId, logChunk: 5000 }, list);
      data = encodeFunctionData({ abi: kickbackAbi, functionName: action.name, args: [wallets] });
      break;
    }
    case "postAttendance": {
      const { plan, confirmation, noShowConfirmation } = action.input;
      if (plan.plan.contract.toLowerCase() !== scope.address.toLowerCase() || plan.plan.chainId !== scope.chainId)
        throw new Error("This attendance plan belongs to another event or network.");
      requireEnabled(
        attendanceGates(event, now, state.challengeEndsAt, plan, confirmation, noShowConfirmation, isOwner).post,
      );
      const wallets = plan.attendees.map((a) => a.wallet);
      assertBatchable(wallets);
      const share = await client.readContract({
        address: scope.address,
        abi: kickbackAbi,
        functionName: "previewShare",
        args: [BigInt(wallets.length)],
      });
      if (share !== plan.share || state.registered !== plan.stakers.length)
        throw new Error("The pool changed; rebuild and confirm the attendance plan.");
      data = encodeFunctionData({ abi: kickbackAbi, functionName: "postAttendance", args: [wallets, plan.share] });
      break;
    }
    case "addAttendees":
      requireEnabled(attendanceGates(event, now, state.challengeEndsAt, undefined, "", "", isOwner).add);
      assertBatchable(action.input.wallets);
      if (!action.input.wallets.length) throw new Error("Choose at least one guest to add.");
      data = encodeFunctionData({ abi: kickbackAbi, functionName: "addAttendees", args: [action.input.wallets] });
      break;
    case "releasePayouts": {
      const release = await readRelease(client, state, account);
      const figures = payoutFigures({ ...state, phase: event.phase, deposit: event.depositAmount });
      const expected = action.input.expected;
      if (
        figures.pool !== expected.pool ||
        figures.attendees !== expected.attendees ||
        figures.share !== expected.share ||
        figures.heldBack !== expected.heldBack
      )
        throw new Error("The payout changed; review the new figures and confirm again.");
      requireEnabled(payoutGates({ ...base, release, confirmation: action.input.confirmation }).release);
      data = encodeFunctionData({ abi: kickbackAbi, functionName: "releasePayouts" });
      break;
    }
    case "resolveChallenge": {
      const release = await readRelease(client, state, account);
      if (
        !release.wallets.some((w) => isAddressEqual(w, action.input.wallet)) ||
        action.input.confirmation !== "SETTLE"
      )
        throw new Error(
          "Only expired unmatched challenges needed for payout pre-settlement can be settled here; type SETTLE.",
        );
      data = encodeFunctionData({ abi: kickbackAbi, functionName: "resolveChallenge", args: [action.input.wallet] });
      break;
    }
    case "sweep":
      if (state.spare !== action.input.expectedSpare)
        throw new Error("The leftovers changed; review the amount and confirm again.");
      requireEnabled(payoutGates({ ...base, confirmation: action.input.confirmation }).sweep);
      data = encodeFunctionData({ abi: kickbackAbi, functionName: "sweep", args: [account] });
      break;
    case "cancel":
      if (state.registered !== action.input.expectedRegistered)
        throw new Error("The registered guest count changed; review the refund total and confirm again.");
      requireEnabled(payoutGates({ ...base, confirmation: action.input.confirmation }).cancel);
      data = encodeFunctionData({ abi: kickbackAbi, functionName: "cancel" });
      break;
    case "refund":
      requireEnabled(payoutGates({ ...base, amount: action.input.amount }).refund);
      data = encodeFunctionData({
        abi: kickbackAbi,
        functionName: "refund",
        args: [validRecipient(action.input.to, scope.address), action.input.amount],
      });
      break;
    case "returnToken": {
      const tokenBalance = await client.readContract({
        address: action.input.token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [scope.address],
      });
      requireEnabled(payoutGates({ ...base, amount: action.input.amount, tokenBalance }).returnToken);
      data = encodeFunctionData({
        abi: kickbackAbi,
        functionName: "returnToken",
        args: [action.input.token, validRecipient(action.input.to, scope.address), action.input.amount],
      });
      break;
    }
  }
  return { to: scope.address, data };
}
