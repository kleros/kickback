import { expect } from "chai";
import {
  AbiCoder,
  BaseContract,
  ContractFactory,
  Interface,
  type ContractRunner,
  parseEther,
  type ContractTransactionReceipt,
  type Log,
  type TransactionReceipt,
} from "ethers";
import hre from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import {
  gasBurnersAbi,
  gasBurnersBytecode,
  kickbackAbi,
  kickbackBytecode,
  mockArbitrableProxyAbi,
  mockArbitrableProxyBytecode,
  mockKlerosLiquidAbi,
  mockKlerosLiquidBytecode,
  testTokenAbi,
  testTokenBytecode,
  testWalletAbi,
  testWalletBytecode,
} from "../../generated/index";
import { truthPaysCaseTemplateText } from "../../generated/docs";
import { caseTemplate, templateValues, type CaseTemplate } from "../../local/caseTemplate";

/** An untyped ethers contract: methods by name (`any`, as in the ported JS), `connect` keeping the type. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type C = Omit<BaseContract, "connect"> & { connect(runner: ContractRunner | null): C } & Record<string, any>;
export type Signer = HardhatEthersSigner;
export type Addressable = string | Signer | C;

export const E = (x: string | number) => parseEther(String(x));
export const DAY = 86400;
export const D = E("0.01");
export const FEE_PER_JUROR = E("0.005");
/** Kleros fee for 3 jurors: the challenge deposit */
export const FEE = 3n * FEE_PER_JUROR;
/** General Court, 3 jurors */
export const EXTRA = AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [0, 3]);
export const POLICY = "/ipfs/QmPolicyForTests/attendance-policy.md";
export const MAX = 2n ** 256n - 1n;
export const KGAS = { gasLimit: 500_000 };
export const MODE = { Accept: 0, Refuse: 1, BurnGas: 2, Busy: 3, Reenter: 4 } as const;
/** EIP-7825: one mainnet transaction may use at most 2^24 gas, whatever the block limit. */
export const TX_GAS_CAP = 16_777_216n;
export const kickIface = new Interface(kickbackAbi);

const ARTIFACTS = {
  TruthPaysKickback: [kickbackAbi, kickbackBytecode],
  MockKlerosLiquid: [mockKlerosLiquidAbi, mockKlerosLiquidBytecode],
  MockArbitrableProxy: [mockArbitrableProxyAbi, mockArbitrableProxyBytecode],
  TestWallet: [testWalletAbi, testWalletBytecode],
  GasBurners: [gasBurnersAbi, gasBurnersBytecode],
  TestToken: [testTokenAbi, testTokenBytecode],
} as const;
export type ArtifactName = keyof typeof ARTIFACTS;

export const factory = (name: ArtifactName, signer: Signer) => {
  const [abi, bytecode] = ARTIFACTS[name];
  return new ContractFactory(abi, bytecode, signer);
};

export async function deploy(name: ArtifactName, signer: Signer, ...params: unknown[]): Promise<C> {
  const c = await factory(name, signer).deploy(...params);
  await c.waitForDeployment();
  return c as C;
}

export const prov = () => hre.ethers.provider;
export const now = async () => (await prov().getBlock("latest"))!.timestamp;
export const warp = async (s: number) => {
  await prov().send("evm_increaseTime", [s]);
  await prov().send("evm_mine", []);
};
export const addr = async (s: Addressable): Promise<string> =>
  typeof s === "string" ? s : "target" in s ? (s.target as string) : s.getAddress();
export const bal = async (a: Addressable) => prov().getBalance(await addr(a));
export const send = async (p: Promise<{ wait(): Promise<ContractTransactionReceipt | TransactionReceipt | null> }>) => {
  const r = await (await p).wait();
  if (!r) throw new Error("no receipt");
  return r;
};
export const logsOf = (r: { logs: readonly Log[] }, contract: C, name: string) =>
  r.logs
    .filter((l) => l.address.toLowerCase() === (contract.target as string).toLowerCase())
    .map((l) => contract.interface.parseLog(l))
    .filter((x) => x?.name === name)
    .map((x) => x!);

type RevertError = { revert?: { name?: string }; data?: string; info?: { error?: { data?: string } } };
/** The custom error behind a failed call, also when it bubbled up through a TestWallet. */
export function errName(e: unknown): string | undefined {
  const err = e as RevertError;
  if (err.revert?.name) return err.revert.name;
  const data = err.data ?? err.info?.error?.data;
  try {
    return kickIface.parseError(data ?? "0x")?.name;
  } catch {
    return undefined;
  }
}

export async function reverts(contract: C, method: string, params: unknown[], errorName: string) {
  try {
    await contract[method].staticCall(...params);
  } catch (e) {
    const name = errName(e);
    expect(name, `expected ${errorName}, got ${name ?? (e as Error).message}`).to.equal(errorName);
    return;
  }
  expect.fail(`${method} did not revert (expected ${errorName})`);
}

