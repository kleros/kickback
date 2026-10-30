import type { Address, Hash, TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendLock } from "../lock";
import { SendError, sendTx, type SendDeps, type SendWallet } from "../send";
import { createSentTxStore, reconcileSentTx, sentTxKey } from "../sentTx";
import { gasLimitFor, TX_GAS_CAP } from "../stubs";

const ALICE: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const BOB: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const EVENT: Address = "0xd5c6A73c05FA431c748781DaBAA99Fe2590d677D";
const HASH: Hash = `0x${"ab".repeat(32)}`;
const REPLACEMENT: Hash = `0x${"ef".repeat(32)}`;
const DEPOSIT = { to: EVENT, data: "0xd0e30db0", value: 10n ** 16n } as const;

const receipt = (status: "success" | "reverted", transactionHash: Hash = HASH) =>
  ({ status, transactionHash }) as TransactionReceipt;

type ReplacedReason = "cancelled" | "replaced" | "repriced";
type WaitArgs = { hash: Hash; timeout?: number; onReplaced?: (replacement: { reason: ReplacedReason }) => void };

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

/** A fake chain and wallet that log every call, in order. */
function setup(
  overrides: { estimate?: bigint; walletChain?: number; status?: "success" | "reverted"; devWallet?: boolean } = {},
) {
  const calls: string[] = [];
  let account: Address | undefined = ALICE;
  const client = {
    call: vi.fn(async () => {
      calls.push("call");
      return { data: undefined };
    }),
    estimateGas: vi.fn(async () => {
      calls.push("estimateGas");
      return overrides.estimate ?? 100_000n;
    }),
    getTransactionCount: vi.fn(async (_args: { address: Address; blockTag: string }) => {
      calls.push("getTransactionCount");
      return 3;
    }),
    getTransaction: vi.fn(async (_args: { hash: Hash }) => ({ nonce: 3 })),
    waitForTransactionReceipt: vi.fn(async (_args: WaitArgs) => {
      calls.push("waitForTransactionReceipt");
      return receipt(overrides.status ?? "success");
    }),
  };
  const wallet = {
    getAddress: vi.fn(() => account),
    isDevWallet: vi.fn(() => overrides.devWallet ?? false),
    getChainId: vi.fn(async () => {
      calls.push("getChainId");
      return overrides.walletChain ?? 1;
    }),
    sendTransaction: vi.fn(async () => {
      calls.push("sendTransaction");
      return HASH;
    }),
  } satisfies SendWallet;
  const storage = memoryStorage();
  const sent = createSentTxStore(storage);
  const deps = {
    client: client as unknown as SendDeps["client"],
    wallet,
    chainId: 1,
    errorText: (error: unknown) => `plain words for ${(error as Error).message}`,
    gasLimitFor,
    sent,
    now: () => 1_000,
  } satisfies SendDeps;
  const prepare = vi.fn(async () => {
    calls.push("prepare");
    return DEPOSIT;
  });
  return { calls, client, wallet, deps, prepare, storage, sent, switchTo: (next?: Address) => (account = next) };
}

afterEach(() => {
  sendLock.setState({ busy: false });
});

describe("sendTx order", () => {
  it("re-reads, dry-runs, estimates, checks the chain last, sends pinned, then waits for the receipt", async () => {
    const { calls, deps, prepare, wallet } = setup();

    await expect(sendTx(deps, { prepare })).resolves.toMatchObject({ status: "success" });

    expect(calls).toEqual([
      "prepare",
      "call",
      "estimateGas",
      "getChainId",
      "sendTransaction",
      "waitForTransactionReceipt",
    ]);
    expect(wallet.sendTransaction).toHaveBeenCalledWith({
      account: ALICE,
      ...DEPOSIT,
      gas: 130_000n,
      chainId: 1,
    });
  });

  it("dry-runs and estimates as the connected account, with the value attached", async () => {
    const { client, deps, prepare } = setup();
    await sendTx(deps, { prepare });
    expect(client.call).toHaveBeenCalledWith({ account: ALICE, ...DEPOSIT });
    expect(client.estimateGas).toHaveBeenCalledWith({ account: ALICE, ...DEPOSIT });
  });
});

