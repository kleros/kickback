import type { Address, Hash, TransactionReceipt } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendLock } from "../lock";
import { SendError, sendTx, type SendDeps, type SendWallet } from "../send";
import { createSentTxStore, sentTxKey } from "../sentTx";
import { gasLimitFor, TX_GAS_CAP } from "../stubs";

const ALICE: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const BOB: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const EVENT: Address = "0xd5c6A73c05FA431c748781DaBAA99Fe2590d677D";
const HASH: Hash = `0x${"ab".repeat(32)}`;
const DEPOSIT = { to: EVENT, data: "0xd0e30db0", value: 10n ** 16n } as const;

const receipt = (status: "success" | "reverted") => ({ status, transactionHash: HASH }) as TransactionReceipt;

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
function setup(overrides: { estimate?: bigint; walletChain?: number; status?: "success" | "reverted" } = {}) {
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
    getTransactionCount: vi.fn(async () => {
      calls.push("getTransactionCount");
      return 3;
    }),
    getTransaction: vi.fn(async () => ({ nonce: 3 })),
    waitForTransactionReceipt: vi.fn(async () => {
      calls.push("waitForTransactionReceipt");
      return receipt(overrides.status ?? "success");
    }),
  };
  const wallet = {
    getAddress: vi.fn(() => account),
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
      "getTransactionCount",
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

  it("never exceeds 2^24 (EIP-7825), however large the estimate", async () => {
    expect(TX_GAS_CAP).toBe(2n ** 24n);
    const { deps, prepare, wallet } = setup({ estimate: 15_000_000n });
    await sendTx(deps, { prepare });
    expect(wallet.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ gas: 16_777_216n }));
  });

  it("is exactly the cap at the largest estimate the 30% margin fits under it", () => {
    const fits = (TX_GAS_CAP * 10n) / 13n;
    expect(gasLimitFor(fits)).toBeLessThanOrEqual(TX_GAS_CAP);
    expect(gasLimitFor(fits + 1_000n)).toBe(TX_GAS_CAP);
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
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });

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
  it("is saved with the wallet's nonce as soon as the wallet gives the hash, before the receipt", async () => {
    const { client, deps, prepare, storage } = setup();
    let seen: unknown;
    client.waitForTransactionReceipt.mockImplementationOnce(async () => {
      seen = JSON.parse(storage.map.get(sentTxKey(1, EVENT)) ?? "null");
      return receipt("success");
    });

    await sendTx(deps, { prepare });

    expect(seen).toEqual({ hash: HASH, account: ALICE, contract: EVENT, chainId: 1, at: 1_000, nonce: 3 });
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
    expect(client.getTransactionCount).not.toHaveBeenCalled();
  });
});
