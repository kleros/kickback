import { readFileSync } from "node:fs";
import path from "node:path";

import {
  BaseError,
  createPublicClient,
  createTestClient,
  createWalletClient,
  custom,
  decodeAbiParameters,
  decodeErrorResult,
  encodeDeployData,
  encodeFunctionData,
  formatEther,
  getAddress,
  getContract,
  keccak256,
  parseAbi,
  parseEventLogs,
  parseEther,
  toHex,
  type Address,
  type EIP1193Provider,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAddress } from "viem/accounts";

import { disputeResolverAbi, klerosLiquidAbi } from "../abis/kleros";
import { kickbackAbi, kickbackBytecode, liveEvent, mockKlerosLiquidAbi } from "../generated/index";
import { DAY, deployMockKleros, ipfsPathOf, localEventArgs, type KickbackArgs } from "../local";
import { LIVE_DIR } from "./liveBuild";

/** Kleros Court v1 on Ethereum mainnet. */
export const MAINNET_KLEROS = {
  disputeResolver: getAddress("0x4b89e798b10478a839ea0abcf86c4b94a3c782a4"),
  arbitrator: getAddress("0x988b3A538b618C7A603e1c11Ab82Cd16dbE28069"),
} as const;

/** Fragments the lifecycle needs beyond abis/kleros.ts: the arbitrator's callback and the ERC-1497/792 events. */
const klerosExtraAbi = parseAbi([
  "function rule(uint256 _externalDisputeID, uint256 _ruling)",
  "event DisputeCreation(uint256 indexed _disputeID, address indexed _arbitrable)",
  "event MetaEvidence(uint256 indexed _metaEvidenceID, string _evidence)",
  "event Evidence(address indexed _arbitrator, uint256 indexed _evidenceGroupID, address indexed _party, string _evidence)",
]);
const errorStringAbi = parseAbi(["error Error(string)"]);

export type LifecycleMode = "local" | "fork";
export type StepResult = { scenario: string; name: string; ok: boolean; detail?: string; error?: string };
export const LIFECYCLE_STEPS = 31;
/** Steps whose guest and check-in lists are written into this file, not computed from a Luma or check-in CSV. */
export const HAND_LISTED = "hand-listed: ";
export const HAND_LISTED_STEPS = 3;

class StepFailed extends Error {}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new StepFailed(message);
}
function equal<T>(got: T, want: T, what: string) {
  assert(got === want, `${what}: expected ${String(want)}, got ${String(got)}`);
}

/** The custom error or reason string behind a failed call, decoded from the ABI. */
function decodeErr(e: unknown): string {
  const dataOf = (x: unknown): Hex | undefined => {
    const d = (x as { data?: unknown })?.data;
    if (typeof d === "string" && d.startsWith("0x")) return d as Hex;
    const inner = (d as { data?: unknown })?.data;
    return typeof inner === "string" && inner.startsWith("0x") ? (inner as Hex) : undefined;
  };
  let data: Hex | undefined;
  if (e instanceof BaseError) e.walk((x) => !!(data = dataOf(x)));
  data ??= dataOf(e);
  if (data && data.length >= 10) {
    try {
      const r = decodeErrorResult({ abi: [...kickbackAbi, ...errorStringAbi], data });
      return `${r.errorName}(${(r.args ?? []).map(String).join(",")})`;
    } catch {
      return data.slice(0, 10);
    }
  }
  return (e as BaseError)?.shortMessage ?? (e as Error)?.message ?? String(e);
}

/** Live constructor arguments from the Etherscan-verified deployment. */
export function liveConstructorArgs(): KickbackArgs {
  const inputs = kickbackAbi.find((i) => i.type === "constructor")!.inputs;
  const hex = readFileSync(path.join(LIVE_DIR, "constructor-arguments.txt"), "utf8").trim();
  return decodeAbiParameters(inputs, `0x${hex.replace(/^0x/, "")}`) as unknown as KickbackArgs;
}

export type LifecycleOptions = {
  provider: EIP1193Provider;
  mode: LifecycleMode;
  log?: (line: string) => void;
};

/**
 * The 31 steps of kickback-legacy test/fork.e2e.mjs: deploy, deposits, curation, the list, challenges, Kleros
 * cases, payouts, settlement and sweep, then the cancel path and the emergencyWithdraw path from a snapshot.
 * Every touched balance is checked to the wei. `local` uses MockKleros (rulings via giveFinalRuling); `fork`
 * uses mainnet's Dispute Resolver and KlerosLiquid, impersonating KlerosLiquid to call Resolver.rule.
 * The chain is reverted to its starting snapshot at the end.
 */
