import { presenceEventAbi, presenceFactoryAbi } from "@kickback/contracts";
import type { EventConfig } from "@kickback/core";
import { encodeFunctionData, type Address } from "viem";

const call = (to: Address, data: `0x${string}`, value = 0n) => ({ to, data, value });

/** The organiser's and anyone's calls on an event, as wallet requests. */
export const tx = {
  create: (factory: Address, config: EventConfig) =>
    call(factory, encodeFunctionData({ abi: presenceFactoryAbi, functionName: "createEvent", args: [config] })),
  reject: (event: Address, wallets: readonly Address[]) =>
    call(event, encodeFunctionData({ abi: presenceEventAbi, functionName: "reject", args: [wallets] })),
  postAttendance: (event: Address, list: readonly Address[], close: boolean) =>
    call(event, encodeFunctionData({ abi: presenceEventAbi, functionName: "postAttendance", args: [list, close] })),
  addAttendees: (event: Address, list: readonly Address[]) =>
    call(event, encodeFunctionData({ abi: presenceEventAbi, functionName: "addAttendees", args: [list] })),
  matchChallenge: (event: Address, staker: Address, value: bigint) =>
    call(event, encodeFunctionData({ abi: presenceEventAbi, functionName: "matchChallenge", args: [staker] }), value),
  resolveChallenge: (event: Address, staker: Address) =>
    call(event, encodeFunctionData({ abi: presenceEventAbi, functionName: "resolveChallenge", args: [staker] })),
  releasePayouts: (event: Address, expired: readonly Address[]) =>
    call(event, encodeFunctionData({ abi: presenceEventAbi, functionName: "releasePayouts", args: [expired] })),
  distribute: (event: Address, accounts: readonly Address[]) =>
    call(event, encodeFunctionData({ abi: presenceEventAbi, functionName: "distribute", args: [accounts] })),
  cancel: (event: Address) => call(event, encodeFunctionData({ abi: presenceEventAbi, functionName: "cancel" })),
};
