import type { Address, Hash } from "viem";
import { describe, expect, it, vi } from "vitest";

import {
  checkSentTx,
  classifySentTx,
  createSentTxStore,
  DROPPED_AFTER_MS,
  reconcileSentTx,
  sentTxKey,
  type SentTx,
} from "../sentTx";

const ALICE: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const BOB: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const EVENT: Address = "0xd5c6A73c05FA431c748781DaBAA99Fe2590d677D";
const OTHER_EVENT: Address = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const HASH: Hash = `0x${"ab".repeat(32)}`;
const NEWER: Hash = `0x${"cd".repeat(32)}`;
const NOW = 10_000_000;

const record = (overrides: Partial<SentTx> = {}): SentTx => ({
  hash: HASH,
  account: ALICE,
  contract: EVENT,
  chainId: 1,
  at: NOW,
  nonce: 0,
  ...overrides,
});

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

const notFound = (name: string) => Object.assign(new Error(name), { name });

/** A chain that knows only what it is told. */
function chain({
  receipt = null,
  receiptAfterNonce = receipt,
  nonce = 0,
  known = false,
}: {
  receipt?: { status: "success" | "reverted" } | null;
  receiptAfterNonce?: { status: "success" | "reverted" } | null;
  nonce?: number;
  known?: boolean;
} = {}) {
  let receiptReads = 0;
  return {
    getTransactionReceipt: vi.fn(async () => {
      const answer = receiptReads++ === 0 ? receipt : receiptAfterNonce;
      if (!answer) throw notFound("TransactionReceiptNotFoundError");
      return answer;
    }),
    getTransactionCount: vi.fn(async () => nonce),
    getTransaction: vi.fn(async () => {
      if (!known) throw notFound("TransactionNotFoundError");
      return { nonce: 0 };
    }),
  };
}

type Client = Parameters<typeof checkSentTx>[0];
const asClient = (fake: ReturnType<typeof chain>) => fake as unknown as Client;

describe("classifySentTx", () => {
  const reads = { receipt: null, nonceNow: null, txKnown: null };

  it("a receipt settles it either way", () => {
    expect(classifySentTx(record(), { ...reads, receipt: { status: "success" } }, NOW)).toBe("mined");
    expect(classifySentTx(record(), { ...reads, receipt: { status: "reverted" } }, NOW)).toBe("failed");
  });

  it("its nonce used by another transaction while it is unknown: replaced (sped up or cancelled)", () => {
    expect(classifySentTx(record(), { ...reads, nonceNow: 1, txKnown: false }, NOW)).toBe("replaced");
  });

  it("its nonce used but the network still knows it: pending", () => {
    expect(classifySentTx(record(), { ...reads, nonceNow: 1, txKnown: true }, NOW)).toBe("pending");
  });

  it("unknown 30 minutes on: dropped", () => {
    expect(DROPPED_AFTER_MS).toBe(30 * 60_000);
    const old = record({ at: NOW - DROPPED_AFTER_MS - 1 });
    expect(classifySentTx(old, { ...reads, nonceNow: 0, txKnown: false }, NOW)).toBe("dropped");
  });

  it("unknown exactly 30 minutes on: still pending", () => {
    const edge = record({ at: NOW - DROPPED_AFTER_MS });
    expect(classifySentTx(edge, { ...reads, nonceNow: 0, txKnown: false }, NOW)).toBe("pending");
  });

  it("a record stamped by a laptop clock far ahead of now ages by the gap, so it can still be dropped", () => {
    const skewed = record({ at: NOW + DROPPED_AFTER_MS + 1 });
    expect(classifySentTx(skewed, { ...reads, nonceNow: 0, txKnown: false }, NOW)).toBe("dropped");
    const slightly = record({ at: NOW + 1_000 });
    expect(classifySentTx(slightly, { ...reads, nonceNow: 0, txKnown: false }, NOW)).toBe("pending");
  });

  it("unknown a minute on: may still be on its way", () => {
    expect(classifySentTx(record({ at: NOW - 60_000 }), { ...reads, nonceNow: 0, txKnown: false }, NOW)).toBe(
      "pending",
    );
  });

  it("a record without a nonce can only be dropped by age", () => {
    const old = record({ nonce: null, at: NOW - DROPPED_AFTER_MS - 1 });
    expect(classifySentTx(old, { ...reads, txKnown: false }, NOW)).toBe("dropped");
    expect(classifySentTx(record({ nonce: null }), { ...reads, txKnown: false }, NOW)).toBe("pending");
  });
});

describe("checkSentTx against the network", () => {
  it("failed on-chain", async () => {
    await expect(checkSentTx(asClient(chain({ receipt: { status: "reverted" } })), record(), NOW)).resolves.toBe(
      "failed",
    );
  });

  it("cancelled in the wallet (a later transaction used its nonce)", async () => {
    await expect(checkSentTx(asClient(chain({ nonce: 1 })), record(), NOW)).resolves.toBe("replaced");
  });

  it("mined between the first receipt read and the nonce read: mined, not replaced", async () => {
    const fake = chain({ receipt: null, receiptAfterNonce: { status: "success" }, nonce: 1 });
    await expect(checkSentTx(asClient(fake), record(), NOW)).resolves.toBe("mined");
  });

  it("the network never saw it, 31 minutes on", async () => {
    const old = record({ at: NOW - 31 * 60_000 });
    await expect(checkSentTx(asClient(chain()), old, NOW)).resolves.toBe("dropped");
  });

  it("exactly 30 minutes on, nonce unused: pending, without asking for the transaction", async () => {
    const fake = chain();
    await expect(checkSentTx(asClient(fake), record({ at: NOW - DROPPED_AFTER_MS }), NOW)).resolves.toBe("pending");
    expect(fake.getTransaction).not.toHaveBeenCalled();
  });

  it("reads the account's mined nonce, not its pending one", async () => {
    const fake = chain();
    await checkSentTx(asClient(fake), record({ at: NOW - 60_000 }), NOW);
    expect(fake.getTransactionCount).toHaveBeenCalledWith({ address: ALICE, blockTag: "latest" });
  });

  it("a minute on, nothing yet: pending, without asking for the transaction", async () => {
    const fake = chain();
    await expect(checkSentTx(asClient(fake), record({ at: NOW - 60_000 }), NOW)).resolves.toBe("pending");
    expect(fake.getTransaction).not.toHaveBeenCalled();
  });

  it("a read that fails cannot tell: pending", async () => {
    const fake = chain();
    fake.getTransactionReceipt.mockRejectedValueOnce(new Error("429 Too Many Requests"));
    await expect(checkSentTx(asClient(fake), record({ at: 0 }), NOW)).resolves.toBe("pending");
  });
});

