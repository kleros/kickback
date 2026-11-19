import { deployments } from "@kickback/contracts";
import { KLEROS, type Protocol } from "@kickback/core";
import { getContractAddress, isAddress, type Address } from "viem";
import { sepolia } from "viem/chains";

import { CHAIN_MODE, DEFAULT_CHAIN_ID } from "./chains";

/** Hardhat's first account. deploy-local sends: arbitrator, setFeeForJuror, resolver, case writer, implementation, factory. */
const HARDHAT_DEPLOYER: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const LOCAL_PROTOCOL: Protocol = {
  chainId: 31337,
  factory: getContractAddress({ from: HARDHAT_DEPLOYER, nonce: 5n }),
  implementation: getContractAddress({ from: HARDHAT_DEPLOYER, nonce: 4n }),
  disputeResolver: getContractAddress({ from: HARDHAT_DEPLOYER, nonce: 2n }),
  fromBlock: 0,
};
/** The first event deploy-local creates: the factory's first clone. */
export const FIRST_LOCAL_EVENT = getContractAddress({ from: LOCAL_PROTOCOL.factory, nonce: 1n });

type Deployment = { chainId: number; factory: Address; implementation?: Address; fromBlock?: number; disputeResolver?: Address };
const deployed = deployments as unknown as Record<string, Deployment | undefined>;
const fromFile = (key: string): Protocol | null => {
  const d = deployed[key];
  return d?.factory
    ? {
        chainId: d.chainId,
        factory: d.factory,
        implementation: d.implementation,
        fromBlock: d.fromBlock,
        disputeResolver: d.disputeResolver,
      }
    : null;
};

const override = process.env.NEXT_PUBLIC_FACTORY;

/**
 * The factory this site creates and opens events from on its chain, or null where none is deployed
 * (then the pages say "opening soon"). NEXT_PUBLIC_FACTORY overrides it.
 */
export const PROTOCOL: Protocol | null =
  override && isAddress(override)
    ? { chainId: DEFAULT_CHAIN_ID, factory: override }
    : CHAIN_MODE === "hardhat"
      ? LOCAL_PROTOCOL
      : CHAIN_MODE === "sepolia"
        ? fromFile("sepolia")
        : fromFile("ethereum");

/** Where event logs are read from: the factory's deploy block. */
export const FROM_BLOCK = PROTOCOL?.fromBlock ?? 0;

/** The court's name as guests and organisers read it. */
export const courtName = (chainId: number) => (chainId === sepolia.id ? "Test court (Sepolia)" : "Kleros Court");

/** Kleros Court's page for a case (its arbitrator dispute ID), where there is one. */
export const caseUrl = (chainId: number, arbitratorDisputeID: bigint): string | undefined => {
  const court = KLEROS[chainId]?.court;
  return court ? `${court}${arbitratorDisputeID}` : undefined;
};
