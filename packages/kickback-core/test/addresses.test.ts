// Typed addresses keep their EIP-55 checksum check (as ethers' isAddress / getAddress did); addresses and tx hashes
// read out of free text end where their hex ends.
import { parseEther, type Address } from "viem";
import { describe, expect, test, vi } from "vitest";

import * as core from "../src";

import { read } from "./docs";
import { hashOf, readClient, verifyClient } from "./stubs";

// EIP-55 test vector, and the same address with one letter's case flipped
const W = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const BAD = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD";
const UPPER = "0x" + W.slice(2).toUpperCase();
const ORGANISER = "0x259a1084C2043a7B3b5b288596E05C41b8EFa5d6";
const BAD_ORGANISER = "0x259a1084C2043a7B3b5b288596E05C41b8EFa5D6";
const GENERIC_TEXT = read(core.GENERIC_METAEVIDENCE_TEMPLATE);
const FORM = {
  eventTitle: "Onchain Justice Night",
  eventName: "Onchain Justice Night, Berlin 2027",
  eventWhen: "Friday 12 March 2027, 19:00-23:00 CET",
  eventWhere: "Main Street 1, Berlin",
  hosts: "Kleros",
  eventLink: "https://luma.com/your-event",
  deposit: "0.01",
  eventStart: "2027-03-12T19:00:00+01:00",
};
const MAINNET: core.NetworkInput = {
  chainId: 1,
  explorer: "https://etherscan.io",
  kleros: { policyURI: core.ipfsPathOf(read(core.GENERIC_POLICY)) },
};

describe("EIP-55 checksums", () => {
  test("lower case, upper case and a correct checksum pass; a mixed-case typo does not", () => {
    expect([W.toLowerCase(), UPPER, W].map(core.isAddressStrict)).toEqual([true, true, true]);
    expect([BAD, W.slice(0, -1), `${W}0`, W.slice(2), "", undefined].map(core.isAddressStrict)).toEqual([
      false, false, false, false, false, false,
    ]); // prettier-ignore
    expect(core.checkedAddress(W.toLowerCase())).toBe(W);
    expect(core.checkedAddress(UPPER)).toBe(W);
    expect(() => core.checkedAddress(BAD)).toThrow(/not a valid address \(bad checksum\?\)/);
  });

  test("the contract address of a config, of readEvent and of buildPayout", async () => {
    const raw = { chain: "local", chainId: 31337, deposit: "0.01" };
    expect(core.normalizeConfig({ ...raw, receiver: W.toLowerCase() }).receiver).toBe(W);
    expect(core.normalizeConfig({ ...raw, contract: UPPER }).receiver).toBe(W);
    expect(() => core.normalizeConfig({ ...raw, receiver: BAD })).toThrow(/must be the deposit contract's address/);
    expect(() => core.normalizeConfig({ ...raw, contract: BAD })).toThrow(/must be the deposit contract's address/);

    const getCode = vi.fn(async () => "0x");
    const client = { getCode, readContract: vi.fn() } as unknown as Parameters<typeof core.readEvent>[0];
    await expect(core.readEvent(client, BAD)).rejects.toMatchObject({ code: "NOT_KICKBACK" });
    expect(getCode).not.toHaveBeenCalled();
    await expect(core.readEvent(client, W.toLowerCase())).rejects.toMatchObject({ code: "NO_KICKBACK_CONTRACT" });

    const payout = (contract: string, wallet: string) =>
      core.buildPayout({
        client: readClient({ stakers: [W], depositAmount: parseEther("0.01") }),
        cfg: { contract, columns: {}, depositUnits: parseEther("0.01"), deposit: "0.01", chainId: 1, explorer: "" },
        checkins: core.parseCsv(`email,checked_in_at\nw@x.io,2027-03-12T19:30:00Z\n`),
        verified: [{ wallet, name: "W", email: "w@x.io", approval: "approved" }],
      });
    expect((await payout(ORGANISER.toLowerCase(), W)).plan.attendees).toEqual([W]);
    await expect(payout(BAD_ORGANISER, W)).rejects.toThrow(/bad checksum/);
    await expect(payout(ORGANISER, BAD)).rejects.toThrow(/bad checksum/);
  });

  test("the owner of a new event, its constructor argument and its case description", () => {
    expect(() => core.newEventConfig(FORM, MAINNET, BAD_ORGANISER)).toThrow(/Connect your wallet first/);
    const cfg = core.newEventConfig(FORM, MAINNET, ORGANISER.toLowerCase());
    expect(cfg.owner).toBe(ORGANISER);
    expect(core.deployArgs(cfg, ORGANISER.toLowerCase(), GENERIC_TEXT)[2]).toBe(ORGANISER);
    expect(() => core.deployArgs(cfg, BAD_ORGANISER, GENERIC_TEXT)).toThrow(/bad checksum/);
    // a config owner with a broken checksum is no address: the deploying wallet is the organiser (as in legacy)
    expect(core.templateValues({ ...cfg, owner: BAD }, ORGANISER).owner).toBe(ORGANISER);
    expect(() => core.deploySettings({ ...cfg, owner: BAD }, ORGANISER)).not.toThrow();
    const t = core.caseTemplate(GENERIC_TEXT, core.templateValues(cfg, ORGANISER));
    expect(core.renderCase(t, W.toLowerCase(), ORGANISER)).toContain(W);
    expect(() => core.renderCase(t, BAD, ORGANISER)).toThrow(/bad checksum/);
  });
});

describe("addresses and tx hashes in free text", () => {
  const HASH = "0x" + "ab".repeat(32);
  const HASH2 = "0x" + "cd".repeat(32);
  test("normAddress takes a whole address only: never the start of a tx hash or of a 41-digit typo", () => {
    expect(core.normAddress(`see ${W.toLowerCase()}, thanks`)).toBe(W);
    expect(core.normAddress(`https://etherscan.io/address/${W}/`)).toBe(W);
    expect(core.normAddress(`${W}${ORGANISER}`)).toBe(W);
    expect(core.normAddress("0x" + "b".repeat(64))).toBeNull();
    expect(core.normAddress("0x" + "a".repeat(41))).toBeNull();
  });
  test("extractTxHash takes a whole hash only; two hashes written together are both found", () => {
    expect(core.extractTxHash(`https://etherscan.io/tx/${HASH.toUpperCase().replace("0X", "0x")}`)).toBe(HASH);
    expect(core.extractTxHash("0x" + "a".repeat(65))).toBeNull();
    expect(core.extractTxHashes("0x" + "a".repeat(65))).toEqual([]);
    expect(core.extractTxHashes(`${HASH}${HASH2}`)).toEqual([HASH, HASH2]);
  });
  test("a tx hash pasted as the wallet is no wallet: the deposit's sender is used", async () => {
    const receiver = ORGANISER as Address;
    const client = verifyClient(receiver, { [hashOf(1)]: { from: W, amount: parseEther("0.01"), ts: 1500 } });
    const cfg = { receiver, opensAt: 1000, deadline: 2000, depositUnits: parseEther("0.01"), deposit: "0.01", decimals: 18 as const, columns: {}, explorer: "" }; // prettier-ignore
    const rows = core.parseCsv(`email,eth_address,tx link\nw@x.io,${hashOf(1)},${hashOf(1)}\n`);
    const { results } = await core.verifyRegistrations(client, cfg, rows);
    expect(results.map((r) => [r.code, r.wallet, r.inferred])).toEqual([["VERIFIED", W, true]]);
  });
});
