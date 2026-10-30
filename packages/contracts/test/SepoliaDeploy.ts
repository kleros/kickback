import { rejects } from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseEther } from "viem";

import { genericPolicyText } from "../generated/docs";
import { kickbackAbi, mockArbitrableProxyAbi } from "../generated/index";
import { DAY, ipfsPathOf } from "../local";
import { type SepoliaDeployment } from "../tasks/deploySepolia";
import { exportAbis } from "../tasks/exportAbis";

describe("Sepolia deployment", function () {
  let dir: string;
  let output: string;

  beforeEach(function () {
    dir = mkdtempSync(path.join(tmpdir(), "kickback-sepolia-"));
    output = path.join(dir, "sepolia.json");
  });

  afterEach(function () {
    rmSync(dir, { recursive: true, force: true });
  });

  const deploy = (args = {}): Promise<SepoliaDeployment> =>
    hre.run("deploy-sepolia-kleros", { output, testOnlyAllowHardhat: true, ...args });

  it("refuses chain 31337 without the test-only override, even with --force", async function () {
    const client = await hre.viem.getPublicClient();
    const before = await client.getBlockNumber({ cacheTime: 0 });
    await rejects(deploy({ testOnlyAllowHardhat: false, force: true }), /requires chainId 11155111; got 31337/);
    expect(existsSync(output)).to.equal(false);
    expect(await client.getBlockNumber({ cacheTime: 0 })).to.equal(before);
  });

  it("refuses the default manifest path with the test-only override", async function () {
    await rejects(hre.run("deploy-sepolia-kleros", { testOnlyAllowHardhat: true }), /requires a separate output path/);
  });

  it("deploys linked mocks and writes confirmed transaction hashes to a temporary manifest", async function () {
    const out = await deploy();
    const client = await hre.viem.getPublicClient();
    const [wallet] = await hre.viem.getWalletClients();
    expect(JSON.parse(readFileSync(output, "utf8"))).to.deep.equal(out);
    expect(Object.keys(out).sort()).to.deep.equal(
      ["chainId", "klerosLiquid", "disputeResolver", "deployBlock", "deployer", "txs"].sort(),
    );
    expect(out.chainId).to.equal(31337);
    expect(out.deployer).to.equal(getAddress(wallet!.account.address));
    for (const name of ["klerosLiquid", "disputeResolver"] as const) {
      const receipt = await client.getTransactionReceipt({ hash: out.txs[name] });
      expect(receipt.status).to.equal("success");
      expect(getAddress(receipt.contractAddress!)).to.equal(out[name]);
      expect(await client.getCode({ address: out[name] })).not.to.equal("0x");
      if (name === "klerosLiquid") expect(Number(receipt.blockNumber)).to.equal(out.deployBlock);
    }
    expect(
      await client.readContract({
        address: out.disputeResolver,
        abi: mockArbitrableProxyAbi,
        functionName: "arbitrator",
      }),
    ).to.equal(out.klerosLiquid);
  });

  it("refuses existing addresses without sending transactions and replaces them only with --force", async function () {
    const out = await deploy();
    const client = await hre.viem.getPublicClient();
    const before = await client.getBlockNumber({ cacheTime: 0 });
    await rejects(deploy(), /use --force/);
    expect(await client.getBlockNumber({ cacheTime: 0 })).to.equal(before);
    expect(JSON.parse(readFileSync(output, "utf8"))).to.deep.equal(out);
    const replacement = await deploy({ force: true });
    expect(replacement.klerosLiquid).not.to.equal(out.klerosLiquid);
    expect(JSON.parse(readFileSync(output, "utf8"))).to.deep.equal(replacement);
  });

  it("refuses a manifest containing only one existing mock address", async function () {
    writeFileSync(output, JSON.stringify({ disputeResolver: "0x0000000000000000000000000000000000000001" }));
    await rejects(deploy(), /use --force/);
  });

  it("deploys the sample event using the same mocks, 0.001 ETH, start +2 days and deadline start +7 days", async function () {
    const out = await deploy({ event: true });
    const client = await hre.viem.getPublicClient();
    const sample = out.sampleEvent!;
    expect(JSON.parse(readFileSync(output, "utf8"))).to.deep.equal(out);
    const receipt = await client.getTransactionReceipt({ hash: sample.tx });
    expect(receipt.status).to.equal("success");
    expect(Number(receipt.blockNumber)).to.equal(sample.deployBlock);
    expect(getAddress(receipt.contractAddress!)).to.equal(sample.address);
    const read = <
      F extends "depositAmount" | "eventStart" | "claimDeadline" | "disputeResolver" | "arbitrator" | "policyURI",
    >(
      functionName: F,
    ) => client.readContract({ address: sample.address, abi: kickbackAbi, functionName });
    const resolverReceipt = await client.getTransactionReceipt({ hash: out.txs.disputeResolver });
    const now = (await client.getBlock({ blockNumber: resolverReceipt.blockNumber })).timestamp;
    expect(await read("depositAmount")).to.equal(parseEther("0.001"));
    expect(await read("eventStart")).to.equal(now + BigInt(2 * DAY));
    expect(await read("claimDeadline")).to.equal(now + BigInt(9 * DAY));
    expect(await read("disputeResolver")).to.equal(out.disputeResolver);
    expect(await read("arbitrator")).to.equal(out.klerosLiquid);
    expect(await read("policyURI")).to.equal(ipfsPathOf(genericPolicyText));
    const [text] = await client.readContract({
      address: sample.address,
      abi: kickbackAbi,
      functionName: "caseMetaEvidence",
      args: [out.deployer],
    });
    expect(text).to.include("Kickback Sepolia");
    expect(text).to.include("https://sepolia.etherscan.io");
    expect(text).not.to.include("{{");
  });

  it("exports testnets.sepolia as null when the manifest is absent", async function () {
    await exportAbis(hre, { sepoliaFile: output, outputDir: dir });
    expect(readFileSync(path.join(dir, "index.ts"), "utf8")).to.include(
      'export const testnets = {"sepolia":null} as const;',
    );
  });

  it("exports the contents of an existing Sepolia manifest", async function () {
    const out = await deploy({ event: true });
    await exportAbis(hre, { sepoliaFile: output, outputDir: dir });
    expect(readFileSync(path.join(dir, "index.ts"), "utf8")).to.include(
      `export const testnets = ${JSON.stringify({ sepolia: out })} as const;`,
    );
  });
});
