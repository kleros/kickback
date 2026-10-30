import { isAddressEqual, type Address, type Hash, type Hex, type PublicClient, type TransactionReceipt } from "viem";

import { acquireSendLock, releaseSendLock } from "./lock";
import type { SentTxStore } from "./sentTx";

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
  /** The chain the wallet is on, asked of the wallet itself. */
  getChainId(): Promise<number>;
  sendTransaction(request: PinnedTxRequest): Promise<Hash>;
}

export type SendClient = Pick<
  PublicClient,
  "call" | "estimateGas" | "getTransactionCount" | "getTransaction" | "waitForTransactionReceipt"
>;

export interface SendDeps {
  client: SendClient;
  wallet: SendWallet;
  chainId: number;
  /** Turns a revert or a wallet error into plain words. */
  errorText: (error: unknown) => string;
  gasLimitFor: (estimate: bigint) => bigint;
  /** Where the sent transaction is recorded until it settles; omit to keep no record. */
  sent?: SentTxStore;
  now?: () => number;
  /** How long to wait for the receipt before reporting it unconfirmed. Ethereum: about 25 blocks. */
  receiptTimeoutMs?: number;
}

export interface SendArgs {
  /** Re-reads whatever the request depends on and builds it, right before the wallet prompt. Throw to refuse. */
  prepare: () => Promise<TxRequest>;
}

export type SendErrorKind =
  "busy" | "no-account" | "account-changed" | "refused" | "wrong-chain" | "wallet" | "reverted" | "unconfirmed";

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

  // the wallet's next nonce: a later transaction using it while this one never landed means it was replaced
  const nonce = sent
    ? await client.getTransactionCount({ address: account, blockTag: "pending" }).catch(() => null)
    : null;

  // read last, right before the prompt; pinned on the request too, so the wallet refuses any other chain
  if ((await wallet.getChainId()) !== chainId) {
    throw new SendError("wrong-chain", "Your wallet is on another network. Switch back and try again.");
  }
  stillSame();

  let hash: Hash;
  try {
    hash = await wallet.sendTransaction({ ...tx, gas: gasLimitFor(estimate), chainId });
  } catch (error) {
    throw new SendError("wallet", errorText(error), undefined, { cause: error });
  }

  if (sent) {
    const record = { hash, account, contract: tx.to, chainId, at: now(), nonce };
    sent.save(record);
    // the transaction's own nonce replaces the guess once the network knows it
    void client
      .getTransaction({ hash })
      .then((known) => {
        const current = sent.read(chainId, tx.to, account);
        if (current?.hash === hash && known.nonce !== nonce) sent.save({ ...record, nonce: known.nonce });
      })
      .catch(() => {});
  }

  let receipt: TransactionReceipt;
  try {
    receipt = await client.waitForTransactionReceipt({
      hash,
      timeout: deps.receiptTimeoutMs ?? DEFAULT_RECEIPT_TIMEOUT_MS,
    });
  } catch (error) {
    throw new SendError(
      "unconfirmed",
      "Sent, not confirmed yet. It may still go through: check it before trying again.",
      hash,
      { cause: error },
    );
  }

  if (receipt.status !== "success") {
    sent?.forget(chainId, tx.to, hash);
    throw new SendError("reverted", "It didn't go through on-chain. Only the network fee was spent.", hash);
  }
  return receipt;
}
