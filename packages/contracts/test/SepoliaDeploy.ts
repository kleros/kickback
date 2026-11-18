import { rejects } from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect } from "chai";
import hre from "hardhat";
import { getAddress } from "viem";

import { mockArbitrableProxyAbi, presenceEventAbi, presenceFactoryAbi } from "../generated/index";
import { type SepoliaDeployment } from "../tasks/deploySepolia";
import { exportAbis } from "../tasks/exportAbis";

describe("Sepolia deployment", function () {
  let dir: string;
  let output: string;

  beforeEach(function () {
    dir = mkdtempSync(path.join(tmpdir(), "presence-sepolia-"));
    output = path.join(dir, "sepolia.json");
  });
  afterEach(function () {
    rmSync(dir, { recursive: true, force: true });
  });

  const deploy = (args = {}): Promise<SepoliaDeployment> =>
    hre.run("deploy-sepolia", { output, testOnlyAllowHardhat: true, ...args });

  it("refuses chain 31337 without the test-only override", async function () {
    const client = await hre.viem.getPublicClient();
    const before = await client.getBlockNumber({ cacheTime: 0 });
    await rejects(deploy({ testOnlyAllowHardhat: false, force: true }), /requires chainId 11155111; got 31337/);
    expect(existsSync(output)).to.equal(false);
    expect(await client.getBlockNumber({ cacheTime: 0 })).to.equal(before);
  });

  it("refuses the default manifest path with the test-only override", async function () {
    await rejects(hre.run("deploy-sepolia", { testOnlyAllowHardhat: true }), /requires a separate output path/);
  });

  it("deploys Kleros stand-ins and the protocol on them, and a sample event", async function () {
    const out = await deploy({ event: true });
    const client = await hre.viem.getPublicClient();
    expect(JSON.parse(readFileSync(output, "utf8"))).to.deep.equal(out);
    expect(
      await client.readContract({
        address: out.disputeResolver,
        abi: mockArbitrableProxyAbi,
        functionName: "arbitrator",
      }),
    ).to.equal(out.klerosLiquid);
    expect(
      await client.readContract({ address: out.factory!, abi: presenceFactoryAbi, functionName: "implementation" }),
    ).to.equal(out.implementation);
    expect(
      await client.readContract({
        address: out.implementation!,
        abi: presenceEventAbi,
        functionName: "disputeResolver",
      }),
    ).to.equal(out.disputeResolver);
    expect(
      await client.readContract({ address: out.sampleEvent!, abi: presenceEventAbi, functionName: "factory" }),
    ).to.equal(out.factory);
  });

  it("reuses the stand-ins already in the manifest; refuses a second protocol without --force", async function () {
    const first = await deploy();
    const { factory: _f, implementation: _i, caseWriter: _c, fromBlock: _b, policyURI: _p, ...kleros } = first;
    writeFileSync(output, JSON.stringify(kleros));
    const second = await deploy();
    expect(second.disputeResolver).to.equal(first.disputeResolver);
    expect(second.factory).not.to.equal(first.factory);
    await rejects(deploy(), /use --force/);
    const third = await deploy({ force: true });
    expect(third.disputeResolver).not.to.equal(first.disputeResolver);
  });

  it("export-abis puts each deployments-live/<network>.json into generated/index.ts", async function () {
    const deployments = path.join(dir, "deployments");
    const outDir = path.join(dir, "generated");
    mkdirSync(deployments);
    writeFileSync(
      path.join(deployments, "ethereum.json"),
      JSON.stringify({ chainId: 1, factory: getAddress("0x00000000000000000000000000000000000000f1") }),
    );
    await exportAbis(hre, { deploymentsDir: deployments, outputDir: outDir });
    const generated = readFileSync(path.join(outDir, "index.ts"), "utf8");
    expect(generated).to.include('"ethereum":{"chainId":1,"factory":"0x00000000000000000000000000000000000000f1"}');
    expect(generated).to.include("export const presenceFactoryAbi");
  });
});