export async function runLifecycle({ provider, mode, log = () => {} }: LifecycleOptions): Promise<StepResult[]> {
  const transport = custom(provider);
  const pub = createPublicClient({ transport });
  const wallet = createWalletClient({ transport });
  const test = createTestClient({ mode: "hardhat", transport });

  const chainId = await pub.getChainId();
  if (mode === "fork") assert(chainId === 1, `the mainnet fork must report chain id 1 (got ${chainId})`);
  else assert(chainId !== 1, "local mode runs against a local chain, not chain id 1");

  // ------------------------------------------------------------------ accounts
  const derive = (name: string) => privateKeyToAddress(keccak256(toHex(`kickback lifecycle ${name}`)));
  const names = ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "gW", "gCopy", "gStray", "gHelper"] as const;
  const acct = Object.fromEntries(names.map((n) => [n, derive(n)])) as Record<(typeof names)[number], Address>;
  const { g1, g2, g3, g4, g5, g6, g7, g8, gW, gCopy, gStray, gHelper } = acct;
  const OWNER = mode === "fork" ? getAddress(liveEvent.owner) : derive("owner");
  for (const a of [...Object.values(acct), OWNER]) {
    await test.impersonateAccount({ address: a });
    await test.setBalance({ address: a, value: parseEther("10") });
  }

  let RESOLVER: Address;
  let LIQUID: Address;
  if (mode === "fork") {
    ({ disputeResolver: RESOLVER, arbitrator: LIQUID } = MAINNET_KLEROS);
    await test.impersonateAccount({ address: LIQUID });
    await test.setBalance({ address: LIQUID, value: (await pub.getBalance({ address: LIQUID })) + parseEther("1") });
  } else {
    const helper = createWalletClient({ account: gHelper, transport });
    ({ disputeResolver: RESOLVER, arbitrator: LIQUID } = await deployMockKleros({
      walletClient: helper,
      publicClient: pub,
    }));
  }
  const resolver = getContract({ address: RESOLVER, abi: [...disputeResolverAbi, ...klerosExtraAbi], client: pub });
  const liquid = getContract({ address: LIQUID, abi: [...klerosLiquidAbi, ...klerosExtraAbi], client: pub });

  const S0 = await test.snapshot();
  const now0 = (await pub.getBlock()).timestamp;
  let deployArgs: KickbackArgs;
  if (mode === "fork") {
    const live = liveConstructorArgs();
    const [dep, name, owner, start, deadline, arb] = live;
    // the live event's dates, unless the fork is already past them: then the same windows from now on
    const shift = start > now0 + 3600n ? 0n : now0 + BigInt(3 * DAY) - start;
    deployArgs = [dep, name, owner, start + shift, deadline + shift, arb];
    if (shift) log(`fork time is past the live eventStart: dates shifted by ${shift} s`);
  } else {
    deployArgs = localEventArgs({ owner: OWNER, disputeResolver: RESOLVER, eventStart: now0 + BigInt(3 * DAY) }).args;
  }
  const DEP = deployArgs[0];
  const EVENT_START = deployArgs[3];
  const CLAIM_DEADLINE = deployArgs[4];
  const EXTRA = deployArgs[5].extraData;
  const POLICY = deployArgs[5].policyURI;
  log(
    `${mode}: chain ${chainId}, block ${await pub.getBlockNumber()}; deposit ${formatEther(DEP)} ETH, "${deployArgs[1]}", ` +
      `start ${EVENT_START}, deadline ${CLAIM_DEADLINE}, resolver ${RESOLVER}, arbitrator ${LIQUID}, policy ${POLICY}`,
  );

  // ------------------------------------------------------------------ reporting and the ledger
  const results: StepResult[] = [];
  let scenario = "";
  async function step(name: string, fn: () => Promise<string | void>) {
    try {
      const detail = (await fn()) ?? undefined;
      results.push({ scenario, name, ok: true, detail });
      log(`PASS [${scenario}] ${name}${detail ? ` (${detail})` : ""}`);
    } catch (e) {
      const error = e instanceof StepFailed ? e.message : decodeErr(e);
      results.push({ scenario, name, ok: false, error });
      log(`FAIL [${scenario}] ${name}: ${error}`);
      throw e;
    }
  }

  // expected balance of every tracked account to the wei: start balance, minus gas and value sent, plus payments
  const ledger = new Map<Address, bigint>();
  const track = async (a: Address) => ledger.set(a, await pub.getBalance({ address: a }));
  const credit = (a: Address, v: bigint) => ledger.set(a, ledger.get(a)! + v);
  async function assertLedger(list: [string, Address][]) {
    const bad: string[] = [];
    for (const [label, a] of list) {
      const want = ledger.get(a)!;
      const got = await pub.getBalance({ address: a });
      if (want !== got) bad.push(`${label} ${a}: expected ${want} got ${got} (diff ${got - want})`);
    }
    assert(!bad.length, bad.join("; "));
  }

  type Sent = TransactionReceipt;
  async function send(
    label: string,
    from: Address,
    to: Address | undefined,
    data: Hex = "0x",
    value = 0n,
  ): Promise<Sent> {
    let gas: bigint;
    try {
      gas = await pub.estimateGas({ account: from, to, data, value });
    } catch (e) {
      throw new StepFailed(`${label}: estimate failed: ${decodeErr(e)}`);
    }
    // like the console: the estimate + 30%
    const hash = await wallet.sendTransaction({ account: from, to, data, value, gas: (gas * 13n) / 10n, chain: null });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (ledger.has(from)) credit(from, -(r.gasUsed * r.effectiveGasPrice + value));
    if (to && ledger.has(getAddress(to))) credit(getAddress(to), value);
    assert(r.status === "success", `${label}: tx ${hash} reverted`);
    return r;
  }
  /** The refusal a transaction would meet, from a dry run; fails when it would go through. */
  async function refused(label: string, from: Address, to: Address, data: Hex = "0x", value = 0n): Promise<string> {
    try {
      await pub.estimateGas({ account: from, to, data, value });
    } catch (e) {
      return decodeErr(e);
    }
    throw new StepFailed(`${label}: expected a revert, but it would succeed`);
  }
  const kcall = (fn: Parameters<typeof encodeFunctionData<typeof kickbackAbi>>[0]) => encodeFunctionData(fn);
  const warpTo = async (ts: bigint) => {
    const now = (await pub.getBlock()).timestamp;
    if (ts > now) await test.increaseTime({ seconds: Number(ts - now) });
    await test.mine({ blocks: 1 });
    return (await pub.getBlock()).timestamp;
  };

  let K: Address = "0x";
  const kick = () => getContract({ address: K, abi: kickbackAbi, client: pub });
  const challengeOf = async (a: Address) => {
    const [state, matcher, matchEndsAt, deposit, arbitratorDisputeID, localDisputeID, arbitrationPaid, heldShare] =
      await kick().read.challenges([a]);
    return { state, matcher, matchEndsAt, deposit, arbitratorDisputeID, localDisputeID, arbitrationPaid, heldShare };
  };
  const deliverRuling = (label: string, id: bigint, ruling: bigint) =>
    mode === "fork"
      ? send(
          label,
          LIQUID,
          RESOLVER,
          encodeFunctionData({ abi: klerosExtraAbi, functionName: "rule", args: [id, ruling] }),
        )
      : send(
          label,
          gHelper,
          LIQUID,
          encodeFunctionData({ abi: mockKlerosLiquidAbi, functionName: "giveFinalRuling", args: [id, ruling] }),
        );

  const tx: Record<string, Hex> = {};
  let fee = 0n;
  let S1: Hex | undefined;
  let caseB = { id: 0n, local: 0n };
  let caseC = { id: 0n, local: 0n };
  let share = 0n;
  let each = 0n;
  let deployBlock = 0n;
  const plan = { attendees: [g1, g2, g3, g4], stakers: 7n, share: 0n };

  try {
    try {
      // ================================================================ main lifecycle
      scenario = "lifecycle";
      for (const a of [g1, g2, g3, g4, g5, g6, g7, g8, gW, gCopy, gStray, OWNER, LIQUID]) await track(a);

      await step(`deploy TruthPaysKickback from the owner (${OWNER})`, async () => {
        const r = await send(
          "deploy",
          OWNER,
          undefined,
          encodeDeployData({ abi: kickbackAbi, bytecode: kickbackBytecode, args: deployArgs }),
        );
        K = getAddress(r.contractAddress!);
        deployBlock = r.blockNumber;
        const c = kick();
        equal(await c.read.depositAmount(), DEP, "depositAmount");
        equal(await c.read.owner(), OWNER, "owner");
        equal(getAddress(await c.read.disputeResolver()), RESOLVER, "disputeResolver");
        equal(getAddress(await c.read.arbitrator()), LIQUID, "arbitrator");
        equal(await c.read.arbitratorExtraData(), EXTRA, "arbitratorExtraData");
        const [pieces, slots] = await c.read.metaEvidenceTemplate();
        equal(
          JSON.stringify([pieces, slots]),
          JSON.stringify([deployArgs[5].metaEvidenceTemplate, deployArgs[5].metaEvidenceSlots]),
          "template",
        );
        equal(await c.read.policyURI(), POLICY, "policyURI");
        equal(await c.read.eventName(), deployArgs[1], "eventName");
        equal(await c.read.eventStart(), EVENT_START, "eventStart");
        equal(await c.read.claimDeadline(), CLAIM_DEADLINE, "claimDeadline");
        fee = await c.read.challengeDeposit();
        equal(fee, await liquid.read.arbitrationCost([EXTRA]), "challengeDeposit = arbitrationCost");
        return `contract ${K}, block ${deployBlock}, deploy gas ${r.gasUsed}, challengeDeposit ${formatEther(fee)} ETH`;
      });

      await step(
        "guests deposit via deposit() and plain transfers (+ wrong amount, duplicate wallet, stray)",
        async () => {
          const dep = kcall({ abi: kickbackAbi, functionName: "deposit" });
          tx.g1 = (await send("g1 deposit()", g1, K, dep, DEP)).transactionHash;
          tx.g2 = (await send("g2 deposit()", g2, K, dep, DEP)).transactionHash;
          tx.g3 = (await send("g3 transfer", g3, K, "0x", DEP)).transactionHash;
          tx.g4 = (await send("g4 transfer", g4, K, "0x", DEP)).transactionHash;
          tx.g5 = (await send("g5 deposit()", g5, K, dep, DEP)).transactionHash;
          tx.g6 = (await send("g6 deposit()", g6, K, dep, DEP)).transactionHash;
          tx.g6b = (await send("g6 2nd deposit (duplicate wallet)", g6, K, "0x", DEP)).transactionHash;
          tx.g7 = (await send("g7 transfer", g7, K, "0x", DEP)).transactionHash;
          tx.g8 = (await send("g8 deposit() (to be declined)", g8, K, dep, DEP)).transactionHash;
          tx.gW = (await send("gW wrong amount", gW, K, "0x", DEP / 2n)).transactionHash;
          tx.stray = (await send("stray transfer (not on Luma)", gStray, K, "0x", DEP)).transactionHash;
          // a plain transfer with a fixed 21,000 gas limit fails: receive() needs more
          let failed = false;
          try {
            const h = await wallet.sendTransaction({ account: gHelper, to: K, value: DEP, gas: 21_000n, chain: null });
            failed = (await pub.waitForTransactionReceipt({ hash: h })).status !== "success";
          } catch {
            failed = true;
          }
          assert(failed, "a 21,000-gas plain transfer must fail");
          const logs = await pub.getContractEvents({
            address: K,
            abi: kickbackAbi,
            eventName: "Deposited",
            fromBlock: deployBlock,
          });
          equal(logs.length, 11, "Deposited logs");
          equal(await pub.getBalance({ address: K }), DEP * 10n + DEP / 2n, "contract balance");
        },
      );

      // what kickback-core checkGuests would derive from the Luma CSV for these deposits
      const newStakers = [g1, g2, g3, g4, g5, g6, g7];
      const refunds = [g8];
      const returns: [Address, bigint][] = [
        [gW, DEP / 2n],
        [g6, DEP],
      ];
      const unmatched: [Address, bigint][] = [[gStray, DEP]];
      await step(
        `${HAND_LISTED}Deposited logs match the lists: 7 to register, 1 to decline, 2 returns, 1 stray`,
        async () => {
          const logs = await pub.getContractEvents({
            address: K,
            abi: kickbackAbi,
            eventName: "Deposited",
            fromBlock: deployBlock,
          });
          const byTx = new Map(logs.map((l) => [l.transactionHash, l.args]));
          const expect: [string, Address, bigint][] = [
            ["g1", g1, DEP],
            ["g2", g2, DEP],
            ["g3", g3, DEP],
            ["g4", g4, DEP],
            ["g5", g5, DEP],
            ["g6", g6, DEP],
            ["g6b", g6, DEP],
            ["g7", g7, DEP],
            ["g8", g8, DEP],
            ["gW", gW, DEP / 2n],
            ["stray", gStray, DEP],
          ];
          for (const [key, from, amount] of expect) {
            const a = byTx.get(tx[key]!);
            assert(a && getAddress(a.from!) === from && a.amount === amount, `Deposited for ${key}`);
          }
          // the copycat's row points at Ben's transaction: Ben's wallet sent it, so it is not the copycat's deposit
          equal(getAddress(byTx.get(tx.g2!)!.from!) === gCopy, false, "copied tx link");
          return `register ${newStakers.length}, decline ${refunds.length}, return ${returns.length}, stray ${unmatched.length}`;
        },
      );

      await step("registerStakers from the owner", async () => {
        await send(
          "registerStakers",
          OWNER,
          K,
          kcall({ abi: kickbackAbi, functionName: "registerStakers", args: [newStakers] }),
        );
        equal(await kick().read.stakerCount(), 7n, "stakerCount");
      });
      await step("rejectAndRefund: the declined guest gets exactly the deposit back", async () => {
        await send(
          "rejectAndRefund",
          OWNER,
          K,
          kcall({ abi: kickbackAbi, functionName: "rejectAndRefund", args: [refunds] }),
        );
        credit(g8, DEP);
        await assertLedger([["g8", g8]]);
        equal(await kick().read.status([g8]), 3, "status(g8)");
      });
      await step("refund() the returns and the stray (short payment, 2nd deposit, stray)", async () => {
        for (const [to, amount] of [...returns, ...unmatched]) {
          await send(`refund ${to}`, OWNER, K, kcall({ abi: kickbackAbi, functionName: "refund", args: [to, amount] }));
          credit(to, amount);
        }
        // the pool itself can't be refunded
        const why = await refused(
          "refund pool",
          OWNER,
          K,
          kcall({ abi: kickbackAbi, functionName: "refund", args: [OWNER, 1n] }),
        );
        assert(/InsufficientBalance/.test(why), `refund pool: ${why}`);
        await assertLedger([
          ["gW", gW],
          ["g6", g6],
          ["stray", gStray],
        ]);
        equal(await pub.getBalance({ address: K }), DEP * 7n, "contract balance");
        equal(await kick().read.spare(), 0n, "spare");
      });
      await step(
        `${HAND_LISTED}chain state matches the lists: nothing left to register, refund or return`,
        async () => {
          const c = kick();
          for (const a of newStakers) equal(await c.read.status([a]), 1, `status(${a})`);
          equal(await c.read.status([g8]), 3, "status(g8)");
          const refundedTo = (
            await pub.getContractEvents({ address: K, abi: kickbackAbi, eventName: "Refunded", fromBlock: deployBlock })
          ).map((l) => [getAddress(l.args.to!), l.args.amount]);
          equal(
            JSON.stringify(refundedTo, (_k, v) => (typeof v === "bigint" ? String(v) : v)),
            JSON.stringify([...returns, ...unmatched], (_k, v) => (typeof v === "bigint" ? String(v) : v)),
            "Refunded events",
          );
          equal(await c.read.spare(), 0n, "spare");
        },
      );
      S1 = await test.snapshot();

      await step("postAttendance refused before eventStart (TooEarly)", async () => {
        const why = await refused(
          "postAttendance early",
          OWNER,
          K,
          kcall({ abi: kickbackAbi, functionName: "postAttendance", args: [[g1], DEP * 7n] }),
        );
        assert(/TooEarly/.test(why), why);
      });
      await step("warp past eventStart", async () => {
        const t = await warpTo(EVENT_START + 3600n);
        assert(t >= EVENT_START, "chain time before eventStart");
        return `chain time ${new Date(Number(t) * 1000).toISOString()}`;
      });
      await step(
        `${HAND_LISTED}payout plan: Ana, Ben, Cai, Dev checked in; share = previewShare(4) = pool / 4`,
        async () => {
          plan.share = await kick().read.previewShare([BigInt(plan.attendees.length)]);
          equal(plan.share, (DEP * plan.stakers) / 4n, "share");
          const stakers = await kick().read.stakerCount();
          equal(stakers, plan.stakers, "stakers");
          const noShows = newStakers.filter((a) => !plan.attendees.includes(a));
          equal(BigInt(noShows.length), stakers - BigInt(plan.attendees.length), "no-shows");
          return `share ${formatEther(plan.share)} ETH, no-shows ${noShows.length}`;
        },
      );
      await step("postAttendance with A, B, C (Eve, Fay, Gus) left off", async () => {
        await send(
          "postAttendance",
          OWNER,
          K,
          kcall({ abi: kickbackAbi, functionName: "postAttendance", args: [plan.attendees, plan.share] }),
        );
        equal(await kick().read.phase(), 1, "phase");
        equal(await kick().read.attendeeCount(), 4n, "attendeeCount");
        // deposits are refused after the list
        const why = await refused("late deposit", gHelper, K, "0x", DEP);
        assert(/NotOpen/.test(why), why);
      });

      await step("A (Eve) challenges with challengeDeposit()", async () => {
        await send("A challenge", g5, K, kcall({ abi: kickbackAbi, functionName: "challenge" }), fee);
        const c = await challengeOf(g5);
        equal(c.state, 1, "state");
        equal(c.deposit, fee, "deposit");
      });
      await step("B (Fay) challenges; the owner matches with arbitrationCost: a Kleros dispute", async () => {
        await send("B challenge", g6, K, kcall({ abi: kickbackAbi, functionName: "challenge" }), fee + 12345n); // overpaid: the extra comes back
        credit(g6, 12345n);
        const r = await send(
          "B matchChallenge",
          OWNER,
          K,
          kcall({ abi: kickbackAbi, functionName: "matchChallenge", args: [g6] }),
          fee,
        );
        const c = await challengeOf(g6);
        equal(c.state, 2, "state");
        equal(c.arbitrationPaid, fee, "arbitrationPaid");
        caseB = { id: c.arbitratorDisputeID, local: c.localDisputeID };
        const created = parseEventLogs({
          abi: klerosExtraAbi,
          eventName: "DisputeCreation",
          logs: r.logs.filter((l) => getAddress(l.address) === LIQUID),
        });
        equal(created.length, 1, "KlerosLiquid DisputeCreation events");
        equal(created[0]!.args._disputeID, caseB.id, "DisputeCreation id");
        equal(getAddress(created[0]!.args._arbitrable), RESOLVER, "DisputeCreation arbitrable");
        const [subcourtID, arbitrated, numberOfChoices, period, , , , ruled] = await liquid.read.disputes([caseB.id]);
        equal(getAddress(arbitrated), RESOLVER, "arbitrated");
        equal(subcourtID, 0n, "subcourtID");
        equal(numberOfChoices, 2n, "numberOfChoices");
        equal(period, 0, "period");
        equal(ruled, false, "ruled");
        equal(await resolver.read.externalIDtoLocalID([caseB.id]), caseB.local, "externalIDtoLocalID");
        const [extraData, isRuled, , onArbitrator] = await resolver.read.disputes([caseB.local]);
        equal(onArbitrator, caseB.id, "disputeIDOnArbitratorSide");
        equal(isRuled, false, "isRuled");
        equal(extraData, EXTRA, "arbitratorExtraData");
        // this case's own description: written by the contract, naming the wallet and the contract, linking the policy
        const [text, uri] = await kick().read.caseMetaEvidence([g6]);
        equal(uri, ipfsPathOf(text), "the contract's IPFS path is the one ipfs add gives for its text");
        const desc = JSON.parse(text);
        assert(desc.title.includes(g6) && desc.question.includes(g6), "title and question name the wallet");
        assert(
          desc.description.includes(g6) && desc.description.includes(K),
          "description names the wallet and the contract",
        );
        equal(desc.fileURI, POLICY, "fileURI");
        const meta = parseEventLogs({
          abi: klerosExtraAbi,
          eventName: "MetaEvidence",
          logs: r.logs.filter((l) => getAddress(l.address) === RESOLVER),
        });
        assert(
          meta.length === 1 && meta[0]!.args._evidence === uri && meta[0]!.args._metaEvidenceID === caseB.local,
          "MetaEvidence with this case's own description under the local ID",
        );
        return `KlerosLiquid case ${caseB.id}, Dispute Resolver local ${caseB.local}, match gas ${r.gasUsed}, description ${uri}`;
      });
      await step("submitEvidence on the Dispute Resolver (B's case)", async () => {
        const uri = "/ipfs/QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o/challenge-details.json";
        const r = await send(
          "submitEvidence B",
          OWNER,
          RESOLVER,
          encodeFunctionData({ abi: disputeResolverAbi, functionName: "submitEvidence", args: [caseB.local, uri] }),
        );
        const ev = parseEventLogs({ abi: klerosExtraAbi, eventName: "Evidence", logs: r.logs });
        assert(ev.length === 1, "Evidence event");
        equal(ev[0]!.args._evidence, uri, "evidence");
        equal(getAddress(ev[0]!.args._party), OWNER, "party");
        equal(getAddress(ev[0]!.args._arbitrator), LIQUID, "arbitrator");
      });
      await step("C (Gus) challenges and is matched: a second Kleros case", async () => {
        await send("C challenge", g7, K, kcall({ abi: kickbackAbi, functionName: "challenge" }), fee);
        await send(
          "C matchChallenge",
          OWNER,
          K,
          kcall({ abi: kickbackAbi, functionName: "matchChallenge", args: [g7] }),
          fee + 999n,
        ); // extra 999 wei comes back
        credit(OWNER, 999n);
        const c = await challengeOf(g7);
        caseC = { id: c.arbitratorDisputeID, local: c.localDisputeID };
        equal(caseC.id, caseB.id + 1n, "consecutive case numbers");
        equal(getAddress((await liquid.read.disputes([caseC.id]))[1]), RESOLVER, "arbitrated");
        equal(await resolver.read.externalIDtoLocalID([caseC.id]), caseC.local, "externalIDtoLocalID");
        return `KlerosLiquid case ${caseC.id}, local ${caseC.local}`;
      });
      await step(
        "addAttendees refused for a disputed challenger (InDispute); releasePayouts refused during the window",
        async () => {
          const why = await refused(
            "addAttendees B",
            OWNER,
            K,
            kcall({ abi: kickbackAbi, functionName: "addAttendees", args: [[g6]] }),
          );
          assert(/InDispute/.test(why), why);
          const why2 = await refused(
            "releasePayouts early",
            gHelper,
            K,
            kcall({ abi: kickbackAbi, functionName: "releasePayouts" }),
          );
          assert(/TooEarly/.test(why2), why2);
        },
      );
      await step(
        `Kleros delivers B's ruling 1 (${mode === "fork" ? "impersonated KlerosLiquid calls Resolver.rule" : "MockKlerosLiquid.giveFinalRuling"})`,
        async () => {
          await deliverRuling("rule(B,1)", caseB.id, 1n);
          const [, isRuled, ruling] = await resolver.read.disputes([caseB.local]);
          equal(isRuled, true, "isRuled");
          equal(ruling, 1n, "ruling");
          // only the arbitrator can rule
          await refused(
            "rule from a stranger",
            gHelper,
            RESOLVER,
            encodeFunctionData({ abi: klerosExtraAbi, functionName: "rule", args: [caseC.id, 1n] }),
          );
        },
      );
      await step("Kleros delivers C's ruling 2", async () => {
        await deliverRuling("rule(C,2)", caseC.id, 2n);
        const [, isRuled, ruling] = await resolver.read.disputes([caseC.local]);
        equal(isRuled, true, "isRuled");
        equal(ruling, 2n, "ruling");
      });
      await step("warp past the challenge window and A's match window", async () => {
        const c = await challengeOf(g5);
        const t = await warpTo(c.matchEndsAt + 10n);
        assert(t > (await kick().read.challengeEndsAt()), "still inside the challenge window");
      });
      await step(
        "releasePayouts (anyone): A counted as attended, B and C still in a case: 2 shares held back",
        async () => {
          await send("releasePayouts", gHelper, K, kcall({ abi: kickbackAbi, functionName: "releasePayouts" }));
          const c = kick();
          share = await c.read.payoutShare();
          equal(share, (DEP * 7n) / 7n, "share: 5 attendees + 2 open cases"); // 7 deposits / 7
          equal(await c.read.heldBack(), share * 2n, "heldBack");
          equal(await c.read.phase(), 2, "phase");
          for (const a of [g1, g2, g3, g4, g5]) credit(a, share);
          credit(g5, fee); // A's unmatched challenge deposit back
          equal(await c.read.challengeEscrow(), fee * 2n * 2n - fee * 2n, "challengeEscrow"); // B and C: 2*fee in, fee spent each
          await assertLedger([
            ["g1", g1],
            ["g2", g2],
            ["g3", g3],
            ["g4", g4],
            ["A", g5],
          ]);
          return `share ${formatEther(share)} ETH, heldBack ${formatEther(share * 2n)}`;
        },
      );
      await step("settle B (resolveChallenge): attended, so the held share and the challenge money", async () => {
        await send(
          "resolveChallenge B",
          gHelper,
          K,
          kcall({ abi: kickbackAbi, functionName: "resolveChallenge", args: [g6] }),
        );
        credit(g6, share + fee); // held share, and what is left of both deposits after the fee (2*fee - fee)
        await assertLedger([["B", g6]]);
        equal(await kick().read.attended([g6]), true, "attended(B)");
      });
      await step(
        "settle C: ruled absent, so the held share is split between the 6 attendees and the matcher gets the challenge money",
        async () => {
          const r = await send(
            "resolveChallenge C",
            gHelper,
            K,
            kcall({ abi: kickbackAbi, functionName: "resolveChallenge", args: [g7] }),
          );
          each = share / 6n;
          const split = parseEventLogs({ abi: kickbackAbi, eventName: "HeldShareSplit", logs: r.logs });
          equal(split[0]?.args.each, each, "HeldShareSplit.each");
          for (const a of [g1, g2, g3, g4, g5, g6]) credit(a, each);
          credit(OWNER, fee);
          await assertLedger([
            ["g1", g1],
            ["g2", g2],
            ["g3", g3],
            ["g4", g4],
            ["A", g5],
            ["B", g6],
            ["C", g7],
            ["owner", OWNER],
          ]);
          equal(await kick().read.attended([g7]), false, "attended(C)");
          return `each ${each} wei`;
        },
      );
      await step("owed: nothing to claim (all EOAs), claim() refuses", async () => {
        equal(await kick().read.owedTotal(), 0n, "owedTotal");
        const why = await refused("claim", g1, K, kcall({ abi: kickbackAbi, functionName: "claim", args: [g1] }));
        assert(/NothingToClaim/.test(why), why);
      });
      await step("sweep the rounding dust to the owner; the contract ends at exactly 0 ETH", async () => {
        const dust = await pub.getBalance({ address: K });
        equal(dust, share - each * 6n, "dust");
        equal(await kick().read.reserved(), 0n, "reserved");
        await send("sweep", OWNER, K, kcall({ abi: kickbackAbi, functionName: "sweep", args: [OWNER] }));
        credit(OWNER, dust);
        equal(await pub.getBalance({ address: K }), 0n, "contract balance");
        return `dust ${dust} wei`;
      });
      await step("final balances to the wei: everyone on the final list got pool / 6", async () => {
        // KlerosLiquid keeps the two arbitration fees
        credit(LIQUID, fee * 2n);
        await assertLedger(Object.entries({ g1, g2, g3, g4, g5, g6, g7, g8, gW, gCopy, gStray, OWNER, LIQUID }));
        const total = share + each;
        equal(total, (DEP * 7n) / 6n, "per attendee");
        return `per attendee ${formatEther(total)} ETH; C lost the deposit and the fee; the owner paid B's fee ${formatEther(fee)}`;
      });
    } catch {
      // a failed step is in `results`; the other scenarios still run
    }

    // ================================================================ cancel: full refunds
    try {
      scenario = "cancel";
      assert(S1, "no snapshot after registration (the lifecycle failed early)");
      await test.revert({ id: S1 });
      S1 = await test.snapshot(); // a snapshot is used up by its revert
      for (const a of [g1, g2, g3, g4, g5, g6, g7, OWNER]) await track(a);
      await step("state back to after registration (7 stakers)", async () => {
        equal(await kick().read.stakerCount(), 7n, "stakerCount");
        equal(await pub.getBalance({ address: K }), DEP * 7n, "contract balance");
        equal(await kick().read.phase(), 0, "phase");
      });
      await step("cancel(): every registered staker gets exactly the deposit back", async () => {
        await send("cancel", OWNER, K, kcall({ abi: kickbackAbi, functionName: "cancel" }));
        for (const a of [g1, g2, g3, g4, g5, g6, g7]) credit(a, DEP);
        await assertLedger(Object.entries({ g1, g2, g3, g4, g5, g6, g7, OWNER }));
        equal(await kick().read.phase(), 3, "phase");
        equal(await pub.getBalance({ address: K }), 0n, "contract balance");
      });
      await step("after cancel: deposits refused, postAttendance refused, a sweep of 0 works", async () => {
        const why = await refused("deposit after cancel", gHelper, K, "0x", DEP);
        assert(/NotOpen/.test(why), why);
        const why2 = await refused(
          "post after cancel",
          OWNER,
          K,
          kcall({ abi: kickbackAbi, functionName: "postAttendance", args: [[g1], DEP] }),
        );
        assert(/NotOpen/.test(why2), why2);
        await send("sweep after cancel", OWNER, K, kcall({ abi: kickbackAbi, functionName: "sweep", args: [OWNER] }));
        equal(await pub.getBalance({ address: K }), 0n, "contract balance");
      });
    } catch {
      // recorded in `results`
    }

    // ================================================================ claimDeadline: emergencyWithdraw
    try {
      scenario = "emergency";
      assert(S1, "no snapshot after registration (the lifecycle failed early)");
      await test.revert({ id: S1 });
      for (const a of [g1, g2, g3, g4, g5, g6, g7, OWNER]) await track(a);
      await step("emergencyWithdraw refused before claimDeadline (TooEarly)", async () => {
        equal(await kick().read.stakerCount(), 7n, "stakerCount");
        const why = await refused(
          "emergencyWithdraw early",
          g1,
          K,
          kcall({ abi: kickbackAbi, functionName: "emergencyWithdraw", args: [g1] }),
        );
        assert(/TooEarly/.test(why), why);
      });
      await step("warp past claimDeadline; postAttendance and cancel refused (TooLate)", async () => {
        await warpTo(CLAIM_DEADLINE + 60n);
        const why = await refused(
          "post late",
          OWNER,
          K,
          kcall({ abi: kickbackAbi, functionName: "postAttendance", args: [[g1], DEP * 7n] }),
        );
        assert(/TooLate/.test(why), why);
        const why2 = await refused("cancel late", OWNER, K, kcall({ abi: kickbackAbi, functionName: "cancel" }));
        assert(/TooLate/.test(why2), why2);
      });
      await step(
        "each staker emergencyWithdraws exactly the deposit (Ben to another address); the contract ends at 0",
        async () => {
          for (const a of [g1, g3, g4, g5, g6, g7]) {
            await send(
              `emergencyWithdraw ${a}`,
              a,
              K,
              kcall({ abi: kickbackAbi, functionName: "emergencyWithdraw", args: [a] }),
            );
            credit(a, DEP);
          }
          await send(
            "emergencyWithdraw Ben to g1",
            g2,
            K,
            kcall({ abi: kickbackAbi, functionName: "emergencyWithdraw", args: [g1] }),
          );
          credit(g1, DEP);
          const why = await refused(
            "withdraw twice",
            g3,
            K,
            kcall({ abi: kickbackAbi, functionName: "emergencyWithdraw", args: [g3] }),
          );
          assert(/NotAStaker/.test(why), why);
          const why2 = await refused(
            "non-staker withdraw",
            g8,
            K,
            kcall({ abi: kickbackAbi, functionName: "emergencyWithdraw", args: [g8] }),
          );
          assert(/NotAStaker/.test(why2), why2);
          await assertLedger(Object.entries({ g1, g2, g3, g4, g5, g6, g7 }));
          equal(await kick().read.stakerCount(), 0n, "stakerCount");
          equal(await pub.getBalance({ address: K }), 0n, "contract balance");
        },
      );
    } catch {
      // recorded in `results`
    }
  } finally {
    await test.revert({ id: S0 });
  }
  const passed = results.filter((r) => r.ok).length;
  log(`${passed}/${LIFECYCLE_STEPS} steps passed. Chain reverted to its starting snapshot.`);
  return results;
}
