import { connect, disconnect, mock, type MockParameters } from "@wagmi/core";

import { isUndefined } from "@/utils/is-undefined";

import { withLocalSendTimeout } from "./localSends";
import {
  isMockWalletEnabled,
  MOCK_ACCOUNTS,
  MOCK_CONNECTOR_ID,
  resolveMockAccount,
  type MockAccountRef,
} from "./mock-account";
import { wagmiConfig } from "./wagmi";

declare global {
  interface Window {
    /** Only present outside production, see `installMockWallet`. */
    __connectMockAccount?: (account: MockAccountRef, features?: MockParameters["features"]) => Promise<void>;
    /** The names `__connectMockAccount` accepts, for discovery from the console. */
    __mockAccounts?: typeof MOCK_ACCOUNTS;
    /** Only present outside production: puts the connected mock wallet on another chain, as a wallet would. */
    __setMockChainId?: (chainId: number) => Promise<void>;
  }
}

const isMock = (connector: { id: string }) => connector.id === MOCK_CONNECTOR_ID;

/**
 * Connects the app as `account` - a name from {@link MOCK_ACCOUNTS} or any address, without reloading.
 * Call it again to switch accounts.
 */
/** Attempts to make a connection stick, and how long each is given to. */
const CONNECT_ATTEMPTS = 4;
const HOLD_MS = 600;
/** How long a reconnect from storage, started when the page loaded, is waited out before connecting. */
const SETTLE_MS = 15_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const connectedAs = (address: string) =>
  wagmiConfig.state.status === "connected" &&
  [...wagmiConfig.state.connections.values()].some((connection) =>
    connection.accounts.some((account) => account.toLowerCase() === address.toLowerCase()),
  );

async function connectOnce(address: string, features?: MockParameters["features"]) {
  for (const stale of wagmiConfig.connectors.filter(isMock)) {
    await disconnect(wagmiConfig, { connector: stale }).catch(() => {});
  }
  wagmiConfig._internal.connectors.setState((connectors) => connectors.filter((existing) => !isMock(existing)));

  const connector = wagmiConfig._internal.connectors.setup(
    withLocalSendTimeout(mock({ accounts: [address as `0x${string}`], features })),
  );
  wagmiConfig._internal.connectors.setState((connectors) => [...connectors, connector]);

  await connect(wagmiConfig, { connector });
}

export const connectMockAccount = async (account: MockAccountRef, features?: MockParameters["features"]) => {
  const address = resolveMockAccount(account);

  if (!address) {
    throw new Error(`Unknown mock account "${account}", use an address or one of: ${Object.keys(MOCK_ACCOUNTS)}`);
  }

  // The provider reconnects from storage when it mounts and writes the result
  // when it finishes, which can land either side of this and undo it. Held
  // rather than assumed: the caller is about to act as this account.
  for (let waited = 0; wagmiConfig.state.status === "reconnecting" && waited < SETTLE_MS; waited += 100) {
    await sleep(100);
  }
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
    await connectOnce(address, features);
    await sleep(HOLD_MS);
    if (connectedAs(address)) return;
  }

  throw new Error(`The mock wallet would not stay connected as ${address}.`);
};

/**
 * Moves the connected mock wallet to `chainId`, including one the app does not run on. The mock answers
 * wallet_switchEthereumChain itself, where wagmi's switchChain refuses an unconfigured chain.
 */
export const setMockChainId = async (chainId: number) => {
  const connector = wagmiConfig.connectors.find(isMock);
  if (!connector) throw new Error("No mock wallet is connected.");
  const provider = (await connector.getProvider()) as {
    request: (args: { method: string; params: unknown[] }) => Promise<unknown>;
  };
  await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${chainId.toString(16)}` }] });
};

/** Publishes the hooks Playwright and hand debugging use. No-op in production. */
export const installMockWallet = () => {
  if (!isMockWalletEnabled || isUndefined(globalThis.window)) return;

  window.__connectMockAccount = connectMockAccount;
  window.__mockAccounts = MOCK_ACCOUNTS;
  window.__setMockChainId = setMockChainId;
};
