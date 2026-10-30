import { http, type Transport } from "viem";
import { hardhat, mainnet } from "viem/chains";

import { LOCAL_RPC_URL, MAINNET_RPC_URL, rpcTimeoutMs } from "./chains";

/**
 * Ethereum is where the app transacts; on `mainnet-fork` its RPC is the local node.
 * Hardhat is always mapped, since a transport is an inert config object, but only
 * reachable when `SUPPORTED_CHAINS` offers it.
 */
export const transports = {
  [mainnet.id]: http(MAINNET_RPC_URL, { batch: true, timeout: rpcTimeoutMs(MAINNET_RPC_URL) }),
  [hardhat.id]: http(LOCAL_RPC_URL, { timeout: rpcTimeoutMs(LOCAL_RPC_URL) }),
} as const satisfies Record<number, Transport>;
