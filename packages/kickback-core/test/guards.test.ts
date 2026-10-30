// The checks that refuse a deploy, a log scan or a batch before anything is sent, at their exact boundaries.
import { parseEther } from "viem";
import { describe, expect, test, vi } from "vitest";

import * as core from "../src";
import { assertBatchable } from "../src/lists";

import { read } from "./docs";

const ORGANISER = "0x259a1084C2043a7B3b5b288596E05C41b8EFa5d6";
const OTHER = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const GENERIC_TEXT = read(core.GENERIC_METAEVIDENCE_TEMPLATE);
const POLICY = core.ipfsPathOf(read(core.GENERIC_POLICY));
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
const MAINNET: core.NetworkInput = { chainId: 1, explorer: "https://etherscan.io", kleros: { policyURI: POLICY } };
const WEEK = core.MIN_SETTLEMENT_WINDOW;

describe("deploy", () => {
  const cfg = core.newEventConfig(FORM, MAINNET, ORGANISER);

  test("the settlement deadline may be exactly 7 days after the start, not a second less", () => {
    const start = cfg.eventStartTs!;
    expect(() => core.deploySettings({ ...cfg, claimDeadlineTs: start + WEEK }, ORGANISER)).not.toThrow();
    expect(() => core.deploySettings({ ...cfg, claimDeadlineTs: start + WEEK - 1 }, ORGANISER)).toThrow(
      /claimDeadline must be at least 7 days after eventStart/,
    );
    const at = (s: number) => new Date(Date.parse(FORM.eventStart) + s * 1000).toISOString();
    expect(core.newEventConfig({ ...FORM, claimDeadline: at(WEEK) }, MAINNET, ORGANISER).claimDeadlineTs).toBe(
      start + WEEK,
    );
    expect(() => core.newEventConfig({ ...FORM, claimDeadline: at(WEEK - 1) }, MAINNET, ORGANISER)).toThrow(
      /at least 7 days after the event starts/,
    );
  });

  test("the deposit: more than 0, at most 1 ETH on the form", () => {
    expect(core.newEventConfig({ ...FORM, deposit: core.MAX_DEPOSIT_ETH }, MAINNET, ORGANISER).depositUnits).toBe(
      parseEther(core.MAX_DEPOSIT_ETH),
    );
    expect(() => core.newEventConfig({ ...FORM, deposit: "1.000000000000000001" }, MAINNET, ORGANISER)).toThrow(
      /more than 1 ETH per guest looks like a mistake/,
    );
    const raw = { chain: "local", chainId: 31337, receiver: OTHER };
    expect(core.normalizeConfig({ ...raw, deposit: "0.000000000000000001" }).depositUnits).toBe(1n);
    expect(() => core.normalizeConfig({ ...raw, deposit: "0" })).toThrow(
      /"deposit" in config\.json must be more than 0 ETH/,
    );
  });

  test("Kleros: at least one juror", () => {
    expect(core.klerosConfig({ chainId: 1, kleros: { jurors: 1 } }).jurors).toBe(1);
    expect(() => core.klerosConfig({ chainId: 1, kleros: { jurors: 0 } })).toThrow(
      /"kleros\.jurors" must be a whole number/,
    );
  });

  test("every earlier juror policy is refused, wherever it sits in the path", () => {
    expect(core.STALE_PINS).toHaveLength(3);
    for (const pin of core.STALE_PINS)
      expect(
        () => core.deploySettings({ ...cfg, kleros: { policyURI: `/ipfs/${pin}/policy.md` } }, ORGANISER),
        pin,
      ).toThrow(/is an earlier version of the juror policy/);
    expect(() => core.deploySettings(cfg, ORGANISER)).not.toThrow();
  });

  test("the deploying wallet must be the config's owner", () => {
    expect(() => core.deploySettings(cfg, ORGANISER.toLowerCase())).not.toThrow();
    expect(() => core.deployArgs(cfg, OTHER, GENERIC_TEXT)).toThrow(
      `The deploying wallet ${OTHER} is not the owner in the config (${ORGANISER})`,
    );
  });

  test("a case description template must name the challenged wallet", () => {
    const values = core.templateValues(cfg, ORGANISER);
    const noWallet = GENERIC_TEXT.replaceAll("{{walletLower}}", "x").replaceAll("{{wallet}}", "x");
    expect(() => core.caseTemplate(noWallet, values)).toThrow(
      /^The case description template must name the challenged wallet \(\{\{wallet\}\}\)$/,
    );
  });
});

describe("log scans", () => {
  test("a chunk size that is not a whole number of blocks is refused before any request", async () => {
    const getLogs = vi.fn(async () => []);
    for (const step of [0, -1, 2.5, Number.NaN])
      await expect(core.getLogsChunked({ getLogs }, 0, 10, step), String(step)).rejects.toThrow(
        /the chunk size must be a whole number of blocks, 1 or more/,
      );
    expect(getLogs).not.toHaveBeenCalled();
    expect(await core.getLogsChunked({ getLogs }, 0, 10, 1)).toEqual([]);
    expect(getLogs).toHaveBeenCalledTimes(11);
  });
});

describe("batches", () => {
  test("a wallet listed twice (in any case) or 0x0 stops the lists from being written", () => {
    expect(() => assertBatchable([ORGANISER, OTHER])).not.toThrow();
    expect(() => assertBatchable([ORGANISER, OTHER, ORGANISER.toLowerCase()])).toThrow(/listed twice \(or is 0x0\)/);
    expect(() => assertBatchable([OTHER, "0x0000000000000000000000000000000000000000"])).toThrow(/listed twice/);
  });
});

describe("Luma columns", () => {
  test("config.columns wins over the detected columns", () => {
    const headers = ["Name", "Email", "eth_address", "Wallet (for payouts)", "tx"];
    expect(core.detectColumns(headers).wallet).toBe("eth_address");
    expect(core.detectColumns(headers, { wallet: "Wallet (for payouts)" })).toMatchObject({
      wallet: "Wallet (for payouts)",
      email: "Email",
      tx: "tx",
    });
  });
});
