import { readFileSync } from "node:fs";
import path from "node:path";

import { expect } from "chai";

import { fingerprint } from "../tasks/exportAbis";
import { LIVE_DIR, liveBuild, verifiedSource } from "../scripts/liveBuild";

const read = (file: string) => readFileSync(path.join(LIVE_DIR, file), "utf8").trim();

describe("TruthPaysKickback is the live mainnet build", () => {
  const live = liveBuild();

  it("has the source Etherscan verified", () => {
    expect(readFileSync(path.join(__dirname, "..", "contracts", "TruthPaysKickback.sol"), "utf8")).to.equal(
      verifiedSource(),
    );
  });

  it("compiles to the deploy transaction's creation code, followed by its constructor arguments", () => {
    const input = read("creation-input.hex");
    expect(input.slice(0, live.bytecode.length)).to.equal(live.bytecode);
    expect(input.slice(live.bytecode.length)).to.equal(read("constructor-arguments.txt").replace(/^0x/, ""));
  });

  it("has the live runtime code's fingerprint", () => {
    expect(fingerprint(read("runtime-code.hex"), live.immutables)).to.equal(
      fingerprint(live.deployedBytecode, live.immutables),
    );
  });
});
