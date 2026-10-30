// The checkGuests / buildPayout cases of the legacy kickback.test.mjs, against the core on a local chain: what the
// legacy scripts wrote to files is checkGuests' lists written with toCsv (CHECK_COLUMNS), and its stamped lists.
import { kickbackAbi, testTokenAbi, testTokenBytecode, testWalletAbi, testWalletBytecode } from "@kickback/contracts";
import {
  BaseError,
  ContractFunctionRevertedError,
  custom,
  encodeAbiParameters,
  encodeFunctionData,
  parseEther,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  zeroAddress,
  type Address,
  type Hash,
} from "viem";
import { beforeAll, describe, expect, test } from "vitest";

import * as core from "../src";

import { chainKit, type ChainKit } from "./chain";
import { read } from "./docs";

// Amounts in thousandths of an ETH: U(25) = 0.025 ETH.
const U = (x: number) => parseEther(String(x)) / 1000n;
const POLICY = "/ipfs/QmPolicyForTests/attendance-policy.md";
const EXTRA = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [0n, 3n]); // General Court, 3 jurors
const DAY = 86400;
const OWNER = 0;
/** Guest g is Hardhat account g + 1. */
const G = (g: number) => g + 1;

let k: ChainKit;
let liquid: Address;
let proxy: Address;
let TPL: core.CaseTemplate;

beforeAll(async () => {
  k = chainKit();
  ({ liquid, proxy } = await k.mocks());
  TPL = core.caseTemplate(
    read(core.DEFAULT_METAEVIDENCE_TEMPLATE),
    core.templateValues({
      eventName: "Truth Pays",
      depositUnits: U(25),
      explorer: "https://etherscan.io",
      owner: k.addr(OWNER),
      kleros: { policyURI: POLICY },
    }),
  );
});

const arbitration = () => ({
  disputeResolver: proxy,
  extraData: EXTRA,
  metaEvidenceTemplate: TPL.pieces,
  metaEvidenceSlots: TPL.slots,
  policyURI: POLICY,
});
const newKickback = async (deposit: bigint, name = "Truth Pays") => {
  const t = await k.now();
  const address = await k.deployKickback([
    deposit,
    name,
    k.addr(OWNER),
    BigInt(t + 3600),
    BigInt(t + 3600 + 14 * DAY),
    arbitration(),
  ]);
  return { address, deployBlock: Number(await k.client.getBlockNumber()) };
};

/** Asserts a call reverts with this custom error (a dry run). */
async function reverts(
  address: Address,
  from: number,
  functionName: string,
  args: readonly unknown[],
  errorName: string,
) {
  try {
    await k.client.simulateContract({ address, abi: kickbackAbi, functionName, args, account: k.addr(from) } as never);
  } catch (e) {
    const err = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    expect((err as ContractFunctionRevertedError | null)?.data?.errorName, `${functionName}`).toBe(errorName);
    return;
  }
  expect.fail(`${functionName} did not revert (expected ${errorName})`);
}

/** A wallet contract (like a Safe) that pays the deposit through deposit(). */
async function smartWalletDeposit(kick: Address, amount: number) {
  const wallet = await k.deploy(testWalletAbi, testWalletBytecode, []);
  const hash = await k.wallet(OWNER).writeContract({
    address: wallet,
    abi: testWalletAbi,
    functionName: "exec",
    args: [kick, encodeFunctionData({ abi: kickbackAbi, functionName: "deposit" })],
    value: U(amount),
  } as never);
  await k.mined(hash);
  return { wallet, hash };
}

const FILE_KEYS = {
  "verified.csv": "verified",
  "issues.csv": "issues",
  "to-review.csv": "toReview",
  "returns.csv": "returns",
  "claims.csv": "claims",
  "unmatched.csv": "unmatched",
} as const;

/** A contract of its own, its config, and checkGuests' lists read the way the legacy test read the scripts' files. */
async function scenario({
  deposit = 25,
  base: over = {},
  client,
}: { deposit?: number; base?: core.RawConfig; client?: ChainKit["client"] } = {}) {
  const { address: kAddr, deployBlock } = await newKickback(U(deposit));
  const base: core.RawConfig = {
    chain: "local",
    chainId: 31337,
    rpcUrl: k.rpcUrl,
    deposit: core.fmt(U(deposit)),
    receiver: kAddr,
    contract: kAddr,
    explorer: "https://example.org",
    logChunk: 7,
    depositOpensAt: "2020-01-01T00:00:00Z",
    depositDeadline: "2099-01-01T00:00:00Z",
    deployBlock,
    kleros: { disputeResolver: proxy, arbitrator: liquid },
    ...over,
  };
  let cfg = core.normalizeConfig(base);
  const config = (o: core.RawConfig = {}) => (cfg = core.normalizeConfig({ ...base, ...o }));
  let r: core.CheckGuestsResult | null = null;
  const H = "name,email,ticket_name,approval_status,checked_in_at,eth_address,Deposit tx link (Committed Spot only)";
  const verify = async (
    lines: string[],
    { header = H, scanFrom = cfg.deployBlock }: { header?: string; scanFrom?: number } = {},
  ) =>
    (r = await core.checkGuests({
      client: client ?? k.client,
      cfg,
      rows: core.parseCsv([header, ...lines].join("\n")),
      ...(scanFrom === undefined ? {} : { scanFrom }),
    }));
  const result = () => r ?? expect.fail("verify first");
  const readOut = (f: keyof typeof FILE_KEYS) => core.toCsv(result()[FILE_KEYS[f]], core.CHECK_COLUMNS[FILE_KEYS[f]]);
  const csv = (f: keyof typeof FILE_KEYS) => core.parseCsv(readOut(f));
  const list = (f: "new-stakers.json" | "refunds.json") =>
    f === "new-stakers.json" ? result().lists.newStakers : result().lists.refunds;
  const wallets = (f: "new-stakers.json" | "refunds.json") => list(f).items.map((i) => i.wallet);
  const pay = (g: number, amount: number) => k.pay(G(g), kAddr, U(amount));
  const row = (
    name: string,
    wallet: string,
    decision: string,
    tx: string,
    ticket = "Committed Spot (0.025 ETH Deposit)",
  ) => `${name},${name.toLowerCase()}@x.io,${ticket},${decision},,${wallet},${tx}`;
  const umRow = (tx: string) => result().unmatched.find((u) => u.tx === tx.toLowerCase());
  const returnsOf = () => result().returns.map((x) => [x.code, x.wallet, x.to_return]);
  return {
    kAddr,
    deployBlock,
    cfg: () => cfg,
    config,
    verify,
    result,
    readOut,
    csv,
    list,
    wallets,
    pay,
    row,
    umRow,
    returnsOf,
  };
}

