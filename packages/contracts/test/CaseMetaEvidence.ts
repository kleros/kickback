import { expect } from "chai";
import { AbiCoder, ZeroAddress, dataSlice, getAddress, getBytes, keccak256, toUtf8Bytes } from "ethers";

import { ipfsCidV0, ipfsPathOf, renderCase, type CaseTemplate } from "../local/caseTemplate";
import { D, DAY, deploy, helpers, now, prov, rejects, send, setup, type Ctx } from "./fixtures/kickback";

const abiEncode = (pieces: string[], slots: string) =>
  AbiCoder.defaultAbiCoder().encode(["string[]", "bytes"], [pieces, slots]);

// Ported from kickback-legacy test/contract.test.mjs: each case's own description (metaevidence), written by
// the contract from the template kept as contract code, with its IPFS path computed on-chain as `ipfs add` does.
describe("TruthPaysKickback: case descriptions", function () {
  let ctx: Ctx;
  let h: ReturnType<typeof helpers>;
  before(async function () {
    ctx = await setup();
    h = helpers(ctx);
  });

  it("case description: bad templates are refused at deployment; the template is kept as contract code", async function () {
    const { owner, guests } = ctx;
    const t = await now();
    const o = owner.address;
    const W = 7 * DAY;
    const enc = (pieces: string[], slots: string) => getBytes(abiEncode(pieces, slots)).length;
    // the longest template the contract can keep: abi.encode(pieces, slots) under 24,576 bytes (contract code limit)
    const fill = (n: number) => "x".repeat(n);
    let n = 24_576 - enc(["", ""], "0x01");
    while (enc([fill(n), ""], "0x01") >= 24_576) n -= 1;
    const bads: CaseTemplate[] = [
      { pieces: ["a", "b"], slots: "0x" }, // one piece too many
      { pieces: ["a", "b"], slots: "0x0101" }, // one piece too few
      { pieces: ["a", "b"], slots: "0x02" }, // never names the wallet
      { pieces: ["a", "b"], slots: "0x03" }, // only the lower-case wallet: never names it checksummed
      { pieces: ["a", "b"], slots: "0x04" }, // unknown value
      { pieces: ["a", "b"], slots: "0x00" }, // unknown value
      { pieces: [fill(n + 1), ""], slots: "0x01" }, // over the contract code limit
    ];
    for (const bad of bads) {
      await rejects(deploy("TruthPaysKickback", owner, D, "x", o, t + 100, t + 100 + W, h.arb(bad)));
    }
    const k = await deploy(
      "TruthPaysKickback",
      owner,
      D,
      "x",
      o,
      t + 100,
      t + 100 + W,
      h.arb({ pieces: [fill(n), ""], slots: "0x01" }),
    );
    const g0 = guests[0]!;
    const [text, uri] = await k.caseMetaEvidence(g0.address);
    expect(text).to.equal(fill(n) + g0.address);
    expect(uri).to.equal(ipfsPathOf(text));
    // the store holds the template after a STOP byte (0x00), so calling it does nothing
    const store = await k.metaEvidenceStore();
    const code = await prov().getCode(store);
    expect(code.slice(0, 4)).to.equal("0x00");
    expect(dataSlice(code, 1)).to.equal(abiEncode([fill(n), ""], "0x01"));
    const r = await send(g0.sendTransaction({ to: store, data: "0x1234", gasLimit: 100_000 }));
    expect(r.status).to.equal(1);
    // every value: the wallet checksummed, in lower case, and the contract checksummed
    const k3 = await deploy(
      "TruthPaysKickback",
      owner,
      D,
      "x",
      o,
      t + 100,
      t + 100 + W,
      h.arb({ pieces: ["A", "B", "C", "D"], slots: "0x010302" }),
    );
    const w = "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"; // EIP-55 test vector
    const [t3] = await k3.caseMetaEvidence(w);
    expect(t3).to.equal(`A0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAedB${w}C${k3.target}D`);
    expect(t3).to.equal(renderCase({ pieces: ["A", "B", "C", "D"], slots: "0x010302" }, w, k3.target as string));
  });

  it("case description: the IPFS path matches `ipfs add` (known vectors, varint boundaries) and every wallet is checksummed", async function () {
    const { owner, guests, TPL } = ctx;
    // a known `ipfs add` result
    expect(ipfsCidV0("hello world\n")).to.equal("QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o");
    const t = await now();
    const o = owner.address;
    const g = guests[0]!.address;
    // text sizes around the protobuf varint boundaries: of the text (128, 16384) and of the UnixFS node (128, 16384)
    for (const size of [42, 121, 122, 127, 128, 129, 16_375, 16_376, 16_383, 16_384]) {
      const k = await deploy(
        "TruthPaysKickback",
        owner,
        D,
        "x",
        o,
        t + 100,
        t + 100 + 7 * DAY,
        h.arb({ pieces: ["p".repeat(size - 42), ""], slots: "0x01" }),
      );
      const [text, uri] = await k.caseMetaEvidence(g);
      expect(toUtf8Bytes(text).length).to.equal(size);
      expect(uri, `size ${size}`).to.equal("/ipfs/" + ipfsCidV0(text));
    }
    // non-ASCII text is hashed as UTF-8 bytes, like a file
    const k2 = await deploy(
      "TruthPaysKickback",
      owner,
      D,
      "x",
      o,
      t + 100,
      t + 100 + 7 * DAY,
      h.arb({ pieces: ["Mumbai — ₹ ", " / ", "."], slots: "0x0102" }),
    );
    const [t2, u2] = await k2.caseMetaEvidence(g);
    expect(t2).to.equal(`Mumbai — ₹ ${getAddress(g)} / ${k2.target}.`);
    expect(u2).to.equal(ipfsPathOf(t2));
    // EIP-55 checksums for many wallets (mixed-case patterns), the same as ethers.getAddress
    const kick = await h.freshKick();
    for (let i = 0; i < 40; i++) {
      const w = getAddress(dataSlice(keccak256(toUtf8Bytes(`wallet ${i}`)), 12));
      const [text, uri] = await kick.caseMetaEvidence(w);
      expect(text).to.equal(renderCase(TPL, w, kick.target as string));
      expect(uri).to.equal(ipfsPathOf(text));
    }
    for (const w of [ZeroAddress, "0xffffffffffffffffffffffffffffffffffffffff"])
      expect((await kick.caseMetaEvidence(w))[0]).to.equal(renderCase(TPL, w, kick.target as string));
  });
});
