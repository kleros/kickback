import { getContractAddress, isAddress, type Address } from "viem";

import { CHAIN_MODE } from "./chains";

/** The live Truth Pays event on Ethereum (packages/contracts/deployments-live/truth-pays-mainnet). */
export const MAINNET_EVENT = {
  contract: "0xd5c6A73c05FA431c748781DaBAA99Fe2590d677D" as Address,
  fromBlock: 26_290_226,
} as const;

/** Hardhat's first account. On a fresh node its first deployLocalEvent (two mocks, then the event) lands at nonce 2. */
const HARDHAT_DEPLOYER: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const FIRST_LOCAL_EVENT = getContractAddress({ from: HARDHAT_DEPLOYER, nonce: 2n });

const override = process.env.NEXT_PUBLIC_EVENT_CONTRACT;

/** The event `/event` opens: NEXT_PUBLIC_EVENT_CONTRACT, else the live event, else the first local deploy. */
export const DEFAULT_EVENT: { contract: Address; fromBlock: number } =
  override && isAddress(override)
    ? { contract: override, fromBlock: 0 }
    : CHAIN_MODE === "hardhat"
      ? { contract: FIRST_LOCAL_EVENT, fromBlock: 0 }
      : MAINNET_EVENT;

/** Where deposit logs are read from for `contract`: the link's `from`, the live event's deploy block, or 0. */
export function fromBlockFor(contract: Address, from: string | undefined): number | undefined {
  if (from !== undefined && /^\d+$/.test(from)) return Number(from);
  if (contract.toLowerCase() === DEFAULT_EVENT.contract.toLowerCase()) return DEFAULT_EVENT.fromBlock;
  return CHAIN_MODE === "hardhat" ? 0 : undefined;
}
