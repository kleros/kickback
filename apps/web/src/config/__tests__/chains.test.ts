import { afterEach, beforeEach, describe, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseChainMode", () => {
  it("follows NODE_ENV when unset", async (t) => {
    const { parseChainMode } = await import("../chains");
    t.expect(parseChainMode(undefined, "development")).toBe("hardhat");
    t.expect(parseChainMode("", "production")).toBe("mainnet");
  });

  it("refuses a mode it does not know", async (t) => {
    const { parseChainMode } = await import("../chains");
    t.expect(() => parseChainMode("gnosis", "development")).toThrow(/NEXT_PUBLIC_CHAIN="gnosis"/);
  });
});

describe("chain per mode", () => {
  it("hardhat: chainId 31337 on the local node", async (t) => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN", "hardhat");
    vi.stubEnv("NEXT_PUBLIC_LOCAL_RPC_URL", "http://127.0.0.1:8555");
    const chains = await import("../chains");
    t.expect(chains.DEFAULT_CHAIN_ID).toBe(31337);
    t.expect(chains.DEFAULT_CHAIN.rpcUrls.default.http).toEqual(["http://127.0.0.1:8555"]);
    t.expect(chains.isDevWalletEnabled).toBe(true);
  });

  it("mainnet: chainId 1 on MEV Blocker unless overridden, no dev wallet", async (t) => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN", "mainnet");
    const chains = await import("../chains");
    t.expect(chains.DEFAULT_CHAIN_ID).toBe(1);
    t.expect(chains.DEFAULT_CHAIN.rpcUrls.default.http).toEqual(["https://rpc.mevblocker.io"]);
    t.expect(chains.isDevWalletEnabled).toBe(false);
  });

  it("mainnet: the env RPC replaces the default", async (t) => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN", "mainnet");
    vi.stubEnv("NEXT_PUBLIC_MAINNET_RPC", "https://example.org/rpc");
    t.expect((await import("../chains")).MAINNET_RPC_URL).toBe("https://example.org/rpc");
  });

  it("mainnet-fork: chainId 1 answered by the local node, whatever the mainnet override says", async (t) => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN", "mainnet-fork");
    vi.stubEnv("NEXT_PUBLIC_MAINNET_RPC", "https://example.org/rpc");
    const chains = await import("../chains");
    t.expect(chains.DEFAULT_CHAIN_ID).toBe(1);
    t.expect(chains.DEFAULT_CHAIN.rpcUrls.default.http).toEqual(["http://127.0.0.1:8545"]);
    t.expect(chains.isDevWalletEnabled).toBe(true);
  });
});

describe("rpcTimeoutMs", () => {
  it("waits longer on a local node, whose forked state can take its time to fetch", async (t) => {
    const { rpcTimeoutMs } = await import("../chains");
    for (const url of ["http://127.0.0.1:8545", "http://localhost:8545"]) t.expect(rpcTimeoutMs(url)).toBe(120_000);
  });

  it("keeps the client's own timeout on a public endpoint", async (t) => {
    const { rpcTimeoutMs } = await import("../chains");
    t.expect(rpcTimeoutMs("https://rpc.mevblocker.io")).toBeUndefined();
  });
});
