import { TX_GAS_CAP } from "@kickback/core";
import {
  BaseError,
  ContractFunctionRevertedError,
  HttpRequestError,
  isAddressEqual,
  LimitExceededRpcError,
  SocketClosedError,
  TimeoutError,
  WebSocketRequestError,
  zeroAddress,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type ReplacementReason,
  type TransactionReceipt,
} from "viem";

import { acquireSendLock, noteSendLock, releaseSendLock } from "./lock";
import { learnTxNonce, type SentTx, type SentTxStore } from "./sentTx";

/** A call to `to`, or with `to` omitted a contract creation whose `data` is the bytecode plus its constructor args. */
export interface TxRequest {
  to?: Address;
  data?: Hex;
  value?: bigint;
}

/** What the wallet is asked to sign: the request with its gas limit set and the chain pinned. */
export interface PinnedTxRequest {
  account: Address;
  to?: Address;
  data: Hex;
  value: bigint;
  gas: bigint;
  chainId: number;
}

/** Deploys are recorded under this address until they mine, since the new contract's own is not known before. */
export const DEPLOY_RECORD_KEY: Address = zeroAddress;

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
  expectedAccount?: Address;
  /** Re-reads whatever the request depends on and builds it, right before the wallet prompt. Throw to refuse. */
  prepare: () => Promise<TxRequest>;
  /** Called once the wallet has signed and broadcast, before the receipt is awaited. */
  onSent?: (hash: Hash) => void;
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
  | "unconfirmed"
  /** A chain read before the wallet prompt failed: nothing was sent, and nothing about the action is wrong. */
  | "network";

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

/** The RPC did not answer (timeout, HTTP failure, dropped socket, rate limit): not a refusal by the contract. */
const isTransportError = (error: unknown) =>
  error instanceof BaseError &&
  !!error.walk(
    (e) =>
      e instanceof HttpRequestError ||
      e instanceof TimeoutError ||
      e instanceof WebSocketRequestError ||
      e instanceof SocketClosedError ||
      e instanceof LimitExceededRpcError,
  );

const networkError = (cause: unknown) =>
  new SendError("network", "The network did not answer, so nothing was sent. Try again.", undefined, { cause });

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
 * Sends one transaction, or deploys a contract when the request has no `to`: re-read, dry run, gas = estimate
 * +30% capped at 2^24, the wallet's chain checked last and pinned on the request, then the receipt (a deploy's
 * names `contractAddress`). Refuses while another send is under way.
 */
export async function sendTx(deps: SendDeps, args: SendArgs): Promise<TransactionReceipt> {
  const holder = deps.wallet.getAddress();
  if (!holder) throw new SendError("no-account", "Connect your wallet first. Nothing was sent.");
  // per account: nonces are per account, so another wallet's send in this browser does not hold this one up
  if (!acquireSendLock(holder)) throw new SendError("busy", "Another action is under way. Wait for it to finish.");
  try {
    return await sendLocked(deps, args, holder);
  } finally {
    releaseSendLock(holder);
  }
}

async function sendLocked(
  deps: SendDeps,
  { prepare, expectedAccount, onSent }: SendArgs,
  holder: Address,
): Promise<TransactionReceipt> {
  const { client, wallet, chainId, errorText, gasLimitFor, sent } = deps;
  const now = deps.now ?? Date.now;

  const account = wallet.getAddress();
  if (!account) throw new SendError("no-account", "Connect your wallet first. Nothing was sent.");

  if (expectedAccount && !isAddressEqual(account, expectedAccount))
    throw new SendError("account-changed", "Your wallet switched accounts, so nothing was sent. Try again.");

  let request: TxRequest;
  try {
    request = await prepare();
  } catch (error) {
    // the app's own refusals ("The Kleros fee changed. Try again.") keep their words; viem errors get plain ones
    if (error instanceof SendError || !(error instanceof BaseError)) throw error;
    if (error.walk((e) => e instanceof ContractFunctionRevertedError))
      throw new SendError(
        "refused",
        `${errorText(error).replace(/\s*Nothing was (sent|changed)\.?$/, "")} Nothing was sent.`,
        undefined,
        { cause: error },
      );
    throw networkError(error);
  }
  const data = request.data ?? "0x";
  if (!request.to && data === "0x")
    throw new SendError("refused", "There is no contract code to deploy, so nothing was sent.");
  const tx = { account, ...(request.to ? { to: request.to } : {}), data, value: request.value ?? 0n } as const;
  const recordKey = request.to ?? DEPLOY_RECORD_KEY;
  noteSendLock(holder, { contract: recordKey });

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
    if (isTransportError(error)) throw networkError(error);
    throw new SendError(
      "refused",
      `${errorText(error).replace(/\s*Nothing was (sent|changed)\.?$/, "")} Nothing was sent.`,
      undefined,
      {
        cause: error,
      },
    );
  }

  let estimate: bigint;
  try {
    estimate = await client.estimateGas(tx);
  } catch (error) {
    if (isTransportError(error)) throw networkError(error);
    throw new SendError(
      "refused",
      `${errorText(error).replace(/\s*Nothing was (sent|changed)\.?$/, "")} Nothing was sent.`,
      undefined,
      {
        cause: error,
      },
    );
  }
  const gas = gasLimitFor(estimate);
  if (estimate > TX_GAS_CAP || gas > TX_GAS_CAP) {
    throw new SendError(
      "refused",
      `This would need a gas limit of about ${(estimate > gas ? estimate : gas).toLocaleString("en")}, more than the ` +
        `${TX_GAS_CAP.toLocaleString("en")} that one Ethereum transaction may use, so nothing was sent.`,
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
  noteSendLock(holder, { hash });
  onSent?.(hash);

  const waiting = new AbortController();
  if (sent) {
    const record: SentTx = {
      hash,
      account,
      contract: recordKey,
      chainId,
      at: now(),
      txNonce: null,
      data,
      value: tx.value.toString(),
    };
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
      "The transaction was sent but is not confirmed yet. It may still go through: check it before trying again.",
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
      sent?.forget(chainId, recordKey, account, hash);
      throw new SendError(
        "replaced",
        "Your wallet cancelled or replaced this transaction, so it did not go through.",
        hash,
      );
    }
    const current = sent?.read(chainId, recordKey, account);
    if (current?.hash === hash) sent?.save({ ...current, hash: minedHash });
  }

  if (receipt.status !== "success") {
    sent?.forget(chainId, recordKey, account, minedHash);
    throw new SendError("reverted", "The transaction failed. Only the network fee was spent.", minedHash);
  }
  if (!request.to && !receipt.contractAddress) {
    throw new SendError(
      "reverted",
      "The receipt names no new contract. Check the transaction before trying again.",
      minedHash,
    );
  }
  return receipt;
}
