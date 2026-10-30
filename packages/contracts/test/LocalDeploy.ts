import { readFileSync } from "node:fs";
import path from "node:path";

import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseEther } from "viem";

import { genericCaseTemplateText, genericPolicyText, truthPaysCaseTemplateText } from "../generated/docs";
import { kickbackAbi, kickbackFingerprint, kickbackImmutables } from "../generated/index";
import { DAY, deployLocalEvent, ipfsPathOf, renderCase } from "../local";
import { fingerprint } from "../tasks/exportAbis";

const doc = (name: string) => readFileSync(path.join(__dirname, "..", "docs", name), "utf8");

describe("deployLocalEvent", function () {
  it("generated/docs.ts holds the texts of docs/", function () {
    expect(genericPolicyText).to.equal(doc("attendance-policy.generic.md"));
    expect(genericCaseTemplateText).to.equal(doc("metaevidence.generic.template.json"));
    expect(truthPaysCaseTemplateText).to.equal(doc("metaevidence.template.json"));
  });

  it("deploys the mocks and the live build with the generic policy and template, 0.01 ETH, start in 3 days, 14 days to settle", async function () {
    const publicClient = await hre.viem.getPublicClient();
    const [walletClient] = await hre.viem.getWalletClients();
    const now = (await publicClient.getBlock()).timestamp;
    const ev = await deployLocalEvent({ walletClient: walletClient!, publicClient });
    const read = <
      F extends "depositAmount" | "eventStart" | "claimDeadline" | "owner" | "disputeResolver" | "policyURI",
    >(
      functionName: F,
    ) => publicClient.readContract({ address: ev.event, abi: kickbackAbi, functionName });

    const code = await publicClient.getCode({ address: ev.event });
    expect(fingerprint(code!, kickbackImmutables as unknown as [number, number][])).to.equal(kickbackFingerprint);
    expect(await read("depositAmount")).to.equal(parseEther("0.01"));
    // the mock deploys mine blocks between the read of `now` and the event deploy
    expect(Number((await read("eventStart")) - now - BigInt(3 * DAY))).to.be.within(0, 5);
    expect(await read("claimDeadline")).to.equal((await read("eventStart")) + BigInt(14 * DAY));
    expect(await read("owner")).to.equal(getAddress(walletClient!.account.address));
    expect(await read("disputeResolver")).to.equal(ev.disputeResolver);
    expect(await read("policyURI")).to.equal(ipfsPathOf(genericPolicyText));
    expect(ev.arbitrator).to.equal(
      await publicClient.readContract({
        address: ev.disputeResolver,
        abi: [
          { type: "function", name: "arbitrator", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
        ],
        functionName: "arbitrator",
      }),
    );
    expect(ev.deployBlock).to.equal(await publicClient.getBlockNumber());

    const wallet = "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed";
    const [text, uri] = await publicClient.readContract({
      address: ev.event,
      abi: kickbackAbi,
      functionName: "caseMetaEvidence",
      args: [wallet],
    });
    expect(text).to.equal(renderCase(ev.template, wallet, ev.event));
    expect(uri).to.equal(ipfsPathOf(text));
    const meta = JSON.parse(text);
    expect(meta.fileURI).to.equal(ev.policyURI);
    expect(meta.title).to.include(ev.details.eventName);
    expect(meta.aliases[walletClient!.account.address.toLowerCase()]).to.equal(
      "Organiser (the deposit contract's owner wallet)",
    );
  });
});