describe("gas", () => {
  it("is the estimate +30%", () => {
    expect(gasLimitFor(100_000n)).toBe(130_000n);
  });

  it("an estimate whose +30% passes 2^24 (EIP-7825) is sent with the limit clamped to 2^24", async () => {
    expect(TX_GAS_CAP).toBe(2n ** 24n);
    const { deps, prepare, wallet } = setup({ estimate: 15_000_000n });
    await expect(sendTx(deps, { prepare })).resolves.toMatchObject({ status: "success" });
    expect(wallet.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ gas: TX_GAS_CAP }));
  });

  it("an estimate at 2^24 is sent at 2^24; one above it cannot fit and is refused", async () => {
    const at = setup({ estimate: TX_GAS_CAP });
    await sendTx(at.deps, { prepare: at.prepare });
    expect(at.wallet.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ gas: TX_GAS_CAP }));

    const over = setup({ estimate: TX_GAS_CAP + 1n });
    await expect(sendTx(over.deps, { prepare: over.prepare })).rejects.toMatchObject({
      kind: "refused",
      message: expect.stringMatching(/about 16,777,217 gas.*16,777,216/),
    });
    expect(over.wallet.sendTransaction).not.toHaveBeenCalled();
  });

  it("the limit sent is the injected gasLimitFor's, and one above 2^24 is refused", async () => {
    const own = setup({ estimate: 1_000_000n });
    await sendTx({ ...own.deps, gasLimitFor: (estimate) => estimate * 2n }, { prepare: own.prepare });
    expect(own.wallet.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ gas: 2_000_000n }));

    const big = setup({ estimate: 10_000_000n });
    await expect(
      sendTx({ ...big.deps, gasLimitFor: (estimate) => estimate * 2n }, { prepare: big.prepare }),
    ).rejects.toMatchObject({ kind: "refused" });
    expect(big.wallet.sendTransaction).not.toHaveBeenCalled();
  });
});

