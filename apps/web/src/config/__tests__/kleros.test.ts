import { KLEROS } from "@kickback/core";
import { describe, expect, it } from "vitest";

import {
  courtName,
  isKnownArbitratorOn,
  isKnownResolverOn,
  klerosFor,
  LOCAL_KLEROS,
  networkFor,
  SEPOLIA_ID,
  SEPOLIA_KLEROS,
  type TestKleros,
} from "../kleros";

const MOCKS: TestKleros = {
  klerosLiquid: "0x1111111111111111111111111111111111111111",
  disputeResolver: "0x2222222222222222222222222222222222222222",
  deployBlock: 7,
};
const MAINNET = KLEROS[1]!;

describe("known resolver per chain", () => {
  it("mainnet knows the real Kleros pair only", () => {
    expect(isKnownResolverOn(1, MAINNET.disputeResolver, MOCKS)).toBe(true);
    expect(isKnownArbitratorOn(1, MAINNET.arbitrator, MOCKS)).toBe(true);
    expect(isKnownResolverOn(1, MOCKS.disputeResolver, MOCKS)).toBe(false);
    expect(isKnownArbitratorOn(1, MOCKS.klerosLiquid, MOCKS)).toBe(false);
  });

  it("Sepolia knows its mock pair, and not mainnet's", () => {
    expect(isKnownResolverOn(SEPOLIA_ID, MOCKS.disputeResolver.toUpperCase().replace("0X", "0x"), MOCKS)).toBe(true);
    expect(isKnownArbitratorOn(SEPOLIA_ID, MOCKS.klerosLiquid, MOCKS)).toBe(true);
    expect(isKnownResolverOn(SEPOLIA_ID, MAINNET.disputeResolver, MOCKS)).toBe(false);
  });

  it("Sepolia knows nothing while its mocks are not set up", () => {
    expect(isKnownResolverOn(SEPOLIA_ID, MOCKS.disputeResolver, null)).toBe(false);
    expect(isKnownArbitratorOn(SEPOLIA_ID, MOCKS.klerosLiquid, null)).toBe(false);
    expect(klerosFor(SEPOLIA_ID, null)).toBeNull();
  });

  it("Hardhat and unknown chains know no resolver, and junk is never known", () => {
    expect(isKnownResolverOn(31337, LOCAL_KLEROS.disputeResolver, MOCKS)).toBe(false);
    expect(isKnownResolverOn(5, MOCKS.disputeResolver, MOCKS)).toBe(false);
    expect(isKnownResolverOn(SEPOLIA_ID, "not an address", MOCKS)).toBe(false);
  });

  it("the exported Sepolia manifest is null or a full pair", () => {
    if (SEPOLIA_KLEROS) expect(SEPOLIA_KLEROS.disputeResolver).toMatch(/^0x[0-9a-fA-F]{40}$/);
    else expect(SEPOLIA_KLEROS).toBeNull();
  });
});

describe("the network a new event is created on", () => {
  it("takes the chain's Kleros pair", () => {
    expect(networkFor(SEPOLIA_ID, MOCKS)).toMatchObject({
      chainId: SEPOLIA_ID,
      chainName: "Sepolia",
      kleros: { disputeResolver: MOCKS.disputeResolver, arbitrator: MOCKS.klerosLiquid },
    });
    expect(networkFor(31337).kleros).toEqual(LOCAL_KLEROS);
    expect(networkFor(1).kleros?.disputeResolver).toBe(MAINNET.disputeResolver);
    expect(networkFor(SEPOLIA_ID, null).kleros).toBeUndefined();
  });

  it("names the test court on Sepolia", () => {
    expect(courtName(SEPOLIA_ID)).toBe("Test court (Sepolia)");
    expect(courtName(1)).toBe("Kleros Court");
  });
});
