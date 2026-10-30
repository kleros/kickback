import { expect } from "chai";
import hre from "hardhat";
import {
  getAddress,
  hexToBytes,
  toEventSelector,
  toFunctionSelector,
  toHex,
  type AbiEvent,
  type AbiFunction,
  type Hex,
} from "viem";

import { disputeResolverAbi, klerosLiquidAbi } from "../../abis/kleros";
import {
  kickbackAbi,
  kickbackFingerprint,
  kickbackImmutables,
  liveEvent,
  mockArbitrableProxyAbi,
} from "../../generated/index";
import { MAINNET_KLEROS } from "../../scripts/lifecycle";
import { fingerprint } from "../../tasks/exportAbis";
import { skipUnlessForked } from "./forked";

describe("the live contract on a mainnet fork", function () {
  before(function () {
    skipUnlessForked(this);
  });

  it("has the live build's code fingerprint (eth_getCode, immutables zeroed)", async function () {
    const publicClient = await hre.viem.getPublicClient();
    const code = await publicClient.getCode({ address: liveEvent.address });
    expect(code, "no code at the live address").to.match(/^0x[0-9a-f]+$/);
    expect(fingerprint(code!, kickbackImmutables as unknown as [number, number][])).to.equal(kickbackFingerprint);
  });

  it("answers with the recorded owner, Kleros contracts and policy", async function () {
    const publicClient = await hre.viem.getPublicClient();
    const read = (functionName: "owner" | "disputeResolver" | "arbitrator" | "policyURI") =>
      publicClient.readContract({ address: liveEvent.address, abi: kickbackAbi, functionName });
    expect(getAddress(await read("owner"))).to.equal(getAddress(liveEvent.owner));
    expect(getAddress(await read("disputeResolver"))).to.equal(MAINNET_KLEROS.disputeResolver);
    expect(getAddress(await read("arbitrator"))).to.equal(MAINNET_KLEROS.arbitrator);
    expect(await read("policyURI")).to.equal(liveEvent.policyURI);
  });

  it("the Kleros contracts' code dispatches every function selector and emits every event topic in abis/kleros.ts", async function () {
    const publicClient = await hre.viem.getPublicClient();
    const check = async (address: Hex, abi: readonly (AbiFunction | AbiEvent)[]) => {
      const code = (await publicClient.getCode({ address }))!.toLowerCase();
      const missing = abi
        .map(
          (item) => [item.name, item.type === "function" ? toFunctionSelector(item) : toEventSelector(item)] as const,
        )
        .filter(([, selector]) => !code.includes(selector.slice(2)))
        .map(([name]) => name);
      expect(missing, `${address}`).to.deep.equal([]);
    };
    await check(MAINNET_KLEROS.arbitrator, klerosLiquidAbi);
    await check(MAINNET_KLEROS.disputeResolver, disputeResolverAbi);
  });

  it("the Dispute Resolver emits each event with as many topics as abis/kleros.ts and the mock declare", async function () {
    const publicClient = await hre.viem.getPublicClient();
    const code = hexToBytes((await publicClient.getCode({ address: MAINNET_KLEROS.disputeResolver }))!);
    // solc pushes the topic with PUSH32, then the first LOGn after it emits that event (n = indexed fields + 1)
    const topicsOf = new Map<string, number>();
    let pushed: string[] = [];
    for (let pc = 0; pc < code.length; pc++) {
      const op = code[pc]!;
      if (op >= 0x60 && op <= 0x7f) {
        if (op === 0x7f) pushed.push(toHex(code.slice(pc + 1, pc + 33)));
        pc += op - 0x5f;
      } else if (op >= 0xa0 && op <= 0xa4) {
        for (const t of pushed) topicsOf.set(t, op - 0xa0);
        pushed = [];
      }
    }
    const events = [...disputeResolverAbi, ...mockArbitrableProxyAbi].filter((i) => i.type === "event") as AbiEvent[];
    const declared = events.map((e) => [
      e.name,
      topicsOf.get(toEventSelector(e)),
      e.inputs.filter((i) => i.indexed).length + 1,
    ]);
    expect(declared.filter(([, got, want]) => got !== want)).to.deep.equal([]);
  });
});
