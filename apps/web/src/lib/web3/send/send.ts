import {
  isAddressEqual,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type ReplacementReason,
  type TransactionReceipt,
} from "viem";

import { acquireSendLock, releaseSendLock } from "./lock";
import { learnTxNonce, type SentTx, type SentTxStore } from "./sentTx";
import { TX_GAS_CAP } from "./stubs";

export interface TxRequest {
  to: Address;
  data?: Hex;
  value?: bigint;
}

/** What the wallet is asked to sign: the request with its gas limit set and the chain pinned. */
export interface PinnedTxRequest extends Required<TxRequest> {
  account: Address;
  gas: bigint;
  chainId: number;
}

export interface SendWallet {
  /** The account connected right now, or undefined. */
  getAddress(): Address | undefined;
  /** Whether this is the app's dev wallet, which signs through the app's own RPC. */
  isDevWallet(): boolean;
  /** The chain the wallet is on, asked of the wallet itself. */
  getChainId(): Promise<number>;
  sendTransaction(request: PinnedTxRequest): Promise<Hash>;
}

export type SendClient = Pick<PublicClient, "call" | "estimateGas" | "getTransaction" | "waitForTransactionReceipt">;

export interface SendDeps {
  client: SendClient;
  wallet: SendWallet;
  chainId: number;
  /** Turns a revert or a wallet error into plain words. */
  errorText: (error: unknown) => string;
  /** The gas limit sent for an estimate; a limit above TX_GAS_CAP refuses the send. */
  gasLimitFor: (estimate: bigint) => bigint;
  /** Where the sent transaction is recorded until it settles; omit to keep no record. */
  sent?: SentTxStore;
  now?: () => number;
  /** How long to wait for the receipt before reporting it unconfirmed. Ethereum: about 25 blocks. */
  receiptTimeoutMs?: number;
  /** How often the read RPC is asked for the sent transaction's nonce while the receipt is awaited. */
  nonceRetryMs?: number;
  /**
   * Refuse every wallet but the dev wallet: on a local fork answering as chainId 1, any other wallet passes
   * the chain check and broadcasts to the real Ethereum.
   */
  devWalletOnly?: boolean;
}

export interface SendArgs {
  /** Re-reads whatever the request depends on and builds it, right before the wallet prompt. Throw to refuse. */
  prepare: () => Promise<TxRequest>;
}

export type SendErrorKind =
  | "busy"
  | "no-account"
  | "account-changed"
  | "refused"
  | "wrong-chain"
  | "wallet"
  | "reverted"
  | "replaced"
  | "unconfirmed";