describe("the store", () => {
  it("one record per chain and contract, read back only for the account that sent it", () => {
    const storage = memoryStorage();
    const store = createSentTxStore(storage);
    store.save(record());
    expect(store.read(1, EVENT, ALICE)).toEqual(record());
    expect(store.read(1, EVENT, BOB)).toBeNull();
    expect(store.read(1, OTHER_EVENT, ALICE)).toBeNull();
    expect(store.read(31337, EVENT, ALICE)).toBeNull();
    expect([...storage.map.keys()]).toEqual([sentTxKey(1, EVENT)]);
  });

  it("forgetting an older hash leaves a newer send's record alone", () => {
    const storage = memoryStorage();
    const store = createSentTxStore(storage);
    store.save(record({ hash: NEWER }));
    store.forget(1, EVENT, HASH);
    expect(store.read(1, EVENT, ALICE)?.hash).toBe(NEWER);
    expect(createSentTxStore(storage).read(1, EVENT, ALICE)?.hash).toBe(NEWER);
    store.forget(1, EVENT, NEWER);
    expect(store.read(1, EVENT, ALICE)).toBeNull();
    expect(createSentTxStore(storage).read(1, EVENT, ALICE)).toBeNull();
  });

  it("a record survives a reload: a fresh store reads what an earlier page saved", () => {
    const storage = memoryStorage();
    createSentTxStore(storage).save(record({ nonce: 4 }));
    expect(createSentTxStore(storage).read(1, EVENT, ALICE)).toEqual(record({ nonce: 4 }));
  });

  it.each([
    ["an account that is no address", { account: "x" }],
    ["a contract that is no address", { contract: "garbage" }],
    ["a hash that is not 32 bytes", { hash: "0xabc" }],
    ["a chain id that is no integer", { chainId: "1" }],
    ["a time that is no number", { at: "yesterday" }],
  ])("a stored record with %s is no record", async (_, broken) => {
    const storage = memoryStorage();
    storage.map.set(sentTxKey(1, EVENT), JSON.stringify({ ...record(), ...broken }));
    const store = createSentTxStore(storage);
    expect(store.read(1, EVENT, ALICE)).toBeNull();
    await expect(
      reconcileSentTx(asClient(chain()), store, { chainId: 1, contract: EVENT, account: ALICE }, NOW),
    ).resolves.toBeNull();
  });

  it.each([["3"], [3.5], [-1]])("a stored nonce of %j reads back as unknown", (nonce) => {
    const storage = memoryStorage();
    storage.map.set(sentTxKey(1, EVENT), JSON.stringify({ ...record(), nonce }));
    expect(createSentTxStore(storage).read(1, EVENT, ALICE)).toEqual(record({ nonce: null }));
  });

  it("a browser that refuses to store still remembers what this tab sent", () => {
    const store = createSentTxStore({
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    });
    store.save(record());
    expect(store.read(1, EVENT, ALICE)).toEqual(record());
  });

  it("an unreadable stored value is no record", () => {
    const storage = memoryStorage();
    storage.map.set(sentTxKey(1, EVENT), "{not json");
    expect(createSentTxStore(storage).read(1, EVENT, ALICE)).toBeNull();
  });
});

describe("reconcileSentTx", () => {
  it.each([
    ["failed", chain({ receipt: { status: "reverted" } }), record()],
    ["replaced", chain({ nonce: 1 }), record()],
    ["dropped", chain(), record({ at: NOW - 31 * 60_000 })],
  ] as const)("forgets a record that %s", async (outcome, fake, saved) => {
    const store = createSentTxStore(memoryStorage());
    store.save(saved);
    await expect(
      reconcileSentTx(asClient(fake), store, { chainId: 1, contract: EVENT, account: ALICE }, NOW),
    ).resolves.toEqual({ record: saved, outcome });
    expect(store.read(1, EVENT, ALICE)).toBeNull();
  });

  it.each([
    ["pending", chain()],
    ["mined", chain({ receipt: { status: "success" } })],
  ] as const)("keeps a record that is %s", async (outcome, fake) => {
    const store = createSentTxStore(memoryStorage());
    store.save(record());
    await expect(
      reconcileSentTx(asClient(fake), store, { chainId: 1, contract: EVENT, account: ALICE }, NOW),
    ).resolves.toMatchObject({ outcome });
    expect(store.read(1, EVENT, ALICE)).not.toBeNull();
  });

  it("nothing saved: nothing to check", async () => {
    const store = createSentTxStore(memoryStorage());
    await expect(
      reconcileSentTx(asClient(chain()), store, { chainId: 1, contract: EVENT, account: ALICE }, NOW),
    ).resolves.toBeNull();
  });
});
