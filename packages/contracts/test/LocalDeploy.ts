import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseEther, zeroAddress } from "viem";

import { caseTemplateText, policyText } from "../generated/docs";
import { presenceEventAbi, presenceFactoryAbi } from "../generated/index";
import { DAY, deployLocalEvent, ipfsPathOf, renderCase } from "../local";
import { deployAndSeed } from "../tasks/deployLocal";

const doc = (name: string) => readFileSync(path.join(__dirname, "..", "docs", name), "utf8");

describe("deployLocalEvent", function () {
  it("generated/docs.ts holds the texts of docs/", function () {
    expect(policyText).to.equal(doc("attendance-policy.md"));
    expect(caseTemplateText).to.equal(doc("metaevidence.template.json"));
  });

  it("deploys the Kleros mocks and the protocol, then creates a 0.01 ETH event from the factory", async function () {
    const publicClient = await hre.viem.getPublicClient();
    const [walletClient] = await hre.viem.getWalletClients();
    const ev = await deployLocalEvent({ walletClient: walletClient!, publicClient });
    const read = <
      F extends "depositAmount" | "eventStart" | "eventEnd" | "claimDeadline" | "owner" | "token" | "factory",
    >(
      functionName: F,
    ) => publicClient.readContract({ address: ev.event, abi: presenceEventAbi, functionName });

    expect(await read("factory")).to.equal(ev.factory);
    expect(await read("depositAmount")).to.equal(parseEther("0.01"));
    expect(await read("token")).to.equal(zeroAddress);
    expect(await read("owner")).to.equal(getAddress(walletClient!.account.address));
    expect(BigInt(await read("eventStart"))).to.equal(ev.config.eventStart);
    expect(BigInt(await read("eventEnd"))).to.equal(ev.config.eventStart + 4n * 3600n);
    expect(BigInt(await read("claimDeadline"))).to.equal(ev.config.eventEnd + BigInt(14 * DAY));
    const [, policyURI] = await publicClient.readContract({
      address: ev.event,
      abi: presenceEventAbi,
      functionName: "arbitrationSettings",
    });
    expect(policyURI).to.equal(ipfsPathOf(policyText));
    expect(
      await publicClient.readContract({
        address: ev.factory,
        abi: presenceFactoryAbi,
        functionName: "eventsOf",
        args: [walletClient!.account.address],
      }),
    ).to.deep.equal([ev.event]);

    const wallet = "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed";
    const [text, uri] = await publicClient.readContract({
      address: ev.event,
      abi: presenceEventAbi,
      functionName: "caseMetaEvidence",
      args: [wallet],
    });
    expect(text).to.equal(
      renderCase(ev.protocol!.template, {
        staker: wallet,
        eventContract: ev.event,
        organiser: walletClient!.account.address,
        name: ev.config.name,
        url: ev.config.url,
        start: ev.config.eventStart,
        end: ev.config.eventEnd,
        depositAmount: ev.config.depositAmount,
        decimals: 18,
        symbol: "ETH",
        chainId: 31337,
      }),
    );
    expect(uri).to.equal(ipfsPathOf(text));
    expect(JSON.parse(text).fileURI).to.equal(ev.protocol!.policyURI);
  });

  it("deploy-local seeds accounts 1-4 and writes the protocol and event addresses the app reads", async function () {
    const publicClient = await hre.viem.getPublicClient();
    const [owner, ...guests] = await hre.viem.getWalletClients();
    const dir = mkdtempSync(path.join(tmpdir(), "presence-localhost-"));
    try {
      const file = path.join(dir, "localhost.json");
      const out = await deployAndSeed({ publicClient, owner: owner!, guests, file });
      expect(JSON.parse(readFileSync(file, "utf8"))).to.deep.equal(out);
      expect(out.chainId).to.equal(31337);
      expect(out.organiser).to.equal(getAddress(owner!.account.address));
      const deposits = await publicClient.getContractEvents({
        address: out.event,
        abi: presenceEventAbi,
        eventName: "Deposited",
        fromBlock: BigInt(out.fromBlock),
      });
      expect(deposits.map((l) => getAddress(l.args.staker!))).to.deep.equal(
        guests.slice(0, 4).map((g) => getAddress(g.account.address)),
      );
      expect(await publicClient.getBalance({ address: out.event })).to.equal(4n * parseEther("0.01"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