describe("refusals before the wallet prompt", () => {
  it("a dry run that reverts is put in plain words and nothing is sent", async () => {
    const { client, deps, prepare, wallet } = setup();
    client.call.mockRejectedValueOnce(new Error("TooEarly()"));

    const error = await sendTx(deps, { prepare }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SendError);
    expect(error).toMatchObject({
      kind: "refused",
      message: "This would fail, so nothing was sent: plain words for TooEarly()",
    });
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });

  it("an estimate that fails is put in plain words and nothing is sent", async () => {
    const { client, deps, prepare, wallet } = setup();
    client.estimateGas.mockRejectedValueOnce(new Error("out of gas"));
    await expect(sendTx(deps, { prepare })).rejects.toMatchObject({
      kind: "refused",
      message: "This would fail, so nothing was sent: plain words for out of gas",
    });
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });

  it("only the dev wallet may send when the chain is a local fork answering as mainnet", async () => {
    const real = setup();
    await expect(sendTx({ ...real.deps, devWalletOnly: true }, { prepare: real.prepare })).rejects.toMatchObject({
      kind: "wrong-chain",
    });
    expect(real.wallet.sendTransaction).not.toHaveBeenCalled();

    const dev = setup({ devWallet: true });
    await expect(sendTx({ ...dev.deps, devWalletOnly: true }, { prepare: dev.prepare })).resolves.toMatchObject({
      status: "success",
    });
  });

  it("a real wallet sends when the chain is not a fork", async () => {
    const { deps, prepare, wallet } = setup();
    await sendTx(deps, { prepare });
    expect(wallet.sendTransaction).toHaveBeenCalled();
  });

  it("a wallet on another chain is refused after the dry run, right before the prompt", async () => {
    const { deps, prepare, wallet } = setup({ walletChain: 31337 });
    await expect(sendTx(deps, { prepare })).rejects.toMatchObject({ kind: "wrong-chain" });
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });

  it("an account switched while the inputs were re-read is refused", async () => {
    const setupResult = setup();
    const { deps, wallet } = setupResult;
    const prepare = vi.fn(async () => {
      setupResult.switchTo(BOB);
      return DEPOSIT;
    });
    await expect(sendTx(deps, { prepare })).rejects.toMatchObject({ kind: "account-changed" });
    expect(setupResult.client.call).not.toHaveBeenCalled();
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });

  it.each(["call", "estimateGas", "getChainId"] as const)(
    "an account switched during %s is refused right before the prompt",
    async (step) => {
      const setupResult = setup();
      const { client, deps, prepare, wallet } = setupResult;
      const mocked = step === "getChainId" ? wallet.getChainId : client[step];
      const original = mocked.getMockImplementation()!;
      mocked.mockImplementationOnce(async (...args: never[]) => {
        setupResult.switchTo(BOB);
        return (original as (...a: never[]) => Promise<never>)(...args);
      });
      await expect(sendTx(deps, { prepare })).rejects.toMatchObject({ kind: "account-changed" });
      expect(wallet.sendTransaction).not.toHaveBeenCalled();
    },
  );

  it("no connected account: refused before anything is read", async () => {
    const { deps, prepare, switchTo } = setup();
    switchTo(undefined);
    await expect(sendTx(deps, { prepare })).rejects.toMatchObject({ kind: "no-account" });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("whatever prepare throws refuses the send as it is", async () => {
    const { deps, wallet } = setup();
    const prepare = vi.fn(async () => {
      throw new Error("The deposits are closed.");
    });
    await expect(sendTx(deps, { prepare })).rejects.toThrow("The deposits are closed.");
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });

  it("a wallet refusal is put in plain words", async () => {
    const { deps, prepare, wallet } = setup();
    wallet.sendTransaction.mockRejectedValueOnce(new Error("User rejected the request."));
    await expect(sendTx(deps, { prepare })).rejects.toMatchObject({
      kind: "wallet",
      message: "plain words for User rejected the request.",
    });
  });
});

describe("one action at a time", () => {
  it("a second send while one is under way is refused without touching the chain", async () => {
    const first = setup();
    let finish!: () => void;
    first.client.waitForTransactionReceipt.mockImplementationOnce(
      () => new Promise((resolve) => (finish = () => resolve(receipt("success")))),
    );
    const running = sendTx(first.deps, { prepare: first.prepare });

    const second = setup();
    await expect(sendTx(second.deps, { prepare: second.prepare })).rejects.toMatchObject({ kind: "busy" });
    expect(second.prepare).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(first.client.waitForTransactionReceipt).toHaveBeenCalled());
    finish();
    await running;
    expect(sendLock.getState().busy).toBe(false);
  });

  it("two calls in the same tick: exactly one runs", async () => {
    const { deps, prepare } = setup();
    const results = await Promise.allSettled([sendTx(deps, { prepare }), sendTx(deps, { prepare })]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("the lock is released after a refusal", async () => {
    const { client, deps, prepare } = setup();
    client.call.mockRejectedValueOnce(new Error("revert"));
    await expect(sendTx(deps, { prepare })).rejects.toBeInstanceOf(SendError);
    expect(sendLock.getState().busy).toBe(false);
    await expect(sendTx(deps, { prepare })).resolves.toMatchObject({ status: "success" });
  });
});

describe("the pending record", () => {
  it("is saved as soon as the wallet gives the hash, before the receipt, with its nonce once known", async () => {
    const { client, deps, prepare, storage } = setup();
    client.getTransaction.mockRejectedValue(new Error("not found"));
    let seen: unknown;
    client.waitForTransactionReceipt.mockImplementationOnce(async () => {
      seen = JSON.parse(storage.map.get(sentTxKey(1, EVENT)) ?? "null");
      return receipt("success");
    });

    await sendTx(deps, { prepare });

    expect(seen).toEqual({ hash: HASH, account: ALICE, contract: EVENT, chainId: 1, at: 1_000, txNonce: null });
  });

  it("is forgotten when the transaction fails on-chain", async () => {
    const { deps, prepare, storage } = setup({ status: "reverted" });
    await expect(sendTx(deps, { prepare })).rejects.toMatchObject({ kind: "reverted", hash: HASH });
    expect(storage.map.has(sentTxKey(1, EVENT))).toBe(false);
  });

  it("is kept when no receipt comes in time: the transaction may still land", async () => {
    const { client, deps, prepare, storage } = setup();
    client.waitForTransactionReceipt.mockRejectedValueOnce(new Error("timed out"));
    await expect(sendTx(deps, { prepare })).rejects.toMatchObject({ kind: "unconfirmed", hash: HASH });
    expect(storage.map.has(sentTxKey(1, EVENT))).toBe(true);
  });

  it("is not written when the caller keeps no record", async () => {
    const { client, deps, prepare, storage } = setup();
    await sendTx({ ...deps, sent: undefined }, { prepare });
    expect(storage.map.size).toBe(0);
    expect(client.getTransaction).not.toHaveBeenCalled();
  });
});

describe("the receipt", () => {
  it("is waited for with the caller's timeout, or five minutes", async () => {
    const own = setup();
    await sendTx({ ...own.deps, receiptTimeoutMs: 42 }, { prepare: own.prepare });
    expect(own.client.waitForTransactionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ hash: HASH, timeout: 42 }),
    );

    const fallback = setup();
    await sendTx(fallback.deps, { prepare: fallback.prepare });
    expect(fallback.client.waitForTransactionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ hash: HASH, timeout: 300_000 }),
    );
  });

  it.each(["cancelled", "replaced"] as const)(
    "a transaction the wallet %s is not reported sent, and its record is forgotten",
    async (reason) => {
      const { client, deps, prepare, storage } = setup();
      client.waitForTransactionReceipt.mockImplementationOnce(async (args: WaitArgs) => {
        args.onReplaced?.({ reason });
        return receipt("success", REPLACEMENT);
      });
      await expect(sendTx(deps, { prepare })).rejects.toMatchObject({ kind: "replaced", hash: HASH });
      expect(storage.map.has(sentTxKey(1, EVENT))).toBe(false);
    },
  );

  it("a receipt for another hash, with no reason given, is not reported sent", async () => {
    const { client, deps, prepare } = setup();
    client.waitForTransactionReceipt.mockResolvedValueOnce(receipt("success", REPLACEMENT));
    await expect(sendTx(deps, { prepare })).rejects.toMatchObject({ kind: "replaced" });
  });

  it("a sped-up copy (same call, higher fee) is the same action: its receipt is returned and recorded", async () => {
    const { client, deps, prepare, storage } = setup();
    client.waitForTransactionReceipt.mockImplementationOnce(async (args: WaitArgs) => {
      args.onReplaced?.({ reason: "repriced" });
      return receipt("success", REPLACEMENT);
    });
    await expect(sendTx(deps, { prepare })).resolves.toMatchObject({ transactionHash: REPLACEMENT });
    expect(JSON.parse(storage.map.get(sentTxKey(1, EVENT))!)).toMatchObject({ hash: REPLACEMENT });
  });

  it("a sped-up copy that reverts is reported failed under its own hash", async () => {
    const { client, deps, prepare, storage } = setup();
    client.waitForTransactionReceipt.mockImplementationOnce(async (args: WaitArgs) => {
      args.onReplaced?.({ reason: "repriced" });
      return receipt("reverted", REPLACEMENT);
    });
    await expect(sendTx(deps, { prepare })).rejects.toMatchObject({ kind: "reverted", hash: REPLACEMENT });
    expect(storage.map.has(sentTxKey(1, EVENT))).toBe(false);
  });
});

