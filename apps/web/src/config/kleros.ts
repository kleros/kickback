import { testnets } from "@kickback/contracts";
import { isKnownResolver, KLEROS, type NetworkInput } from "@kickback/core";
import { getContractAddress, isAddressEqual, isAddress, type Address } from "viem";
import { hardhat, sepolia } from "viem/chains";

export const SEPOLIA_ID = sepolia.id;

/** The mock Kleros pair `deploy-sepolia-kleros` writes to deployments-live/sepolia.json. */
export interface TestKleros {
  klerosLiquid: Address;
  disputeResolver: Address;
  deployBlock: number;
}

/** Null until the Sepolia mocks are deployed and exported. */
export const SEPOLIA_KLEROS = (testnets as { sepolia: TestKleros | null }).sepolia;

/** On a fresh Hardhat node, deployMockKleros from the first account puts the arbitrator at nonce 0, the resolver at 1. */
const HARDHAT_DEPLOYER: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const LOCAL_KLEROS = {
  disputeResolver: getContractAddress({ from: HARDHAT_DEPLOYER, nonce: 1n }),
  arbitrator: getContractAddress({ from: HARDHAT_DEPLOYER, nonce: 0n }),
} as const;

export interface KlerosPair {
  disputeResolver: Address;
  arbitrator: Address;
}

/** The Kleros pair a new event on `chainId` is created with, or null when that chain has none set up. */
export function klerosFor(chainId: number, sepoliaKleros = SEPOLIA_KLEROS): KlerosPair | null {
  if (chainId === SEPOLIA_ID)
    return sepoliaKleros
      ? { disputeResolver: sepoliaKleros.disputeResolver, arbitrator: sepoliaKleros.klerosLiquid }
      : null;
  if (chainId === hardhat.id) return LOCAL_KLEROS;
  const known = KLEROS[chainId];
  return known ? { disputeResolver: known.disputeResolver, arbitrator: known.arbitrator } : null;
}

const same = (a: unknown, b: Address) =>
  typeof a === "string" && isAddress(a, { strict: false }) && isAddressEqual(a, b);

/** Whether `resolver` is the Dispute Resolver this app trusts on `chainId`; the Sepolia mock counts on Sepolia only. */
export function isKnownResolverOn(chainId: number, resolver: unknown, sepoliaKleros = SEPOLIA_KLEROS): boolean {
  if (chainId === SEPOLIA_ID) return !!sepoliaKleros && same(resolver, sepoliaKleros.disputeResolver);
  return isKnownResolver(chainId, resolver);
}

/** Whether `arbitrator` is the court contract this app trusts on `chainId`. */
export function isKnownArbitratorOn(chainId: number, arbitrator: unknown, sepoliaKleros = SEPOLIA_KLEROS): boolean {
  if (chainId === SEPOLIA_ID) return !!sepoliaKleros && same(arbitrator, sepoliaKleros.klerosLiquid);
  const known = KLEROS[chainId];
  return !!known && same(arbitrator, known.arbitrator);
}

/** The court's name as guests and organisers read it. */
export const courtName = (chainId: number) => (chainId === SEPOLIA_ID ? "Test court (Sepolia)" : "Kleros Court");

/** The network part of an organiser config on `chainId`, with the chain's Kleros pair when it has one. */
export function networkFor(chainId: number, sepoliaKleros = SEPOLIA_KLEROS): NetworkInput {
  const kleros = klerosFor(chainId, sepoliaKleros);
  return {
    chainId,
    ...(chainId === SEPOLIA_ID ? { chainName: "Sepolia", explorer: "https://sepolia.etherscan.io" } : {}),
    ...(kleros ? { kleros: { ...kleros } } : {}),
  };
}
