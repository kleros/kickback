import { hardhat, mainnet, type Chain } from "viem/chains";

/**
 * Which chain the app runs against, from NEXT_PUBLIC_CHAIN:
 * - `mainnet`: Ethereum, the live event.
 * - `hardhat`: a local Hardhat node (chainId 31337).
 * - `mainnet-fork`: a local node forking Ethereum, so it answers as chainId 1.
 */
export const CHAIN_MODES = ["mainnet", "hardhat", "mainnet-fork"] as const;

export type ChainMode = (typeof CHAIN_MODES)[number];

/** Unset follows NODE_ENV: a development build runs against the local node. */
export const parseChainMode = (value: string | undefined, nodeEnv: string | undefined): ChainMode => {
  if (value === undefined || value === "") return nodeEnv === "production" ? "mainnet" : "hardhat";
  const mode = CHAIN_MODES.find((each) => each === value);
  if (!mode) throw new Error(`NEXT_PUBLIC_CHAIN="${value}": use one of ${CHAIN_MODES.join(", ")}`);
  return mode;
};

// Read directly, not through `env`: this module must import without the full NEXT_PUBLIC set.
export const CHAIN_MODE = parseChainMode(process.env.NEXT_PUBLIC_CHAIN, process.env.NODE_ENV);

export const LOCAL_RPC_URL = process.env.NEXT_PUBLIC_LOCAL_RPC_URL || "http://127.0.0.1:8545";

export const MAINNET_DEFAULT_RPC = "https://rpc.mevblocker.io";

const mainnetRpcOverride = process.env.NEXT_PUBLIC_MAINNET_RPC || undefined;

/** The one RPC a mainnet-id chain is read and sent through: the fork's node, the env override, or the default. */
export const mainnetRpcUrl = (mode: ChainMode, override: string | undefined): string =>
  mode === "mainnet-fork" ? LOCAL_RPC_URL : (override ?? MAINNET_DEFAULT_RPC);

export const MAINNET_RPC_URL = mainnetRpcUrl(CHAIN_MODE, mainnetRpcOverride);

const LOCAL_NODE = /^https?:\/\/(127\.0\.0\.1|localhost)([:/]|$)/;

export const isLocalChainEnabled = CHAIN_MODE === "hardhat";

/** A fork answers as chainId 1, so only the dev wallet can be trusted to send to it rather than to Ethereum. */
export const isDevWalletOnly = CHAIN_MODE === "mainnet-fork";

/** Hardhat unlocks its accounts, so the dev wallet works wherever the chain is a local node. */
export const isDevWalletEnabled = isLocalChainEnabled || LOCAL_NODE.test(MAINNET_RPC_URL);

// a send on a fork can take longer than viem's default while the node fetches remote state,
// and a send that times out client-side may still mine
export const rpcTimeoutMs = (url: string): number | undefined => (LOCAL_NODE.test(url) ? 120_000 : undefined);

/**
 * The chain objects carry the RPC the app uses: wagmi's mock connector and AppKit send through
 * `rpcUrls.default`, which would otherwise be viem's public endpoint or Hardhat's fixed port.
 */
const withRpc = <T extends Chain>(chain: T, url: string): T => ({
  ...chain,
  rpcUrls: { ...chain.rpcUrls, default: { http: [url] } },
});

export const LOCAL_CHAIN = withRpc(hardhat, LOCAL_RPC_URL);

export const MAINNET_CHAIN = withRpc(mainnet, MAINNET_RPC_URL);

export const DEFAULT_CHAIN = isLocalChainEnabled ? LOCAL_CHAIN : MAINNET_CHAIN;

export const DEFAULT_CHAIN_ID = DEFAULT_CHAIN.id;

export const SUPPORTED_CHAINS = [DEFAULT_CHAIN] as const;
