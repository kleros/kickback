import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    t.expect(chains.isDevWalletOnly).toBe(false);
  });

  it("mainnet: chainId 1 on MEV Blocker unless overridden, no dev wallet", async (t) => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN", "mainnet");
    const chains = await import("../chains");
    t.expect(chains.DEFAULT_CHAIN_ID).toBe(1);
    t.expect(chains.DEFAULT_CHAIN.rpcUrls.default.http).toEqual(["https://rpc.mevblocker.io"]);
    t.expect(chains.isDevWalletEnabled).toBe(false);
    t.expect(chains.isDevWalletOnly).toBe(false);
  });

  it("mainnet: an empty env RPC, as .env.example ships it, keeps the default", async (t) => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN", "mainnet");
    vi.stubEnv("NEXT_PUBLIC_MAINNET_RPC", "");
    const chains = await import("../chains");
    t.expect(chains.MAINNET_RPC_URL).toBe("https://rpc.mevblocker.io");
    t.expect(chains.DEFAULT_CHAIN.rpcUrls.default.http).toEqual(["https://rpc.mevblocker.io"]);
  });

  it.each(["http://127.0.0.1:8545", "http://localhost:8545"])(
    "mainnet on %s, a local node answering as chainId 1, allows the dev wallet only",
    async (url) => {
      vi.stubEnv("NEXT_PUBLIC_CHAIN", "mainnet");
      vi.stubEnv("NEXT_PUBLIC_MAINNET_RPC", url);
      const chains = await import("../chains");
      expect(chains.DEFAULT_CHAIN_ID).toBe(1);
      expect(chains.isDevWalletEnabled).toBe(true);
      expect(chains.isDevWalletOnly).toBe(true);
    },
  );

  it.each(["https://localhost.example.com", "https://rpc.example.org/127.0.0.1"])(
    "mainnet on %s, a remote host that names a local one, gets no dev wallet",
    async (url) => {
      vi.stubEnv("NEXT_PUBLIC_CHAIN", "mainnet");
      vi.stubEnv("NEXT_PUBLIC_MAINNET_RPC", url);
      const chains = await import("../chains");
      expect(chains.MAINNET_RPC_URL).toBe(url);
      expect(chains.isDevWalletEnabled).toBe(false);
      expect(chains.isDevWalletOnly).toBe(false);
    },
  );

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
    t.expect(chains.isDevWalletOnly).toBe(true);
  });

  it("mainnet-fork through a remote URL: still the dev wallet only, so a real wallet cannot reach Ethereum", async (t) => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN", "mainnet-fork");
    vi.stubEnv("NEXT_PUBLIC_LOCAL_RPC_URL", "https://fork.example.com");
    const chains = await import("../chains");
    t.expect(chains.isDevWalletEnabled).toBe(false);
    t.expect(chains.isDevWalletOnly).toBe(true);
  });
});

describe("sepolia mode", () => {
  it("NEXT_PUBLIC_CHAIN=sepolia selects chainId 11155111 on the public Sepolia RPC, no dev wallet", async (t) => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN", "sepolia");
    const chains = await import("../chains");
    t.expect(chains.CHAIN_MODE).toBe("sepolia");
    t.expect(chains.DEFAULT_CHAIN_ID).toBe(11155111);
    t.expect(chains.isSepolia).toBe(true);
    t.expect(chains.DEFAULT_CHAIN.rpcUrls.default.http).toEqual([chains.SEPOLIA_DEFAULT_RPC]);
    t.expect(chains.isDevWalletEnabled).toBe(false);
    t.expect(chains.isDevWalletOnly).toBe(false);
  });

  it("NEXT_PUBLIC_SEPOLIA_RPC replaces the default, and a local mainnet override does not leak in", async (t) => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN", "sepolia");
    vi.stubEnv("NEXT_PUBLIC_SEPOLIA_RPC", "https://sepolia.example.org/rpc");
    vi.stubEnv("NEXT_PUBLIC_MAINNET_RPC", "http://127.0.0.1:8545");
    const chains = await import("../chains");
    t.expect(chains.DEFAULT_CHAIN.rpcUrls.default.http).toEqual(["https://sepolia.example.org/rpc"]);
    t.expect(chains.isDevWalletEnabled).toBe(false);
    t.expect(chains.isDevWalletOnly).toBe(false);
  });

  it("other modes are not Sepolia", async (t) => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN", "mainnet");
    t.expect((await import("../chains")).isSepolia).toBe(false);
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

  it("keeps it on a remote host whose name or path merely contains a local one", async (t) => {
    const { rpcTimeoutMs } = await import("../chains");
    for (const url of [
      "https://localhost.example.com",
      "https://rpc.example.org/127.0.0.1",
      "http://127.0.0.1.nip.io",
    ]) {
      t.expect(rpcTimeoutMs(url)).toBeUndefined();
    }
  });
});
