import assert from "node:assert/strict";

import {
  BaseContract,
  Contract,
  ContractFactory,
  Interface,
  parseEther,
  type ContractRunner,
  type InterfaceAbi,
} from "ethers";
import hre from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { caseTemplateText } from "../../generated/docs";
import * as G from "../../generated/index";
import { caseTemplate, klerosExtraData, type CaseTemplate } from "../../local/protocol";

/** An untyped ethers contract: methods by name (`any`, as in the ported JS), `connect` keeping the type. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type C = Omit<BaseContract, "connect"> & { connect(runner: ContractRunner | null): C } & Record<string, any>;
export type Signer = HardhatEthersSigner;

export const E = (x: string | number) => parseEther(String(x));
export const DAY = 86400;
export const FEE_PER_JUROR = E("0.005");
/** Kleros fee for 3 jurors: the challenge deposit */
export const FEE = 3n * FEE_PER_JUROR;
/** General Court, 3 jurors */
export const EXTRA = klerosExtraData(0n, 3n);
export const POLICY = "/ipfs/QmPolicyForTestsXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/attendance-policy.md";
export const KGAS = { gasLimit: 500_000 };

const ARTIFACTS = {
  PresenceFactory: [G.presenceFactoryAbi, G.presenceFactoryBytecode],
  PresenceEvent: [G.presenceEventAbi, G.presenceEventBytecode],
  PresenceCaseWriter: [G.presenceCaseWriterAbi, G.presenceCaseWriterBytecode],
  MockKlerosLiquid: [G.mockKlerosLiquidAbi, G.mockKlerosLiquidBytecode],
  MockArbitrableProxy: [G.mockArbitrableProxyAbi, G.mockArbitrableProxyBytecode],
  TestWallet: [G.testWalletAbi, G.testWalletBytecode],
  TestToken: [G.testTokenAbi, G.testTokenBytecode],
} as const;
export type ArtifactName = keyof typeof ARTIFACTS;

export const abiOf = (name: ArtifactName) => ARTIFACTS[name][0] as unknown as InterfaceAbi;
export const eventAbi = () => abiOf("PresenceEvent");
export const iface = new Interface([
  ...(G.presenceEventAbi as readonly unknown[]),
  ...(G.presenceFactoryAbi as readonly unknown[]),
  ...(G.presenceCaseWriterAbi as readonly unknown[]),
] as InterfaceAbi as string[]);

export async function deploy(name: ArtifactName, signer: Signer, ...params: unknown[]): Promise<C> {
  const [abi, bytecode] = ARTIFACTS[name];
  const c = await new ContractFactory(abi as unknown as InterfaceAbi, bytecode, signer).deploy(...params);
  await c.waitForDeployment();
  return c as unknown as C;
}
export const contractAt = (address: string, name: ArtifactName, runner: Signer) =>
  new Contract(address, abiOf(name), runner) as unknown as C;

export type Protocol = {
  liquid: C;
  proxy: C;
  factory: C;
  caseWriter: string;
  implementation: string;
  template: CaseTemplate;
};

/** Kleros stand-ins plus the protocol (case writer, implementation, factory). */
export async function deployAll(owner: Signer, { challengePeriod = DAY, matchPeriod = DAY } = {}): Promise<Protocol> {
  const liquid = await deploy("MockKlerosLiquid", owner);
  await (await liquid.setFeeForJuror(FEE_PER_JUROR, KGAS)).wait();
  const proxy = await deploy("MockArbitrableProxy", owner, liquid.target);
  const template = caseTemplate(caseTemplateText, {
    policyURI: POLICY,
    network: "Test chain",
    explorer: "https://explorer.example",
  });
  const writer = await deploy("PresenceCaseWriter", owner, template.pieces, template.slots);
  const impl = await deploy(
    "PresenceEvent",
    owner,
    proxy.target,
    EXTRA,
    POLICY,
    writer.target,
    challengePeriod,
    matchPeriod,
  );
  const factory = await deploy("PresenceFactory", owner, impl.target);
  return {
    liquid,
    proxy,
    factory,
    caseWriter: writer.target as string,
    implementation: impl.target as string,
    template,
  };
}

export const signers = async () => (await hre.ethers.getSigners()) as Signer[];
export const prov = () => hre.ethers.provider;

type RevertError = {
  revert?: { name?: string };
  data?: string;
  info?: { error?: { data?: string } };
  shortMessage?: string;
};
/** The custom error behind a failed call. */
export function errName(e: unknown): string | undefined {
  const err = e as RevertError;
  if (err.revert?.name) return err.revert.name;
  const data = err.data ?? err.info?.error?.data;
  try {
    return iface.parseError(data ?? "0x")?.name;
  } catch {
    return undefined;
  }
}

export async function reverts(contract: C, method: string, params: unknown[], errorName: string) {
  try {
    await contract[method].staticCall(...params);
  } catch (e) {
    assert.equal(errName(e), errorName, `expected ${errorName}, got ${errName(e) ?? (e as RevertError).shortMessage}`);
    return;
  }
  assert.fail(`${method} did not revert (expected ${errorName})`);
}