/** A plain ETH transfer to the contract (its receive function) that must fail with `errorName`. */
export async function sendReverts(kick: C, from: Addressable, value: bigint, errorName: string) {
  try {
    await prov().call({ from: await addr(from), to: kick.target as string, value });
  } catch (e) {
    expect(errName(e)).to.equal(errorName);
    return;
  }
  expect.fail(`plain transfer did not revert (expected ${errorName})`);
}

/** Resolves with the error a promise rejects with; fails when it resolves. */
export async function rejects(p: Promise<unknown>, message?: RegExp): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    if (message) expect((e as Error).message).to.match(message);
    return e;
  }
  return expect.fail("expected a rejection");
}

/** Hardhat's automine throws from sendTransaction when the mined transaction reverts: its receipt is in the latest block. */
export async function minedButReverted(p: Promise<unknown>) {
  await rejects(p);
  const block = await prov().getBlock("latest");
  const hash = block!.transactions.at(-1)!;
  const receipt = await prov().getTransactionReceipt(hash);
  expect(receipt!.status).to.equal(0);
  return receipt!;
}

export type Ctx = {
  owner: Signer;
  guests: Signer[];
  liquid: C;
  proxy: C;
  TPL: CaseTemplate;
};

/** The Kleros stand-ins and the Truth Pays case template, as the legacy suite's `before` sets them up. */
export async function setup(): Promise<Ctx> {
  const [owner, ...guests] = await hre.ethers.getSigners();
  if (!owner || guests.length < 159) throw new Error("needs 160 Hardhat accounts (networks.hardhat.accounts.count)");
  const liquid = await deploy("MockKlerosLiquid", owner);
  await send(liquid.setFeeForJuror(FEE_PER_JUROR, KGAS));
  const proxy = await deploy("MockArbitrableProxy", owner, liquid.target);
  const tpl = caseTemplate(
    truthPaysCaseTemplateText,
    templateValues(
      { eventName: "Truth Pays", depositUnits: D, explorer: "https://etherscan.io", kleros: { policyURI: POLICY } },
      owner.address,
    ),
    { name: "metaevidence.template.json" },
  );
  return { owner, guests, liquid, proxy, TPL: { pieces: tpl.pieces, slots: tpl.slots } };
}

export function helpers(ctx: Ctx) {
  const { owner, guests, proxy } = ctx;
  const arb = (t: CaseTemplate = ctx.TPL) => [proxy.target, EXTRA, t.pieces, t.slots, POLICY];
  async function freshKick({ startIn = 3600, deadlineIn = 3600 * 24 * 14 } = {}) {
    const t = await now();
    return deploy("TruthPaysKickback", owner, D, "Truth Pays", owner.address, t + startIn, t + deadlineIn, arb());
  }
  /** Post the list, let the 1-day challenge window pass, release. */
  async function settle(kick: C, att: string[], share: bigint) {
    await send(kick.postAttendance(att, share));
    await warp(DAY + 1);
    return send(kick.connect(guests[158]!).releasePayouts({ gasLimit: 3_000_000 }));
  }
  /** Plain transfers from the guests' wallets. */
  async function stake(kick: C, gs: Signer[]) {
    for (const g of gs) await send(g.sendTransaction({ to: kick.target as string, value: D }));
  }
  /** A wallet contract that deposits through deposit(), then behaves as `mode` when ETH arrives. */
  async function testWallet(kick: C, mode: number = MODE.Accept) {
    const w = await deploy("TestWallet", owner);
    await send(w.exec(kick.target, kickIface.encodeFunctionData("deposit"), { value: D }));
    if (mode !== MODE.Accept) await send(w.setMode(mode));
    return w;
  }
  /** A call from a TestWallet that must fail with `errorName` (the wallet passes the contract's error on). */
  const walletReverts = (w: C, kick: C, fn: string, args: unknown[], errorName: string) =>
    reverts({ exec: w.exec } as unknown as C, "exec", [kick.target, kickIface.encodeFunctionData(fn, args)], errorName);
  /** 4 stakers etc.: registers the slice of guests and posts the first `attendingCount` of them. */
  async function listed(slice: [number, number], attendingCount: number) {
    const kick = await freshKick({ startIn: 1 });
    const gs = guests.slice(...slice);
    await stake(kick, gs);
    await send(kick.registerStakers(await Promise.all(gs.map(addr))));
    await warp(2);
    const att = await Promise.all(gs.slice(0, attendingCount).map(addr));
    await send(kick.postAttendance(att, (D * BigInt(gs.length)) / BigInt(att.length)));
    return { kick, gs };
  }
  return { arb, freshKick, settle, stake, testWallet, walletReverts, listed };
}
