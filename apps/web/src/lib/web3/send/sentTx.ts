import { isAddressEqual, type Address, type Hash, type PublicClient } from "viem";

/**
 * The last transaction this browser sent to a contract, saved as soon as the wallet gave its hash, so a reload
 * while it waits for confirmation still knows about it. One record per chain and contract.
 */
export interface SentTx {
  hash: Hash;
  account: Address;
  contract: Address;
  chainId: number;
  /** Date.now() when the wallet returned the hash. */
  at: number;
  /** The wallet's nonce for it; a later transaction using this nonce means this one was replaced. */
  nonce: number | null;
}

export type SentTxOutcome = "pending" | "mined" | "failed" | "replaced" | "dropped";

/** How long a transaction the network has never seen is still given to show up. */
export const DROPPED_AFTER_MS = 30 * 60_000;

export const sentTxKey = (chainId: number, contract: Address) =>
  `kickback:sent-tx:${chainId}:${contract.toLowerCase()}`;

type KeyValue = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface SentTxStore {
  save(record: SentTx): void;
  /** Forgets the record only while it is still `hash`: a newer send keeps its own. */
  forget(chainId: number, contract: Address, hash: Hash): void;
  read(chainId: number, contract: Address, account: Address): SentTx | null;
}

const isSentTx = (value: unknown): value is SentTx => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<SentTx>;
  return (
    typeof record.hash === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(record.hash) &&
    typeof record.account === "string" &&
    typeof record.contract === "string" &&
    typeof record.chainId === "number" &&
    typeof record.at === "number"
  );
};

/**
 * `storage` is localStorage in the browser. What this tab sent is also held in memory, for a browser that
 * refuses to store it (private mode, storage full).
 */
export function createSentTxStore(storage: KeyValue | undefined): SentTxStore {
  const memory = new Map<string, SentTx>();

  const readStored = (key: string): SentTx | null => {
    try {
      const value: unknown = JSON.parse(storage?.getItem(key) ?? "null");
      return isSentTx(value) ? { ...value, nonce: Number.isInteger(value.nonce) ? value.nonce : null } : null;
    } catch {
      return null;
    }
  };

  return {
    save(record) {
      const key = sentTxKey(record.chainId, record.contract);
      memory.set(key, record);
      try {
        storage?.setItem(key, JSON.stringify(record));
      } catch {
        // memory still has it
      }
    },
    forget(chainId, contract, hash) {
      const key = sentTxKey(chainId, contract);
      if (memory.get(key)?.hash === hash) memory.delete(key);
      try {
        const stored = readStored(key);
        if (!stored || stored.hash === hash) storage?.removeItem(key);
      } catch {
        // nothing stored to forget
      }
    },
    read(chainId, contract, account) {
      const key = sentTxKey(chainId, contract);
      const mine = (record: SentTx | null | undefined): record is SentTx =>
        !!record &&
        record.chainId === chainId &&
        isAddressEqual(record.contract, contract) &&
        isAddressEqual(record.account, account);
      const stored = readStored(key);
      if (mine(stored)) return stored;
      const held = memory.get(key);
      return mine(held) ? held : null;
    },
  };
}

export interface SentTxReads {
  /** The receipt as last read, or null when the network has none. */
  receipt: { status: "success" | "reverted" } | null;
  /** The account's mined transaction count, or null when not read. */
  nonceNow: number | null;
  /** Whether the network knows the transaction (mined or in its pool), or null when not asked. */
  txKnown: boolean | null;
}

/**
 * What became of a saved transaction. A later transaction that used its nonce while it is unknown means the
 * wallet replaced it (sped up or cancelled); unknown and older than DROPPED_AFTER_MS means it was dropped.
 */
export function classifySentTx(record: SentTx, reads: SentTxReads, now: number): SentTxOutcome {
  if (reads.receipt) return reads.receipt.status === "success" ? "mined" : "failed";
  if (record.nonce !== null && reads.nonceNow !== null && reads.nonceNow > record.nonce) {
    return reads.txKnown === false ? "replaced" : "pending";
  }
  if (now - record.at > DROPPED_AFTER_MS) return reads.txKnown === false ? "dropped" : "pending";
  return "pending";
}

type SentTxClient = Pick<PublicClient, "getTransactionReceipt" | "getTransactionCount" | "getTransaction">;

const orNull = <T>(read: Promise<T>): Promise<T | null> =>
  read.catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "name" in error && /NotFound/.test(String(error.name))) {
      return null;
    }
    throw error;
  });

/**
 * Reads the network about `record` in the order the outcome needs, then classifies it. A read that fails
 * leaves it pending: what cannot be told keeps blocking.
 */
export async function checkSentTx(client: SentTxClient, record: SentTx, now: number): Promise<SentTxOutcome> {
  try {
    const receipt = await orNull(client.getTransactionReceipt({ hash: record.hash }));
    if (receipt) return classifySentTx(record, { receipt, nonceNow: null, txKnown: null }, now);

    const nonceNow =
      record.nonce === null ? null : await client.getTransactionCount({ address: record.account, blockTag: "latest" });
    const nonceUsed = record.nonce !== null && nonceNow !== null && nonceNow > record.nonce;
    if (!nonceUsed && now - record.at <= DROPPED_AFTER_MS) return "pending";

    // the nonce moved on: it may be this very transaction that just mined
    const again = nonceUsed ? await orNull(client.getTransactionReceipt({ hash: record.hash })) : null;
    const txKnown = again ? true : (await orNull(client.getTransaction({ hash: record.hash }))) !== null;
    return classifySentTx(record, { receipt: again, nonceNow, txKnown }, now);
  } catch {
    return "pending";
  }
}

/** Checks the saved record and forgets it once it failed, was replaced or was dropped. */
export async function reconcileSentTx(
  client: SentTxClient,
  store: SentTxStore,
  where: { chainId: number; contract: Address; account: Address },
  now: number,
): Promise<{ record: SentTx; outcome: SentTxOutcome } | null> {
  const record = store.read(where.chainId, where.contract, where.account);
  if (!record) return null;
  const outcome = await checkSentTx(client, record, now);
  if (outcome === "failed" || outcome === "replaced" || outcome === "dropped") {
    store.forget(record.chainId, record.contract, record.hash);
  }
  return { record, outcome };
}
