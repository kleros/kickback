import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PROTOCOL", () => {
  it("mainnet: the factory in deployments-live/ethereum.json", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN", "mainnet");
    const { PROTOCOL } = await import("../protocol");
    expect(PROTOCOL?.factory).toBe("0xEAC922d8AAC8f32cb9832f52Ac878B2a94772F8B");
    expect(PROTOCOL?.chainId).toBe(1);
  });

  it("hardhat: deploy-local's factory, from the first account's nonces", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN", "hardhat");
    const { PROTOCOL, LOCAL_PROTOCOL } = await import("../protocol");
    expect(PROTOCOL).toBe(LOCAL_PROTOCOL);
  });

  it("NEXT_PUBLIC_FACTORY overrides it", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN", "mainnet");
    vi.stubEnv("NEXT_PUBLIC_FACTORY", "0x00000000000000000000000000000000000000f1");
    const { PROTOCOL } = await import("../protocol");
    expect(PROTOCOL?.factory).toBe("0x00000000000000000000000000000000000000f1");
  });

  it("case links go to Kleros Court", async () => {
    const { caseUrl } = await import("../protocol");
    expect(caseUrl(1, 1234n)).toBe("https://court.kleros.io/cases/1234");
  });
});