describe("the recorded nonce", () => {
  const storedNonce = (storage: ReturnType<typeof memoryStorage>) =>
    (JSON.parse(storage.map.get(sentTxKey(1, EVENT)) ?? "null") as { txNonce: number | null } | null)?.txNonce;

  /** Holds the receipt until `release` is called, so the send stays in flight. */
  const holdReceipt = (client: ReturnType<typeof setup>["client"]) => {
    let release!: () => void;
    client.waitForTransactionReceipt.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(receipt("success")))),
    );
    return () => release();
  };

  it("is the transaction's own, never a guess from the account's pending count", async () => {
    const { client, deps, prepare, storage } = setup();
    client.getTransaction.mockResolvedValueOnce({ nonce: 5 });
    await sendTx(deps, { prepare });
    await vi.waitFor(() => expect(storedNonce(storage)).toBe(5));
    expect(client.getTransactionCount).not.toHaveBeenCalled();
  });

  it("is asked for again while the read RPC does not know the transaction yet", async () => {
    const { client, deps, prepare, storage } = setup();
    client.getTransaction
      .mockRejectedValueOnce(new Error("not found"))
      .mockRejectedValueOnce(new Error("not found"))
      .mockResolvedValueOnce({ nonce: 5 });
    const release = holdReceipt(client);
    const running = sendTx({ ...deps, nonceRetryMs: 1 }, { prepare });

    await vi.waitFor(() => expect(storedNonce(storage)).toBe(5));
    expect(client.getTransaction).toHaveBeenCalledTimes(3);
    release();
    await running;
  });

  it("stops asking once the receipt wait settles", async () => {
    const { client, deps, prepare } = setup();
    client.getTransaction.mockRejectedValue(new Error("not found"));
    await sendTx({ ...deps, nonceRetryMs: 1 }, { prepare });
    const asked = client.getTransaction.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(client.getTransaction.mock.calls.length).toBe(asked);
  });

  it("a transaction the read RPC never saw is not taken for replaced when the account's nonce moves on", async () => {
    const { client, deps, prepare, sent } = setup();
    client.getTransaction.mockRejectedValue(new Error("not found"));
    client.waitForTransactionReceipt.mockRejectedValueOnce(new Error("timed out"));
    await expect(sendTx(deps, { prepare })).rejects.toMatchObject({ kind: "unconfirmed" });

    // an earlier transaction of the wallet's mined, moving the account's nonce past the pending count read
    const notFound = Object.assign(new Error("missing"), { name: "TransactionNotFoundError" });
    const network = {
      getTransactionReceipt: vi.fn(async () => {
        throw Object.assign(new Error("missing"), { name: "TransactionReceiptNotFoundError" });
      }),
      getTransactionCount: vi.fn(async () => 4),
      getTransaction: vi.fn(async () => {
        throw notFound;
      }),
    };
    const checked = await reconcileSentTx(
      network as unknown as Parameters<typeof reconcileSentTx>[0],
      sent,
      { chainId: 1, contract: EVENT, account: ALICE },
      1_000 + 60_000,
    );
    expect(checked?.outcome).toBe("pending");
    expect(sent.read(1, EVENT, ALICE)?.hash).toBe(HASH);
  });

  it("a late answer about this send leaves a newer send's record alone", async () => {
    const { client, deps, prepare, sent, storage } = setup();
    let answer!: (value: { nonce: number }) => void;
    client.getTransaction.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const release = holdReceipt(client);
    const running = sendTx(deps, { prepare });
    await vi.waitFor(() => expect(client.getTransaction).toHaveBeenCalled());
    const newer = { hash: REPLACEMENT, account: ALICE, contract: EVENT, chainId: 1, at: 2_000, txNonce: null };
    sent.save(newer);
    answer({ nonce: 9 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(JSON.parse(storage.map.get(sentTxKey(1, EVENT))!)).toEqual(newer);
    release();
    await running;
  });
});