export class SendError extends Error {
  override name = "SendError";
  constructor(
    readonly kind: SendErrorKind,
    message: string,
    readonly hash?: Hash,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

const DEFAULT_RECEIPT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_NONCE_RETRY_MS = 4_000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/** Asks for the transaction's nonce until the network knows it, the record moves on, or `signal` aborts. */
async function learnTxNonceUntil(
  client: SendClient,
  sent: SentTxStore,
  record: SentTx,
  every: number,
  signal: AbortSignal,
) {
  while (!signal.aborted) {
    const current = sent.read(record.chainId, record.contract, record.account);
    if (current?.hash !== record.hash || current.txNonce !== null) return;
    if (await learnTxNonce(client, sent, record)) return;
    await sleep(every, signal);
  }
}

/**
 * Sends one transaction: re-read, dry run, gas = estimate +30% capped at 2^24, the wallet's chain checked
 * last and pinned on the request, then the receipt. Refuses while another send is under way.
 */
export async function sendTx(deps: SendDeps, args: SendArgs): Promise<TransactionReceipt> {
  if (!acquireSendLock()) throw new SendError("busy", "Another action is under way. Wait for it to finish.");
  try {
    return await sendLocked(deps, args);
  } finally {
    releaseSendLock();
  }
}

async function sendLocked(deps: SendDeps, { prepare }: SendArgs): Promise<TransactionReceipt> {
  const { client, wallet, chainId, errorText, gasLimitFor, sent } = deps;
  const now = deps.now ?? Date.now;

  const account = wallet.getAddress();
  if (!account) throw new SendError("no-account", "Connect your wallet first. Nothing was sent.");

  const request = await prepare();
  const tx = { account, to: request.to, data: request.data ?? "0x", value: request.value ?? 0n } as const;

  const stillSame = () => {
    const current = wallet.getAddress();
    if (!current || !isAddressEqual(current, account)) {
      throw new SendError("account-changed", "Your wallet switched accounts, so nothing was sent. Try again.");
    }
  };
  stillSame();

  try {
    await client.call(tx);
  } catch (error) {
    throw new SendError("refused", `This would fail, so nothing was sent: ${errorText(error)}`, undefined, {
      cause: error,
    });
  }

  let estimate: bigint;
  try {
    estimate = await client.estimateGas(tx);
  } catch (error) {
    throw new SendError("refused", `This would fail, so nothing was sent: ${errorText(error)}`, undefined, {
      cause: error,
    });
  }
  const gas = gasLimitFor(estimate);
  if (estimate > TX_GAS_CAP || gas > TX_GAS_CAP) {
    throw new SendError(
      "refused",
      `This would need a gas limit of about ${(estimate > gas ? estimate : gas).toLocaleString("en")}, more than the ` +
        `${TX_GAS_CAP.toLocaleString("en")} one Ethereum transaction may use, so nothing was sent.`,
    );
  }

  if (deps.devWalletOnly && !wallet.isDevWallet()) {
    throw new SendError("wrong-chain", "This app runs on a local copy of Ethereum: send with the dev wallet only.");
  }
  // read last, right before the prompt; pinned on the request too, so the wallet refuses any other chain
  if ((await wallet.getChainId()) !== chainId) {
    throw new SendError("wrong-chain", "Your wallet is on another network. Switch back and try again.");
  }
  stillSame();

  let hash: Hash;
  try {
    hash = await wallet.sendTransaction({ ...tx, gas, chainId });
  } catch (error) {
    throw new SendError("wallet", errorText(error), undefined, { cause: error });
  }

  const waiting = new AbortController();
  if (sent) {
    const record: SentTx = { hash, account, contract: tx.to, chainId, at: now(), txNonce: null };
    sent.save(record);
    void learnTxNonceUntil(client, sent, record, deps.nonceRetryMs ?? DEFAULT_NONCE_RETRY_MS, waiting.signal);
  }

  let receipt: TransactionReceipt;
  let replacedBecause: ReplacementReason | undefined;
  try {
    receipt = await client.waitForTransactionReceipt({
      hash,
      timeout: deps.receiptTimeoutMs ?? DEFAULT_RECEIPT_TIMEOUT_MS,
      onReplaced: (replacement) => (replacedBecause = replacement.reason),
    });
  } catch (error) {
    throw new SendError(
      "unconfirmed",
      "Sent, not confirmed yet. It may still go through: check it before trying again.",
      hash,
      { cause: error },
    );
  } finally {
    waiting.abort();
  }

  // viem resolves with whatever transaction took this one's nonce; only a fee bump is the same call
  const minedHash = receipt.transactionHash;
  if (minedHash !== hash) {
    if (replacedBecause !== "repriced") {
      sent?.forget(chainId, tx.to, hash);
      throw new SendError("replaced", "Your wallet cancelled or replaced this transaction, so it was not done.", hash);
    }
    const current = sent?.read(chainId, tx.to, account);
    if (current?.hash === hash) sent?.save({ ...current, hash: minedHash });
  }

  if (receipt.status !== "success") {
    sent?.forget(chainId, tx.to, minedHash);
    throw new SendError("reverted", "It didn't go through on-chain. Only the network fee was spent.", minedHash);
  }
  return receipt;
}