const T25 = "Committed Spot (0.025 ETH Deposit)";
const FREE = "Request to Join (Free)";
const addr = (g: number) => k.addr(G(g));

describe("pure helpers", () => {
  test("CSV cells, ETH amounts, wrong-network links; chunked log scans with retries; refunds paired with the right deposit", async () => {
    expect(core.csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    for (const s of ["+1", "-5", "@SUM(A1)", "\tx"]) expect(core.csvCell(s)).toBe("'" + s);
    expect(core.csvCell("a\rb")).toBe('"a\rb"');
    expect(core.csvCell("a,b")).toBe('"a,b"');
    expect(core.csvCell("0xabc")).toBe("0xabc");
    expect(core.uncell("'=x")).toBe("=x");
    expect(core.uncell("'plain")).toBe("'plain");
    expect(core.isContractCode("0x")).toBe(false);
    expect(core.isContractCode(undefined)).toBe(false); // viem's getCode for no code
    expect(core.isContractCode(`0xef0100${"ab".repeat(20)}`)).toBe(false); // EIP-7702 wallet
    expect(core.isContractCode("0x6080604052")).toBe(true);
    // amounts people read: exact when short, "~" when rounded
    expect(core.fmtEth(U(25))).toBe("0.025 ETH");
    expect(core.fmtEth(parseEther("0.04") / 3n)).toBe("~0.013333 ETH");
    expect(core.fmtEth(3n)).toBe("0.000000000000000003 ETH"); // dust is shown in full
    expect(core.fmtEth(parseEther("1.5"))).toBe("1.5 ETH");
    expect(core.fmtEth(0n)).toBe("0.0 ETH");
    // tx links from other networks
    expect(core.otherNetworkOf("https://arbiscan.io/tx/0x12")).toBe("Arbitrum");
    expect(core.otherNetworkOf("https://basescan.org/tx/0x12")).toBe("Base");
    expect(core.otherNetworkOf("https://optimistic.etherscan.io/tx/0x12")).toBe("Optimism");
    expect(core.otherNetworkOf("https://sepolia.etherscan.io/tx/0x12")).toBe("the Sepolia test network");
    expect(core.otherNetworkOf("https://etherscan.io/tx/0x12")).toBe(null);
    expect(core.otherNetworkOf("0x12")).toBe(null);

    // A tx that is not on this chain: still pending, from another network, or unknown
    const cfg = {
      chainName: "Ethereum mainnet",
      receiver: zeroAddress,
      depositUnits: U(25),
      deposit: "0.025",
      opensAt: 0,
      deadline: Infinity,
      decimals: 18 as const,
    };
    const hash: Hash = `0x${"ab".repeat(32)}`;
    const fakeClient = (pending: boolean) =>
      ({
        getTransactionReceipt: async () => {
          throw new TransactionReceiptNotFoundError({ hash });
        },
        getTransaction: async () => {
          if (pending) return { hash };
          throw new TransactionNotFoundError({ hash });
        },
      }) as unknown as core.VerifyClient;
    expect((await core.verifyTx(fakeClient(true), cfg, hash, null, hash)).code).toBe("TX_PENDING");
    const wrong = await core.verifyTx(fakeClient(false), cfg, hash, null, `https://arbiscan.io/tx/${hash}`);
    expect(wrong.code).toBe("WRONG_NETWORK");
    expect(wrong.note).toMatch(/on Arbitrum, not Ethereum mainnet/);
    expect(wrong.note).toMatch(/etherscan\.io link/);
    const unknown = await core.verifyTx(fakeClient(false), cfg, hash, null, hash);
    expect(unknown.code).toBe("TX_NOT_FOUND");
    expect(unknown.note).toMatch(/Not found on Ethereum mainnet/);

    // eth_getLogs is never asked for more than logChunk blocks at a time (5,000 by default)
    expect(core.DEFAULT_LOG_CHUNK).toBe(5000);
    let ranges: number[][] = [];
    const fake: core.LogsReader<number> = {
      getBlockNumber: async () => 12_000n,
      getLogs: async (f) => (ranges.push([Number(f.fromBlock), Number(f.toBlock)]), [Number(f.fromBlock)]),
    };
    expect(await core.getLogsChunked(fake, 10, "latest")).toEqual([10, 5010, 10010]);
    expect(ranges).toEqual([[10, 5009], [5010, 10009], [10010, 12000]]); // prettier-ignore
    // a chunk that fails now and then is asked again
    ranges = [];
    const failed = new Set<number>();
    const flaky: core.LogsReader<number> = {
      getLogs: async (f) => {
        ranges.push([Number(f.fromBlock), Number(f.toBlock)]);
        if (!failed.has(Number(f.fromBlock))) {
          failed.add(Number(f.fromBlock));
          throw new Error("service temporarily unavailable");
        }
        return [Number(f.fromBlock)];
      },
    };
    expect(await core.getLogsChunked(flaky, 0, 2_999, 1_000, { delayMs: 0 })).toEqual([0, 1000, 2000]);
    expect(ranges).toHaveLength(6);
    // an RPC that wants smaller ranges: a chunk that keeps failing is split in halves
    ranges = [];
    const picky: core.LogsReader<number> = {
      getLogs: async (f) => {
        if (f.toBlock - f.fromBlock + 1n > 1_000n) throw new Error("range too large");
        ranges.push([Number(f.fromBlock), Number(f.toBlock)]);
        return [];
      },
    };
    await core.getLogsChunked(picky, 0, 4_999, 5_000, { retries: 0, delayMs: 0 });
    expect(ranges).toEqual([[0, 624], [625, 1249], [1250, 1874], [1875, 2499], [2500, 3124], [3125, 3749], [3750, 4374], [4375, 4999]]); // prettier-ignore
    // …and an RPC that never answers stops the scan with advice
    const down: core.LogsReader<number> = {
      getLogs: async () => {
        throw new Error("ECONNRESET");
      },
    };
    await expect(core.getLogsChunked(down, 0, 99, 100, { retries: 1, delayMs: 0 })).rejects.toThrow(
      /Could not read the contract's history for blocks 0–99.*ECONNRESET.*rpcUrl/,
    );

    // A registered staker's deposit is never used up by refund(): an exact 0.005 refund covers the
    // overpayment, and a 0.025 refund after a stray of 0.025 covers the stray, not the stake
    const A = `0x${"aa".repeat(20)}`;
    const dep = (tx: string, amount: bigint, block: number) => ({ tx, from: A, amount, block, logIndex: 0 });
    const ev = (type: core.ReturnEvent["type"], amount: bigint, block: number, tx: string) => ({
      type,
      wallet: A,
      amount,
      block,
      logIndex: 0,
      tx,
    });
    const { byDeposit } = core.pairReturns(
      [dep("0x01", U(30), 1), dep("0x02", U(25), 3)],
      [ev("StakerRegistered", 0n, 2, "0xr"), ev("Refunded", U(5), 4, "0xf1"), ev("Refunded", U(25), 5, "0xf2")],
      { deposit: U(25), prefer: new Set(["0x01"]) },
    );
    const s1 = byDeposit.get(core.depKey("0x01", A))!;
    const s2 = byDeposit.get(core.depKey("0x02", A))!;
    expect(s1.staked).toBe(true);
    expect(s1.remaining).toBe(U(25)); // the stake is intact
    expect(s2.remaining).toBe(0n);
    // a refund only covers deposits made before it
    const late = core.pairReturns([dep("0x03", U(25), 9)], [ev("Refunded", U(25), 8, "0xf3")], { deposit: U(25) });
    expect(late.byDeposit.get(core.depKey("0x03", A))!.remaining).toBe(U(25));
    expect(late.unpaired).toHaveLength(1);
  });
});

describe("on a local chain", () => {
  test("full flow: verify → curate on Luma → register / refund declined → check-ins → post list → challenge → release", async () => {
    const s = await scenario({ deposit: 15, base: { deployBlock: "" } });
    const kAddr = s.kAddr;
    const [g0, g1, g2, g3, g4, g5, g6, g7, g8] = [0, 1, 2, 3, 4, 5, 6, 7, 8];

    // Deposits
    const tx0 = await s.pay(g0, 15);
    const tx1 = await s.pay(g1, 15);
    const tx2 = (await k.kick(kAddr, G(g2), "deposit", [], U(20))).transactionHash; // overpaid, through deposit()
    const tx3 = await s.pay(g3, 15);
    const tx4 = await s.pay(g4, 10); // too low
    const tx5 = await k.pay(G(g5), addr(g6), U(15)); // sent to the wrong address
    const tx6 = await s.pay(g6, 15); // will claim someone else's tx too
    const tx7 = await s.pay(g7, 15); // a bot: paid, then declined
    const tx8 = await s.pay(g8, 15); // still waiting for a decision

    const H = "name,email,ticket_name,approval_status,checked_in_at,eth_address,Deposit tx link (Etherscan)";
    const T = "Committed Spot (0.015 ETH refundable deposit)";
    const rowsFor = (st: { ana: string; ben: string }) => [
      `Ana,ana@x.io,${T},${st.ana},,${addr(g0)},https://etherscan.io/tx/${tx0}`,
      `Ben,ben@x.io,${T},${st.ben},,${addr(g1)},${tx1}`,
      `Cai,cai@x.io,${T},approved,,${addr(g2)},see ${tx2} thanks`,
      `Dev,dev@x.io,${T},approved,,,${tx3}`, // wallet inferred
      `Eve,eve@x.io,${T},approved,,${addr(g4)},${tx4}`,
      `Fay,fay@x.io,${T},approved,,${addr(g5)},${tx5}`,
      `Gus,gus@x.io,${T},approved,,${addr(g6)},${tx0}`, // reuses Ana's tx
      `Hal,hal@x.io,Request to Join (Free),approved,,,`,
      `Ivy,ivy@x.io,${T},approved,,${addr(g6)},not sure`,
      `Bot,bot@x.io,${T},declined,,${addr(g7)},${tx7}`,
      `Pat,pat@x.io,${T},pending_approval,,${addr(g8)},${tx8}`,
    ];
    const verify = (lines: string[]) => s.verify(lines, { header: H });

    let r = await verify(rowsFor({ ana: "approved", ben: "approved" }));
    expect(r.verified).toHaveLength(6);
    expect(r.held).toHaveLength(6);
    expect(r.warnings).toEqual([
      '⚠️  No "deployBlock" in the config: scanning from block 0 (only fine on a local test chain).',
    ]);
    const verified = s.readOut("verified.csv");
    for (const n of ["Ana", "Ben", "Cai", "Dev", "Bot", "Pat"]) expect(verified, `${n} verified`).toContain(n);
    expect(verified).toMatch(/overpaid by 0\.005 ETH/);
    expect(verified).toMatch(/wallet taken from the transaction sender/);
    expect(verified).toMatch(/^Ana,.*,0\.015,/m); // amounts in ETH

    const issues = s.readOut("issues.csv");
    expect(issues).toMatch(/AMOUNT_TOO_LOW.*Eve|Eve.*AMOUNT_TOO_LOW/s);
    expect(issues).toMatch(/NO_DEPOSIT_TRANSFER,Fay,.*wrong address\?/); // plain ETH to another wallet
    expect(issues).toMatch(/DUPLICATE_TX/); // Gus
    expect(issues).toMatch(/BAD_TX_HASH/); // Ivy
    expect(issues, "free tickets are ignored").not.toContain("Hal");
    expect(s.readOut("unmatched.csv"), "Gus' own deposit is unclaimed").toContain(tx6.toLowerCase());

    // Curation: only approved + verified are registered; declined payers are refunded; pending waits
    const newStakers = s.wallets("new-stakers.json");
    expect(s.list("new-stakers.json").contract).toBe(kAddr);
    expect(newStakers).toHaveLength(4);
    expect(newStakers).not.toContain(addr(g7));
    expect(newStakers).not.toContain(addr(g8));
    expect(s.wallets("refunds.json")).toEqual([addr(g7)]);
    expect(s.readOut("to-review.csv")).toContain("Pat");
    await k.kick(kAddr, OWNER, "registerStakers", [newStakers]);
    expect(await k.read<bigint>(kAddr, "stakerCount")).toBe(4n);

    const botBefore = await k.balance(addr(g7));
    await k.kick(kAddr, OWNER, "rejectAndRefund", [s.wallets("refunds.json")]);
    expect(await k.balance(addr(g7))).toBe(botBefore + U(15));

    // Later: Ben is declined after being registered; Pat is approved. Re-run is idempotent otherwise.
    const guests2 = rowsFor({ ana: "approved", ben: "declined" }).map((l) => l.replace("pending_approval", "approved"));
    await verify(guests2);
    expect(s.wallets("new-stakers.json")).toEqual([addr(g8)]);
    expect(s.wallets("refunds.json")).toEqual([addr(g1)]); // Bot already refunded: not again
    await k.kick(kAddr, OWNER, "registerStakers", [s.wallets("new-stakers.json")]);
    const benBefore = await k.balance(addr(g1));
    await k.kick(kAddr, OWNER, "rejectAndRefund", [s.wallets("refunds.json")]);
    expect(await k.balance(addr(g1))).toBe(benBefore + U(15)); // Ben got his deposit back
    expect(await k.read<bigint>(kAddr, "stakerCount")).toBe(4n); // Ana, Cai, Dev, Pat

    // Bot pays again after the refund and is approved this time: offered for registration again
    const tx7b = await s.pay(g7, 15);
    const rows3 = rowsFor({ ana: "approved", ben: "declined" }).map((l) =>
      l.startsWith("Bot")
        ? l.replace("declined", "approved").replace(tx7, tx7b)
        : l.replace("pending_approval", "approved"),
    );
    await s.verify(rows3, { header: H, scanFrom: 0 });
    expect(s.wallets("new-stakers.json")).toEqual([addr(g7)]);
    // Bot's first (refunded) deposit is no longer claimed on Luma, but must not look like a stray to return
    const um = s.readOut("unmatched.csv");
    expect(um).toMatch(new RegExp(`already refunded[^\\n]*${tx7.toLowerCase()}`));
    expect(um).toMatch(new RegExp(`open[^\\n]*${tx6.toLowerCase()}`)); // Gus' own deposit is still open
    // …but if the old tx link is still pasted, they stay blocked until they pay again
    await verify(rows3.map((l) => l.replace(tx7b, tx7)));
    expect(s.wallets("new-stakers.json")).toEqual([]);
    expect(s.readOut("issues.csv")).toMatch(/REFUNDED_EARLIER/);
    // A second Luma row (declined) claiming Ana's tx must not refund or register anyone, and must not
    // knock Ana (registered) out of verified.csv either: a declined duplicate never blocks.
    await verify([`Ana2,ana2@x.io,${T},declined,,${addr(g0)},${tx0}`, ...rows3]);
    expect(s.wallets("refunds.json")).toEqual([]);
    expect(s.readOut("issues.csv")).toMatch(/DUPLICATE_TX,Ana2,/);
    expect(s.readOut("verified.csv")).toMatch(/^Ana,ana@x\.io,.*,registered,/m);
    // …but while the copy is not declined either, a human decides (and nothing is listed)
    await verify([`Ana2,ana2@x.io,${T},approved,,${addr(g0)},${tx0}`, ...rows3]);
    expect(s.readOut("issues.csv")).toMatch(/DUPLICATE_CLAIM,Ana2,/);
    expect(s.readOut("issues.csv")).toMatch(/DUPLICATE_CLAIM,Ana,/);
    expect(s.readOut("claims.csv")).toMatch(/ana2@x\.io/); // both still count for her check-in
    // Bot is refunded again so the rest of the flow is unchanged
    await k.kick(kAddr, OWNER, "refund", [addr(g7), U(15)]);
    r = await verify(guests2);

    // Refund Eve's short deposit + Cai's overpayment (spare money only, never the pool)
    await k.kick(kAddr, OWNER, "refund", [addr(g4), U(10)]);
    await k.kick(kAddr, OWNER, "refund", [addr(g2), U(5)]);
    await reverts(kAddr, OWNER, "refund", [addr(g4), U(16)], "InsufficientBalance"); // 0.015 spare = Gus' unclaimed deposit

    // After the event: Ana, Cai, Dev checked in (Dev by hand); Pat no-show.
    const after = rowsFor({ ana: "approved", ben: "declined" }).map((l) =>
      l.startsWith("Ana") || l.startsWith("Cai") ? l.replace("approved,,", "approved,2026-11-04T19:02:00Z,") : l,
    );
    const p = await core.buildPayout({
      client: k.client,
      cfg: s.cfg(),
      checkins: core.parseCsv([H, ...after].join("\n")),
      verified: r.verified,
      claims: r.claims,
      extra: core.parseCsv("Email,Wallet\ndev@x.io,\n"),
      extraName: "manual.csv",
    });
    expect(p.summaryMarkdown).toMatch(/Stakers \| 4/);
    expect(p.summaryMarkdown).toMatch(/Showed up \| 3/);
    expect(p.summaryMarkdown).toMatch(/Pool \| 0\.06 ETH/);
    expect(p.summaryMarkdown).toMatch(
      /Payout per attendee \(if nobody is added by a challenge\) \| 0\.02 ETH \(deposit 0\.015 ETH \+ 0\.005 ETH bonus\)/,
    );
    const plan = p.plan;
    expect(plan.share).toBe(U(20).toString());
    expect(plan.shareEth).toBe("0.02");
    expect(plan.stakers).toBe(4);
    expect(plan.chainId).toBe(31337);
    await reverts(kAddr, OWNER, "postAttendance", [plan.attendees, BigInt(plan.share)], "TooEarly");
    await k.warp(3601);
    await reverts(kAddr, OWNER, "postAttendance", [plan.attendees, U(15)], "ShareMismatch");
    await k.kick(kAddr, OWNER, "postAttendance", [plan.attendees, BigInt(plan.share)]);
    await reverts(kAddr, OWNER, "releasePayouts", [], "TooEarly");
    // Once the list is posted a declined staker can't be refunded: reported, never listed
    // (rejectAndRefund would refuse the whole batch)
    await verify(rowsFor({ ana: "declined", ben: "declined" }));
    expect(s.wallets("refunds.json")).toEqual([]);
    expect(s.readOut("issues.csv")).toMatch(/DECLINED_AFTER_LIST,Ana,/);
    expect(s.readOut("issues.csv")).not.toMatch(/REGISTERED_NOT_APPROVED/);
    // A deposit sent now is refused by the contract: the guest keeps the ETH and the tx is reported as failed
    const txLate = await k.failedTx(G(g5), kAddr, U(15));
    await verify(
      rowsFor({ ana: "approved", ben: "declined" }).map((l) => (l.startsWith("Fay") ? l.replace(tx5, txLate) : l)),
    );
    expect(s.readOut("issues.csv")).toMatch(/^TX_FAILED,Fay,.*deposit contract refused this payment/m);

    // Pat says they were there but was not scanned: challenges with the Kleros fee; nobody matches
    const fee = await k.read<bigint>(kAddr, "challengeDeposit");
    await k.kick(kAddr, G(g8), "challenge", [], fee);
    expect(await k.read<bigint>(kAddr, "pendingChallenges")).toBe(1n);
    expect(await k.read<bigint>(kAddr, "spare")).toBe(U(15)); // Gus' unclaimed deposit; the challenge money is reserved

    await k.warp(DAY + 60);
    const paid = [...plan.attendees, addr(g8)];
    const before = await Promise.all(paid.map((w) => k.balance(w)));
    await k.kick(kAddr, G(g5), "releasePayouts"); // anyone can release
    const afterBal = await Promise.all(paid.map((w) => k.balance(w)));
    // 4 stakers × 0.015 = 0.06 pool / 4 attendees (Pat added), and Pat's challenge deposit went back
    afterBal.forEach((b, i) => expect(b - before[i]!).toBe(U(15) + (i === paid.length - 1 ? fee : 0n)));
    expect(await k.read<bigint>(kAddr, "challengeEscrow")).toBe(0n);

    // Gus' unclaimed deposit stays → swept after settlement
    expect(await k.balance(kAddr)).toBe(U(15));
    await k.kick(kAddr, OWNER, "sweep", [k.addr(OWNER)]);
    expect(await k.balance(kAddr)).toBe(0n);
  });

  test("returned deposits are never listed again: refund() and refund-declined history, by amount, nothing asked twice", async () => {
    const s = await scenario();
    const [gil, pat, wil, xan, yas] = [0, 1, 2, 3, 4].map(addr) as [Address, Address, Address, Address, Address];
    const [Gil, Pat, Wil, Xan, Yas] = [0, 1, 2, 3, 4];
    const txGil = await s.pay(Gil, 25); // pays before signing up on Luma
    const txPat = await s.pay(Pat, 25); // waits for a decision the whole time
    const txWil = await s.pay(Wil, 25); // declined
    const txXan1 = await s.pay(Xan, 10); // too low…
    const txXan2 = await s.pay(Xan, 25); // …then a full one that he never pastes
    const txYas1 = await s.pay(Yas, 30); // overpays…
    const txYas2 = await s.pay(Yas, 25); // …and sends a stray 0.025
    let lines = [
      s.row("Pat", pat, "pending_approval", txPat),
      s.row("Wil", wil, "declined", txWil),
      s.row("Xan", xan, "approved", txXan1),
      s.row("Yas", yas, "approved", txYas1),
    ];
    const r1 = await s.verify(lines);
    expect(s.umRow(txGil)!.status).toBe("open");
    expect(s.umRow(txGil)!.to_return).toBe("0.025");
    expect(s.returnsOf().sort()).toEqual([["AMOUNT_TOO_LOW", xan, "0.01"], ["OVERPAID", yas, "0.005"]]); // prettier-ignore
    expect(s.readOut("issues.csv")).toMatch(/^OVERPAID,Yas,/m);
    expect(s.readOut("issues.csv")).toMatch(/^AMOUNT_TOO_LOW,Xan,.*Sent 0\.01 ETH, need 0\.025 ETH/m);
    expect([r1.returns.length, core.fmt(r1.returns.reduce((t, x) => t + x.units, 0n))]).toEqual([2, "0.015"]);
    expect([r1.incoming.length, core.fmt(r1.totalIncoming)]).toEqual([7, "0.165"]);
    expect(s.wallets("new-stakers.json")).toEqual([yas]);
    expect(s.wallets("refunds.json")).toEqual([wil]);

    // The organiser does all of it: register Yas, refund Wil, return Gil's stray, Xan's 0.01, Yas' 0.005
    await k.kick(s.kAddr, OWNER, "registerStakers", [[yas]]);
    expect(await k.read<bigint>(s.kAddr, "stakerCount")).toBe(1n);
    await k.kick(s.kAddr, OWNER, "rejectAndRefund", [[wil]]);
    await k.kick(s.kAddr, OWNER, "refund", [gil, U(25)]);
    const xanBefore = await k.balance(xan);
    await k.kick(s.kAddr, OWNER, "refund", [xan, U(10)]);
    expect(await k.balance(xan)).toBe(xanBefore + U(10));
    await k.kick(s.kAddr, OWNER, "refund", [yas, U(5)]);

    // Gil now signs up with the tx that was returned and is approved; Wil pays again, still declined
    const txWil2 = await s.pay(Wil, 25);
    lines = [
      s.row("Gil", gil, "approved", txGil),
      s.row("Pat", pat, "pending_approval", txPat),
      s.row("Wil", wil, "declined", txWil2),
      s.row("Xan", xan, "approved", txXan1),
      s.row("Yas", yas, "approved", txYas1),
    ];
    await s.verify(lines);
    expect(s.wallets("new-stakers.json")).toEqual([]); // never Gil: his money is gone
    expect(s.wallets("refunds.json")).toEqual([]);
    const issues = s.readOut("issues.csv");
    expect(issues).toMatch(/^RETURNED_EARLIER,Gil,.*new 0\.025 ETH deposit/m);
    expect(issues).toMatch(/^PAID_AGAIN_DECLINED,Wil,/m);
    expect(issues).not.toMatch(/^OVERPAID,/m); // Yas' 0.005 went back
    expect(s.readOut("verified.csv")).toMatch(/^Gil,.*,returned,/m);
    expect(s.returnsOf()).toEqual([["PAID_AGAIN_DECLINED", wil, "0.025"]]); // not Xan's 0.01 again
    // a 0.01 refund can't cover a 0.025 stray, and Yas' 0.005 was the overpayment, not his stray
    expect(s.umRow(txXan2)!.status).toBe("open");
    expect(s.umRow(txXan2)!.to_return).toBe("0.025");
    expect(s.umRow(txYas2)!.status).toBe("open");
    expect(s.umRow(txYas2)!.to_return).toBe("0.025");
    expect(s.umRow(txGil)).toBeUndefined(); // claimed now
    expect(s.umRow(txWil)!.status).toMatch(/^already refunded/); // the first one, refunded when declined

    // Return Wil's second deposit: PAID_AGAIN_DECLINED is done and never asked again
    await k.kick(s.kAddr, OWNER, "refund", [wil, U(25)]);
    await s.verify(lines);
    expect(s.readOut("issues.csv")).not.toMatch(/PAID_AGAIN_DECLINED/);
    expect(s.returnsOf()).toEqual([]);
    // Approving Wil now does not register him without a new deposit
    lines = lines.map((l) => (l.startsWith("Wil") ? l.replace("declined", "approved") : l));
    await s.verify(lines);
    expect(s.wallets("new-stakers.json")).toEqual([]);
    expect(s.readOut("issues.csv")).toMatch(/^REFUNDED_EARLIER,Wil,/m);

    // Pat's deposit was never touched: declining her still refunds her
    lines = lines.map((l) => (l.startsWith("Pat") ? l.replace("pending_approval", "declined") : l));
    await s.verify(lines);
    expect(s.list("refunds.json").items.map((i) => [i.wallet, i.status])).toEqual([[pat, 0]]);
    await k.kick(s.kAddr, OWNER, "rejectAndRefund", [[pat]]);

    // The strays go back; afterwards they read "already refunded" and nothing is spare
    await k.kick(s.kAddr, OWNER, "refund", [xan, U(25)]);
    await k.kick(s.kAddr, OWNER, "refund", [yas, U(25)]);
    await s.verify(lines);
    expect(s.umRow(txXan2)!.status).toMatch(/^already refunded/);
    expect(s.umRow(txYas2)!.status).toMatch(/^already refunded/);
    expect(s.returnsOf()).toEqual([]);
    expect(s.wallets("refunds.json")).toEqual([]);
    expect(await k.read<bigint>(s.kAddr, "spare")).toBe(0n);
    expect(await k.balance(s.kAddr)).toBe(U(25)); // only Yas' stake
  });

  test("late payers, failed and wrong-network txs, contract senders (exchanges, Safes), free guests and formula cells", async () => {
    const s = await scenario();
    const [ann, lou, lea, ida] = [5, 6, 7, 2].map(addr) as [Address, Address, Address, Address];
    const txAnn = await s.pay(5, 25);
    // a payment the contract refused (0 ETH): mined, failed, no money in
    const txMin = await k.failedTx(G(4), s.kAddr, 0n);
    // a plain transfer with a fixed 21,000 gas limit (some wallets and exchanges): out of gas, no money in
    const txGas = await k.failedTx(G(3), s.kAddr, U(25), 21_000n);
    // 25 USDC sent to the deposit address instead of ETH
    const usdc = await k.deploy(testTokenAbi, testTokenBytecode, []);
    await k.mined(
      await k.wallet(OWNER).writeContract({
        address: usdc,
        abi: testTokenAbi,
        functionName: "mint",
        args: [addr(3), 25_000_000n],
      } as never),
    );
    const txUsdc = await k.wallet(G(3)).writeContract({
      address: usdc,
      abi: testTokenAbi,
      functionName: "transfer",
      args: [s.kAddr, 25_000_000n],
    } as never);
    await k.mined(txUsdc);
    // a contract sending the deposit with no ETH address on Luma, and a Safe-like wallet whose owner states it
    const relay = await smartWalletDeposit(s.kAddr, 25);
    const safe = await smartWalletDeposit(s.kAddr, 25);
    const stray = await smartWalletDeposit(s.kAddr, 5); // nobody claims this one
    // links from another network, or that point nowhere
    const fakeHash = `0x${"cd".repeat(32)}`;
    const fakeHash2 = `0x${"ef".repeat(32)}`;
    // deposits close; two guests pay late
    const closeAt = (await k.now()) + 5;
    s.config({ depositDeadline: new Date(closeAt * 1000).toISOString() });
    await k.warp(60);
    const txLou = await s.pay(6, 25);
    const txLea = await s.pay(7, 30);

    const lines = [
      `"=HYPERLINK(""http://evil.example"",""click"")",ann@x.io,${T25},approved,,${ann},${txAnn}`,
      `Min,min@x.io,${T25},approved,,,https://etherscan.io/tx/${txMin}`,
      `Gas,gas@x.io,${T25},approved,,,https://etherscan.io/tx/${txGas}`,
      `Usd,usd@x.io,${T25},approved,,,https://etherscan.io/tx/${txUsdc}`,
      `Con,con@x.io,${T25},declined,,,${relay.hash}`,
      `Saf,saf@x.io,${T25},approved,,${safe.wallet},${safe.hash}`,
      `Arb,arb@x.io,${T25},approved,,${ida},https://arbiscan.io/tx/${fakeHash}`,
      `Typ,typ@x.io,${T25},approved,,${ida},${fakeHash2}`,
      `Hal,hal@x.io,${FREE},approved,,,N/A`,
      `Ida,ida@x.io,${FREE},approved,,,-`,
      `Joe,joe@x.io,${FREE},approved,,,none`,
      s.row("Lou", lou, "declined", txLou),
      `+Lea,lea@x.io,${T25},pending_approval,,${lea},${txLea}`,
    ];
    await s.verify(lines);
    // a Safe that its owner names on Luma is an ordinary staker
    expect(s.wallets("new-stakers.json")).toEqual([ann, safe.wallet]);
    // the declined late payer is refunded with "Refund declined guests" (status 0 = unregistered)
    expect(s.list("refunds.json").items.map((i) => [i.wallet, i.status, i.onchain])).toEqual([
      [lou, 0, "unregistered"],
    ]);
    const issues = s.csv("issues.csv");
    const codeOf = (email: string) => issues.filter((i) => i.email === email).map((i) => i.code);
    const noteOf = (email: string) => issues.find((i) => i.email === email)!.note;
    expect(codeOf("min@x.io")).toEqual(["TX_FAILED"]);
    expect(noteOf("min@x.io")).toMatch(/deposit contract refused this payment.*only paid the network fee/);
    // out of gas is not a refusal: the guest is told to keep the gas limit their wallet suggests
    expect(codeOf("gas@x.io")).toEqual(["TX_FAILED"]);
    expect(noteOf("gas@x.io")).toMatch(
      /too little gas \(a limit of 21,000\).*needs about 25,000.*no ETH moved.*not a fixed 21,000/,
    );
    expect(noteOf("gas@x.io")).not.toMatch(/refused/);
    // a token is never a deposit: the note says how to give it back
    expect(codeOf("usd@x.io")).toEqual(["NO_DEPOSIT_TRANSFER"]);
    expect(noteOf("usd@x.io")).toMatch(
      new RegExp(`sent a token.*not ETH.*token contract ${usdc}.*Return tokens sent by mistake.*new deposit in ETH`),
    );
    expect(codeOf("con@x.io")).toEqual(["UNUSUAL_SENDER"]);
    expect(noteOf("con@x.io")).toMatch(/Sent by a contract.*Safe/);
    expect(codeOf("arb@x.io")).toEqual(["WRONG_NETWORK"]);
    expect(noteOf("arb@x.io")).toMatch(/on Arbitrum, not local/);
    expect(codeOf("typ@x.io")).toEqual(["TX_NOT_FOUND"]);
    expect(codeOf("lou@x.io")).toEqual(["OUTSIDE_WINDOW"]);
    for (const e of ["hal@x.io", "ida@x.io", "joe@x.io"]) expect(codeOf(e), `${e} is a free guest`).toEqual([]);
    expect(s.wallets("refunds.json")).not.toContain(zeroAddress);
    expect(s.wallets("new-stakers.json")).not.toContain(zeroAddress);
    // the undeclined late payer's 0.03 goes back with "Return a stray transfer"
    expect(s.returnsOf()).toEqual([["OUTSIDE_WINDOW", lea, "0.03"]]);
    // the unclaimed contract deposit is open, with a warning to check where it should go
    expect(s.umRow(stray.hash)!.status).toBe("open");
    expect(s.umRow(stray.hash)!.from).toBe(stray.wallet);
    expect(s.umRow(stray.hash)!.note).toMatch(/Sent by a contract/);
    // the relayed deposit can't hold a spot, so it is listed too, naming the guest; the failed tx brought nothing
    expect(s.umRow(relay.hash)!.note).toMatch(/Pasted on Luma by con@x\.io \(UNUSUAL_SENDER\).*Sent by a contract/);
    expect(s.umRow(relay.hash)!.to_return).toBe("0.025");
    expect(s.umRow(txMin)).toBeUndefined();
    // formula cells are neutralised in every CSV
    for (const f of ["verified.csv", "issues.csv", "returns.csv", "claims.csv", "to-review.csv"] as const)
      expect(s.readOut(f), `${f} has a cell starting with a formula character`).not.toMatch(/(^|,)"?[=+@-]/m);
    expect(s.readOut("verified.csv")).toMatch(/"'=HYPERLINK\(""http:\/\/evil\.example""/);
    expect(s.readOut("returns.csv")).toMatch(/,'\+Lea,/);

    // Refund Lou as listed: it works for an unregistered late payer, and he is not listed again
    await k.kick(s.kAddr, OWNER, "registerStakers", [[ann, safe.wallet]]);
    await k.kick(s.kAddr, OWNER, "rejectAndRefund", [[lou]]);
    await s.verify(lines);
    expect(s.wallets("refunds.json")).toEqual([]);
    expect(s.returnsOf()).toEqual([["OUTSIDE_WINDOW", lea, "0.03"]]);
    expect(s.readOut("verified.csv")).toMatch(/^Saf,.*,registered,/m);
    // Lea declined: "Refund declined guests" sends her 0.025, and the 0.005 extra is listed to give back
    await s.verify(lines.map((l) => l.replace("pending_approval", "declined")));
    expect(s.wallets("refunds.json")).toEqual([lea]);
    expect(s.returnsOf()).toEqual([["OVERPAID", lea, "0.005"]]);
  });

  test("several tx links in one answer: the one that is a deposit counts; two deposits need a decision; unclaimed deposits name the guest who mentioned or sent them", async () => {
    const s = await scenario();
    const [raj, dua, nia] = [0, 1, 2].map(addr) as [Address, Address, Address];
    // Raj's first plain send ran out of gas (21,000), the second went through: he pastes both links
    const bad = await k.failedTx(G(0), s.kAddr, U(25), 21_000n);
    const good = await s.pay(0, 25);
    // Dua paid twice and pasted both
    const d1 = await s.pay(1, 25);
    const d2 = await s.pay(1, 25);
    // Nia paid but pasted a link that does not exist; her ETH address on Luma sent the real deposit
    const nTx = await s.pay(2, 25);
    await s.verify([
      `Raj,raj@x.io,${T25},approved,,${raj},"first one failed https://etherscan.io/tx/${bad} then https://etherscan.io/tx/${good}"`,
      `Dua,dua@x.io,${T25},approved,,${dua},"${d1} and ${d2}"`,
      `Nia,nia@x.io,${T25},approved,,${nia},0x${"ab".repeat(32)}`,
    ]);
    expect(s.wallets("new-stakers.json")).toEqual([raj]);
    const v = s.csv("verified.csv").find((r) => r.email === "raj@x.io")!;
    expect(v.tx).toBe(good.toLowerCase());
    expect(v.note).toMatch(/2 tx links pasted; checked/);
    const issues = s.csv("issues.csv");
    const dIssue = issues.find((i) => i.email === "dua@x.io")!;
    expect(dIssue.code).toBe("MULTIPLE_TX");
    expect(dIssue.note).toMatch(/Pasted 2 deposits that each verify.*Ask the guest which one/);
    expect(issues.find((i) => i.email === "nia@x.io")!.code).toBe("TX_NOT_FOUND");
    // nothing of Raj's is listed to give back; Dua's two and Nia's deposit are, each naming the guest
    expect(s.umRow(good)).toBeUndefined();
    for (const t of [d1, d2])
      expect(s.umRow(t)!.note).toMatch(
        /This tx link is in the Luma answers of dua@x\.io: ask them about it before returning it/,
      );
    expect(s.umRow(nTx)!.note).toMatch(
      /Sent from the ETH address nia@x\.io gave on Luma: ask them for this tx link instead of returning it/,
    );
  });

  test("several tx links: one that can't be read this run is reported as unreadable, and its deposit waits for the next run", async () => {
    let good: Hash | undefined;
    // a busy public RPC that refuses to read Raj's second link this time
    const busy = custom(
      {
        async request({ method, params }: { method: string; params?: unknown }) {
          const p = params as unknown[] | undefined;
          if (
            good &&
            /^eth_getTransaction(Receipt|ByHash)$/.test(method) &&
            String(p?.[0]).toLowerCase() === good.toLowerCase()
          )
            throw Object.assign(new Error("too many requests"), { code: -32005 });
          const res = await fetch(k.rpcUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          });
          const body = (await res.json()) as { result?: unknown; error?: { code: number; message: string } };
          if (body.error) throw Object.assign(new Error(body.error.message), { code: body.error.code });
          return body.result;
        },
      },
      { retryCount: 0 },
    );
    const busyClient = chainKit(busy).client;
    const s = await scenario({ client: busyClient });
    const raj = addr(0);
    const bad = await k.failedTx(G(0), s.kAddr, U(25), 21_000n);
    good = await s.pay(0, 25);
    const line = `Raj,raj@x.io,${T25},approved,,${raj},"first one failed https://etherscan.io/tx/${bad} then https://etherscan.io/tx/${good}"`;
    await s.verify([line]);
    const issue = s.csv("issues.csv").find((i) => i.email === "raj@x.io")!;
    expect(issue.code).toBe("RPC_ERROR"); // not the first link's TX_FAILED ("ask for a new deposit")
    expect(issue.tx).toBe(good.toLowerCase());
    expect(s.umRow(good)).toBeUndefined(); // not listed to give back
    expect(s.wallets("new-stakers.json")).toEqual([]);
    // the next run reads it: Raj verifies
    good = undefined;
    await s.verify([line]);
    expect(s.wallets("new-stakers.json")).toEqual([raj]);
  });

  test("a copied tx link never knocks out the real guest, and buildPayout still pays them", async () => {
    const s = await scenario();
    const [sam, sue, eve, zed, ali] = [0, 1, 2, 3, 4].map(addr) as [Address, Address, Address, Address, Address];
    const txSam = await s.pay(0, 25);
    const txSue = await s.pay(1, 25);
    await s.verify([s.row("Sam", sam, "approved", txSam), s.row("Sue", sue, "approved", txSue)]);
    expect(s.wallets("new-stakers.json")).toEqual([sam, sue]);
    await k.kick(s.kAddr, OWNER, "registerStakers", [[sam, sue]]);

    // Listed before Sam in the export: a stranger with no ETH address (declined) and a copier who
    // states her own wallet (pending) both paste Sam's public tx link
    const copies = [`Str,str@x.io,${T25},declined,,,${txSam}`, s.row("Cop", eve, "pending_approval", txSam)];
    let lines = [...copies, s.row("Sam", sam, "approved", txSam), s.row("Sue", sue, "approved", txSue)];
    await s.verify(lines);
    const dups = () =>
      s
        .csv("issues.csv")
        .filter((i) => /^DUPLICATE/.test(i.code!))
        .map((i) => [i.code, i.name])
        .sort();
    expect(dups()).toEqual([["DUPLICATE_TX", "Cop"], ["DUPLICATE_TX", "Str"]]); // prettier-ignore
    expect(s.readOut("verified.csv")).toMatch(/^Sam,sam@x\.io,.*,registered,/m);
    expect(s.wallets("refunds.json")).toEqual([]); // nobody refunded, Sam stays
    expect(s.wallets("new-stakers.json")).toEqual([]);
    // even an approved blank-address copy can't displace him (his stated wallet sent it)
    lines = lines.map((l) => (l.startsWith("Str") ? l.replace("declined", "approved") : l));
    let r = await s.verify(lines);
    expect(s.readOut("verified.csv")).toMatch(/^Sam,/m);
    expect(dups()).toEqual([["DUPLICATE_TX", "Cop"], ["DUPLICATE_TX", "Str"]]); // prettier-ignore

    // After the event: Sam and Sue checked in; the copies change nothing
    const H25 =
      "name,email,ticket_name,approval_status,checked_in_at,eth_address,Deposit tx link (Committed Spot only)";
    const checkIn = (who: string[]) => (l: string) =>
      who.some((w) => l.startsWith(w + ",")) ? l.replace(",approved,,", ",approved,2026-11-04T19:00:00Z,") : l;
    const payout = (rows: string[], res: core.CheckGuestsResult) =>
      core.buildPayout({
        client: k.client,
        cfg: s.cfg(),
        checkins: core.parseCsv([H25, ...rows].join("\n")),
        verified: res.verified,
        claims: res.claims,
      });
    let p = await payout(lines.map(checkIn(["Sam", "Sue"])), r);
    expect(p.summaryMarkdown).toMatch(/Showed up \| 2/);
    expect([...p.plan.attendees].sort()).toEqual([sam, sue].sort());

    // Sam signed up twice (two emails, both approved): both rows wait for a human decision, and
    // his check-in under either email still counts
    lines = [
      s.row("Sam", sam, "approved", txSam),
      s.row("Sam2", sam, "approved", txSam),
      s.row("Sue", sue, "approved", txSue),
    ];
    r = await s.verify(lines);
    expect(s.readOut("verified.csv")).not.toMatch(/sam@x\.io/);
    expect(dups()).toEqual([["DUPLICATE_CLAIM", "Sam"], ["DUPLICATE_CLAIM", "Sam2"]]); // prettier-ignore
    expect(s.readOut("claims.csv")).toMatch(/sam2@x\.io/);
    p = await payout(lines.map(checkIn(["Sam2", "Sue"])), r);
    expect(p.summaryMarkdown).toMatch(/Showed up \| 2/);
    // a registered staker with no verified registration at all is reported, never quietly a no-show
    const none = await core.buildPayout({
      client: k.client,
      cfg: s.cfg(),
      checkins: core.parseCsv([H25, ...lines.map(checkIn(["Sam2", "Sue"]))].join("\n")),
    });
    expect(none.unknown).toEqual([sam, sue]);
    expect(none.unknownNote).toMatch(/^2 registered stakers have no Luma registration that verified their wallet/);

    // A tx whose stated owner did not send it (an exchange withdrawal?) is "used" by that row: a
    // blank-address row pasting it can't take the seat while that row is not declined
    const txZed = await s.pay(3, 25);
    lines = [
      s.row("Ali", ali, "pending_approval", txZed),
      `Bob,bob@x.io,${T25},approved,,,${txZed}`,
      s.row("Sam", sam, "approved", txSam),
      s.row("Sue", sue, "approved", txSue),
    ];
    await s.verify(lines);
    expect(s.wallets("new-stakers.json")).toEqual([]);
    const mine = s
      .csv("issues.csv")
      .filter((i) => ["ali@x.io", "bob@x.io"].includes(i.email!))
      .map((i) => [i.name, i.code])
      .sort();
    expect(mine).toEqual([["Ali", "WRONG_SENDER"], ["Bob", "DUPLICATE_CLAIM"]]); // prettier-ignore
    expect(s.csv("issues.csv").find((i) => i.name === "Ali")!.note).toMatch(/sent from an exchange\?/);
    // once Ali is declined, the deposit (wallet taken from the sender) is Bob's
    await s.verify(lines.map((l) => (l.startsWith("Ali") ? l.replace("pending_approval", "declined") : l)));
    expect(s.wallets("new-stakers.json")).toEqual([zed]);
    expect(s.readOut("verified.csv")).toMatch(/^Bob,.*wallet taken from the transaction sender/m);
    // with only Ali's row, nobody's own wallet claims it: listed to give back, naming her
    await s.verify([lines[0]!, ...lines.slice(2)]);
    expect(s.umRow(txZed)!.status).toBe("open");
    expect(s.umRow(txZed)!.note).toMatch(/Pasted on Luma by ali@x\.io \(WRONG_SENDER\)/);
  });

  test("no contract, no check; a config with another deposit lists nothing; an old USDC config is refused", async () => {
    const s = await scenario();
    const eve = addr(2);
    const tx = await s.pay(2, 25);
    await s.pay(4, 7); // a stray nobody pastes
    const lines = [s.row("Eve", eve, "approved", tx)];
    await s.verify(lines);
    expect(s.wallets("new-stakers.json")).toEqual([eve]);
    expect(
      s
        .csv("unmatched.csv")
        .filter((r) => r.status === "open")
        .map((r) => r.to_return),
    ).toEqual(["0.007"]);
    expect(s.list("new-stakers.json").deposit).toBe(U(25).toString()); // the lists say which deposit they were made for
    // the deposit address must be the deployed contract (deposits are its own events)
    s.config({ contract: "", receiver: eve });
    await expect(s.verify(lines)).rejects.toMatchObject({
      code: "NO_KICKBACK_CONTRACT",
      message: expect.stringMatching(/No deposit contract at/),
    });
    // an old USDC config is refused outright
    expect(() => s.config({ token: `0x${"12".repeat(20)}`, tokenDecimals: 6 })).toThrow(/deposits are in ETH now/);
    // the deposit is fixed in the contract (0.025 here): a config with another amount lists nothing
    for (const deposit of ["0.01", "0.03"]) {
      s.config({ deposit });
      await expect(s.verify(lines)).rejects.toMatchObject({
        code: "DEPOSIT_MISMATCH",
        depositAmount: U(25),
        message: expect.stringMatching(
          new RegExp(
            `The settings say the deposit is ${deposit} ETH, but the contract .* was deployed with 0\\.025 ETH`,
          ),
        ),
      });
    }
  });
});
