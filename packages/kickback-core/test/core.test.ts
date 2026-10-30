// The core's pure half: browser-safe; the live contract's constructor arguments and case description are unchanged;
// parseCsv reads text exactly like csv-parse; the generic juror policy and case description template keep the live
// rules, name the wallet and fit the contract; the event's own clock is read back from a case description.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { kickbackAbi, liveEvent } from "@kickback/contracts";
import { parse } from "csv-parse/sync";
import { encodeAbiParameters, encodeDeployData, getAddress, keccak256, parseEther, size, zeroAddress } from "viem";
import { describe, expect, test } from "vitest";

import * as core from "../src";

import { read, readBytes } from "./docs";
import { CLOCK_CASES } from "./eventClockCases";

const E = (x: string | number) => parseEther(String(x));
const GENERIC_TEXT = read(core.GENERIC_METAEVIDENCE_TEMPLATE);
const GENERIC_POLICY_TEXT = read(core.GENERIC_POLICY);
const GENERIC_POLICY_PATH = core.ipfsPathOf(GENERIC_POLICY_TEXT);
const LIVE_TEXT = read(core.DEFAULT_METAEVIDENCE_TEMPLATE);
// a new event as the new-event form would give it
const FORM = {
  eventTitle: 'Onchain Justice Night: Talks & "Dinner"',
  eventName: "Onchain Justice Night, Berlin 2027",
  eventWhen: "Friday 12 March 2027, 19:00-23:00 CET",
  eventWhere: "Café Example, Main Street 1, Berlin",
  hosts: "Kleros and friends",
  eventLink: "https://luma.com/your-event",
  deposit: "0.01",
  eventStart: "2027-03-12T19:00:00+01:00",
};
const ORGANISER = "0x259a1084C2043a7B3b5b288596E05C41b8EFa5d6";
const MAINNET: core.NetworkInput = {
  chainId: 1,
  explorer: "https://etherscan.io",
  rpcUrl: "https://rpc.mevblocker.io",
  logChunk: 5000,
  kleros: { policyURI: GENERIC_POLICY_PATH },
};
// EIP-55 test vectors: mixed case once checksummed
const W = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const C = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";

// The legacy repo's config.json (the live event) and config.rehearsal.json, as deployed from.
const LIVE_CONFIG: core.RawConfig = {
  eventName: "Truth Pays: Devcon Mumbai 2026",
  chain: "ethereum",
  rpcUrl: "https://rpc.mevblocker.io",
  logChunk: 5000,
  deposit: "0.01",
  receiver: "0xd5c6A73c05FA431c748781DaBAA99Fe2590d677D",
  contract: "0xd5c6A73c05FA431c748781DaBAA99Fe2590d677D",
  depositOpensAt: "2026-10-28T14:37:59+05:30",
  depositDeadline: "2026-11-04T18:00:00+05:30",
  depositTicketPattern: "deposit|commit|stake",
  columns: {},
  eventStart: "2026-11-04T18:00:00+05:30",
  claimDeadline: "2026-11-18T18:00:00+05:30",
  owner: "0x259a1084C2043a7B3b5b288596E05C41b8EFa5d6",
  mode: "live",
  deployBlock: 26290226,
  kleros: {
    court: 0,
    jurors: 3,
    policyURI: "/ipfs/QmPzb9q9TyHS2jPmoCd1U9eDfZ9Nijh5NSFhhvJGVU7knE",
    metaEvidenceTemplate: "docs/metaevidence.template.json",
  },
};
const REHEARSAL_CONFIG: core.RawConfig = {
  ...LIVE_CONFIG,
  eventName: "Truth Pays: REHEARSAL",
  receiver: "0x0000000000000000000000000000000000000001",
  contract: "",
  depositOpensAt: "2026-10-27T00:00:00+05:30",
  eventStart: "2026-10-27T00:00:00+05:30",
  claimDeadline: "2026-11-10T00:00:00+05:30",
  mode: "rehearsal",
  poolCap: "0.25",
  deployBlock: "",
};

// ---------------------------------------------------------------- the module itself

test("the core is browser-safe: it imports only viem and @kickback/contracts and uses no Node API", () => {
  const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
  for (const file of fs.readdirSync(src).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const text = fs.readFileSync(path.join(src, file), "utf8");
    const imports = [...text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]!);
    for (const i of imports) expect(i, `${file} imports ${i}`).toMatch(/^(viem|@kickback\/contracts|\.\/\w+)$/);
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
    for (const re of [
      /\bprocess\./,
      /\bBuffer\b/,
      /\brequire\(/,
      /\bimport\.meta\b/,
      /node:/,
      /__dirname|__filename/,
      /\bimport\(/,
    ])
      expect(code, `${file} uses ${re}`).not.toMatch(re);
  }
});

test("every pure and provider-bound export of core.mjs is here (safeBatch is not ported)", () => {
  const names = (
    "DEPOSITED_EVENT DEPOSITED_TOPIC TOKEN_TRANSFER_TOPIC CHAINS SYMBOL DECIMALS DEFAULT_RPC DEFAULT_LOG_CHUNK MAX_DEPOSIT_ETH " +
    "normalizeConfig MIN_SETTLEMENT_WINDOW CHALLENGE_PERIOD MATCH_PERIOD PAYOUT_GAS TX_GAS_CAP gasLimitFor KLEROS KLEROS_IPFS_UPLOAD " +
    "KLEROS_IPFS_GATEWAY RULINGS KLEROS_PERIODS IPFS_PATH_RE isIpfsPath STALE_PINS klerosConfig STATUS PHASES CHALLENGE_STATE SLOT " +
    "MAX_METAEVIDENCE_BYTES MAX_TEMPLATE_BYTES DEFAULT_METAEVIDENCE_TEMPLATE GENERIC_POLICY GENERIC_METAEVIDENCE_TEMPLATE ipfsCidV0 " +
    "ipfsPathOf renderCase EVENT_FIELDS DISGUISE_RE eventDetails templateValues caseTemplate deploySettings deployArgs offsetText " +
    "TZ_OFFSETS ZONE_OFFSETS checkZoneName zoneIs describeWhen eventClock newEventConfig isKnownResolver codeFingerprint readEvent " +
    "contractConfig parseCsv csvCell uncell toCsv detectColumns TX_HASH_RE extractTxHash extractTxHashes normAddress fmt fmtEth " +
    "lumaDecision isContractCode depKey OTHER_NETWORKS otherNetworkOf depositsInLogs verifyTx verifyRegistrations MONEY_CODES " +
    "UNREAD_CODES resolveClaims pairReturns getLogsChunked incomingDeposits checkContract CHECK_COLUMNS checkGuests " +
    "depositsOverview PAYOUT_COLUMNS buildPayout findDeployBlock createdIn checkDeployBlock errorText ISSUE_CODES"
  ).split(" ");
  for (const name of names) expect(core, name).toHaveProperty(name);
  expect(core.ISSUE_CODES).toHaveLength(24);
});

test("gasLimitFor adds 30% and never goes over 2^24 (EIP-7825)", () => {
  expect(core.TX_GAS_CAP).toBe(2n ** 24n);
  expect(core.gasLimitFor(100_000n)).toBe(130_000n);
  expect(core.gasLimitFor(100_000, 50n)).toBe(150_000n);
  expect(core.gasLimitFor(13_000_000n)).toBe(core.TX_GAS_CAP);
});

// ---------------------------------------------------------------- the live contract

describe("the live contract", () => {
  // keccak256 of the encoded constructor arguments: the contract at 0xd5c6A73c05FA431c748781DaBAA99Fe2590d677D was deployed with these
  const GOLDEN = [
    {
      cfg: LIVE_CONFIG,
      args: "0xa589c22ae97e8bbf894dc9b0c4ccda747eeb55f10d5093ddac6c3814a83ca8f3",
      sample: "/ipfs/QmPKFnR1fdqFVF2beZbb8cou1SpUowpbN6dL6sbyS8A3f6",
    },
    {
      cfg: REHEARSAL_CONFIG,
      args: "0x4a18422e2410ce159e4cafce5785bab70fde3c6ebb5a07506e521fdb00d1fa22",
      sample: "/ipfs/QmaTmB7ZmU4bReTho27imPXmrTHkQQM6kDwvdykmSfnJzh",
    },
  ];
  const encoded = (args: core.KickbackDeployArgs) =>
    keccak256(encodeDeployData({ abi: kickbackAbi, bytecode: "0x", args }));

  test.each(GOLDEN)(
    "constructor arguments and case description are unchanged: $cfg.eventName",
    ({ cfg: raw, args: golden, sample }) => {
      const cfg = core.normalizeConfig(raw);
      const owner = cfg.owner!;
      const args = core.deployArgs(cfg, owner, LIVE_TEXT);
      expect(encoded(args)).toBe(golden);
      // the console's way: computed for the zero address, the connected wallet put in afterwards
      const [deposit, name, , start, end, arbitration] = core.deployArgs(cfg, zeroAddress, LIVE_TEXT);
      expect(encoded([deposit, name, getAddress(owner), start, end, arbitration])).toBe(golden);
      // the case description jurors see, for a sample wallet: same IPFS path
      const t = core.caseTemplate(LIVE_TEXT, core.templateValues(cfg, owner));
      expect(core.ipfsPathOf(t.sample)).toBe(sample);
      expect([t.pieces, t.slots]).toEqual([args[5].metaEvidenceTemplate, args[5].metaEvidenceSlots]);
    },
  );

  test("the live juror policy and case description template are byte-for-byte unchanged", () => {
    const sha = (f: string) => crypto.createHash("sha256").update(readBytes(f)).digest("hex");
    expect(sha("docs/attendance-policy.md")).toBe("3a641f2590e36d4330225dcd5341949290f5ef7bf431bb89656078c0f2f453cd");
    expect(sha("docs/metaevidence.template.json")).toBe(
      "db9bfefb39db242ed57372a9f71978d78b30bdd935f0df618393ce4d9b70f3a0",
    );
    // and the pinned path of the live event is the one computed from the file
    expect(core.ipfsPathOf(read("docs/attendance-policy.md"))).toBe(liveEvent.policyURI);
    expect(core.normalizeConfig(LIVE_CONFIG).kleros?.policyURI).toBe(liveEvent.policyURI);
  });
});

// ---------------------------------------------------------------- CSV

const CSV_OPTS = { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true };
const viaCsvParse = (text: string) => {
  try {
    return JSON.stringify(parse(text, CSV_OPTS));
  } catch {
    return "error";
  }
};
const viaCore = (text: string) => {
  try {
    return JSON.stringify(core.parseCsv(text));
  } catch {
    return "error";
  }
};

test("parseCsv reads CSV text exactly like csv-parse, quirks included", () => {
  const cases = [
    "a,b\n1,2\n", "a,b\r\n1,2\r\n3,4", "a,b\r1,2\r3,4", "a,b\r\n1,2\n3,4\r\n", "a,b\n1,2\r\n3,4\n", "a,b\n1\n", "a,b\n1,2,3\n",
    "a,a\n1,2\n", "a,b\n\n\n1,2\n\n", "a,b\n,\n", "a,b\n \n1,2", '﻿a,b\n"x ""y""",2\n', 'a,b\n"multi\nline",2\n',
    'a,b\n"multi\r\nline",2\r\n', 'a,b\nab"c,2\n', 'a,b\n"ab"c,2\n', 'a,b\n"ab" ,2\n', 'a,b\n"ab",2 \n', "a,b\n1,2\n3", "", "a,b",
    "a,b\n", ",b\n1,2\n", 'a,b\n"",""\n', 'a,b\n"a\rb",2\n', 'a,b\n1,"2"\n', "a,b\r\n\r\n1,2\r\n", "a\n1\n\n", 'a\n""\n', "a,b\n1,2\r",
    "a,b\n1\r2,3\n", "a,b\r\n1\r2,3\r\n", "a,b\r\n1\n2,3\r\n", 'a,b\n" x",2\n', "a,b\n﻿1,2\n", "a,b,c\n1,2\n", 'a,b\n"1"\n',
    'a\n"x', 'a\n""""\n', '"a\r\nb",c\r\n1,2\r\n', '"a"\r1\r', 'a\n"x"\0\n', "﻿", "\n\na,b\n1,2", "__proto__,b\n1,2\n",
  ]; // prettier-ignore
  for (const c of cases) expect(viaCore(c), JSON.stringify(c)).toBe(viaCsvParse(c));
  // a Luma export: BOM, CRLF, quoted answers with commas, quotes and line breaks, a free guest's short row
  const luma =
    '﻿api_id,name,email,ticket_name,approval_status,checked_in_at,eth_address,"Deposit tx link (Committed Spot only), etherscan.io"\r\n' +
    `gst-1,"Ana ""A"" Lee",ana@x.io,Committed Spot (0.01 ETH),approved,2026-11-04T13:00:00.000Z,0x${"ab".repeat(20)},"https://etherscan.io/tx/0x${"12".repeat(32)}\nthanks, Ana"\r\n` +
    "gst-2,Ben,ben@x.io,Request to Join (Free),pending_approval,,\r\n\r\n";
  expect(viaCore(luma)).toBe(viaCsvParse(luma));
  expect(core.parseCsv(luma)[0]!.name).toBe('Ana "A" Lee');
  // random text over the characters that matter (seeded, so a failure can be replayed)
  let seed = 20261028;
  const rand = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
  const alphabet = ["a", "b", "a", ",", ",", '"', '"', "\n", "\r", "\r\n", " ", "é", "﻿", "\0", "x"];
  for (let i = 0; i < 5000; i++) {
    const text = Array.from(
      { length: Math.floor(rand() * 30) },
      () => alphabet[Math.floor(rand() * alphabet.length)],
    ).join("");
    expect(viaCore(text), `case ${i}: ${JSON.stringify(text)}`).toBe(viaCsvParse(text));
  }
  // and well-formed exports: fields quoted when they must be, mixed line endings, blank lines, short and long rows
  const pick = <T>(a: readonly T[]) => a[Math.floor(rand() * a.length)]!;
  let rowsSeen = 0;
  for (let i = 0; i < 3000; i++) {
    const field = () => {
      const v = Array.from({ length: Math.floor(rand() * 6) }, () =>
        pick(["a", "b", "é", " ", ",", '"', "\n", "\r\n", "0x1f"]),
      ).join("");
      return /[",\r\n]/.test(v) || rand() < 0.2 ? `"${v.replace(/"/g, '""')}"` : v;
    };
    const eol = pick(["\n", "\r\n", "\r"]);
    const lines = Array.from({ length: 1 + Math.floor(rand() * 5) }, () =>
      rand() < 0.1 ? "" : Array.from({ length: 1 + Math.floor(rand() * 4) }, field).join(","),
    );
    const text =
      (rand() < 0.2 ? "﻿" : "") + lines.join(rand() < 0.9 ? eol : pick(["\n", "\r\n"])) + (rand() < 0.5 ? eol : "");
    const expected = viaCsvParse(text);
    if (expected !== "error") rowsSeen += (JSON.parse(expected) as unknown[]).length;
    expect(viaCore(text), `case ${i}: ${JSON.stringify(text)}`).toBe(expected);
  }
  expect(rowsSeen).toBeGreaterThan(3000);
});

test("toCsv writes formula-safe cells that read back unchanged", () => {
  const rows = [
    { name: '=HYPERLINK("x")', email: "a@x.io", note: 'line 1\nline 2, "quoted"' },
    { name: "+cmd", email: "-b@x.io", note: "@sum" },
    { name: "Ana", email: "", note: undefined },
  ];
  const text = core.toCsv(rows, ["name", "email", "note"]);
  expect(text).toBe(
    `name,email,note\n"'=HYPERLINK(""x"")",a@x.io,"line 1\nline 2, ""quoted"""\n'+cmd,'-b@x.io,'@sum\nAna,,\n`,
  );
  expect(core.parseCsv(text)).toEqual(parse(text, CSV_OPTS));
  expect(core.parseCsv(text).map((r) => core.uncell(r.name))).toEqual(['=HYPERLINK("x")', "+cmd", "Ana"]);
});

// ---------------------------------------------------------------- generic texts for new events

test("the generic juror policy keeps the live rules, never names the live event, and has its own IPFS path", () => {
  const live = read("docs/attendance-policy.md");
  const generic = GENERIC_POLICY_TEXT;
  expect(generic).not.toMatch(/Truth Pays|Devcon|Mumbai|Hitchki|BKC|\bIST\b|Luma|Arkiv|Golem|Web3|2026/);
  expect(generic).toMatch(/the event named in the case description/);
  expect(generic).toMatch(/the deposit contract that created the case/);
  const sections = (t: string) =>
    Object.fromEntries(
      t
        .split(/^## /m)
        .slice(1)
        .map((s) => [s.slice(0, s.indexOf("\n")), s.slice(s.indexOf("\n"))]),
    );
  const liveS = sections(live);
  const genS = sections(generic);
  // the same rules, word for word, where nothing is event-specific
  for (const h of ["Answers", "Appeals", "What happens after the final ruling"])
    expect(genS[h], `section "${h}"`).toBe(liveS[h]);
  for (const rule of [
    "If the evidence and the contract disagree, the contract is correct.",
    "Evidence sent from the organiser's wallet named in the case description is the organiser's own statement. A statement presented as the organiser's but sent from another wallet is not.",
    "The challenger must show that attendance is **more likely than not**.",
    "Sending someone else in their place does not count as attending, unless the organiser approved the transfer of the spot before the event.",
    "If the organiser confirms in the case that the person attended, rule **Attended**.",
    "If neither side provides meaningful evidence, rule **Did not attend** (the challenger has not shown attendance).",
    "Evidence that is clearly edited, generated, or from another date or place should be ignored, and counts against the party who submitted it.",
    "has 1 day to challenge, paying an ETH deposit equal to the Kleros fee.",
    "has 1 day to match that deposit. Matching creates this dispute.",
    '"Refuse to arbitrate" (option 0) can be funded like an answer',
  ]) {
    expect(live.includes(rule), `the live policy no longer says: ${rule}`).toBe(true);
    expect(generic.includes(rule), `the generic policy lost: ${rule}`).toBe(true);
  }
  expect(core.isIpfsPath(GENERIC_POLICY_PATH) && !core.STALE_PINS.some((p) => GENERIC_POLICY_PATH.includes(p))).toBe(
    true,
  );
  expect(GENERIC_POLICY_PATH).not.toBe(core.ipfsPathOf(live));
});

test("the generic case description is valid ERC-1497 once filled in: it names the event, the wallet and the organiser, and fits", () => {
  const cfg = core.newEventConfig(FORM, MAINNET, ORGANISER);
  expect(cfg.claimDeadline).toBe("2027-03-26T18:00:00.000Z"); // 14 days after the start by default
  expect(cfg.depositUnits).toBe(E("0.01"));
  const args = core.deployArgs(cfg, ORGANISER, GENERIC_TEXT, { name: "metaevidence.generic.template.json" });
  const [deposit, eventName, owner, start, end, arbitration] = args;
  expect([deposit, eventName, owner, start, end]).toEqual([
    E("0.01"),
    FORM.eventName,
    ORGANISER,
    1804874400n,
    1806084000n,
  ]);
  expect(arbitration.disputeResolver).toBe(getAddress(core.KLEROS[1]!.disputeResolver)); // Kleros's own Dispute Resolver on mainnet
  expect(arbitration.extraData).toBe(encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [0n, 3n])); // General Court, 3 jurors
  expect(arbitration.policyURI).toBe(GENERIC_POLICY_PATH);
  const text = core.renderCase(
    { pieces: arbitration.metaEvidenceTemplate, slots: arbitration.metaEvidenceSlots },
    W,
    C,
  );
  const meta = JSON.parse(text);
  // ERC-1497 metaevidence, the same shape as the live template
  const liveMeta = JSON.parse(
    core.caseTemplate(LIVE_TEXT, core.templateValues(core.normalizeConfig(LIVE_CONFIG), ORGANISER)).sample,
  );
  expect(Object.keys(meta)).toEqual(Object.keys(liveMeta));
  expect(meta.category).toBe("Event attendance");
  expect(meta.rulingOptions.titles).toEqual(["Attended", "Did not attend"]);
  expect(meta.rulingOptions.type).toBe("single-select");
  expect(meta.rulingOptions.descriptions).toHaveLength(2);
  expect(meta.fileURI).toBe(GENERIC_POLICY_PATH);
  for (const key of ["title", "question"]) expect(meta[key]).toContain(W);
  for (const d of meta.rulingOptions.descriptions) expect(d).toContain(W);
  for (const v of [
    FORM.eventTitle,
    FORM.eventName,
    FORM.eventWhen,
    FORM.eventWhere,
    FORM.hosts,
    FORM.eventLink,
    W,
    C,
    ORGANISER,
    "0.01 ETH",
    `https://etherscan.io/address/${C}#readContract`,
  ])
    // prettier-ignore
    expect(meta.description, `the description names ${v}`).toContain(v);
  expect(meta.aliases).toEqual({
    [W]: "Challenger (the guest's wallet)",
    [W.toLowerCase()]: "Challenger (the guest's wallet)",
    [ORGANISER]: "Organiser (the deposit contract's owner wallet)",
    [ORGANISER.toLowerCase()]: "Organiser (the deposit contract's owner wallet)",
  });
  expect(text).not.toMatch(/\{\{|\}\}|Truth Pays|Devcon|Mumbai|Luma/);
  expect(core.isIpfsPath(core.ipfsPathOf(text))).toBe(true);
  // the template's placeholders are all known ones; it uses every runtime value and the organiser
  const used = new Set([...GENERIC_TEXT.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
  expect([...used].sort()).toEqual([
    "contract", "deposit", "eventLink", "eventName", "eventTitle", "eventWhen", "eventWhere", "explorer", "hosts", "owner", "ownerLower",
    "policyURI", "wallet", "walletLower",
  ]); // prettier-ignore
  // every field at its longest (3-byte characters, or quotes that JSON doubles) still fits the contract
  for (const fill of [(f: core.EventField) => "€".repeat(f.max), (f: core.EventField) => '"\\'.repeat(f.max / 2)]) {
    const big = Object.fromEntries(
      core.EVENT_FIELDS.map((f) => [f.key, f.link ? "https://x.io/" + "a".repeat(f.max - 13) : fill(f)]),
    );
    const t = core.caseTemplate(
      GENERIC_TEXT,
      core.templateValues(core.newEventConfig({ ...FORM, ...big }, MAINNET, ORGANISER), ORGANISER),
    );
    const bytes = size(encodeAbiParameters([{ type: "string[]" }, { type: "bytes" }], [t.pieces, t.slots]));
    expect(bytes).toBeLessThan(core.MAX_TEMPLATE_BYTES / 2);
    expect(JSON.parse(t.sample).question.includes(big.eventTitle)).toBe(true); // escaped, not broken
  }
});

test("the new-event form and the generic template refuse what would not work, with plain messages", () => {
  const refuse = (over: Partial<typeof FORM> & { claimDeadline?: string }, re: RegExp) =>
    expect(() => core.newEventConfig({ ...FORM, ...over }, MAINNET, ORGANISER), JSON.stringify(over)).toThrow(re);
  refuse({ eventTitle: " " }, /^Event title: please fill this in\.$/);
  refuse({ eventWhere: "" }, /Venue or city: please fill this in/);
  refuse({ eventName: "x".repeat(81) }, /Short name is too long \(81 characters, at most 80\)/);
  refuse({ hosts: "Ann\nBob" }, /Hosts: please keep it on one line/);
  // characters that disguise a text: next line (C1), line and paragraph separators, zero-width characters,
  // text-direction overrides and isolates, the byte-order mark
  const ch = (code: number) => String.fromCharCode(code);
  for (const code of [0x85, 0x9f, 0x2028, 0x2029, 0x200b, 0x200f, 0x202e, 0x202a, 0x2066, 0x2069, 0xfeff])
    refuse(
      { eventWhere: `Caf${ch(0xe9)} ${ch(code)}nilreb` },
      /Venue or city: please keep it on one line, without invisible or text-direction characters/,
    );
  refuse(
    { eventName: `OJN${ch(0x200b)}${ch(0x2066)}x${ch(0x2069)}` },
    /Short name: please keep it on one line, without invisible/,
  );
  // NFC: "é" typed as e + combining accent is kept as the single character the preview shows
  expect(core.eventDetails({ ...FORM, eventWhere: `Cafe${ch(0x301)}, Berlin` }).eventWhere).toBe(
    `Caf${ch(0xe9)}, Berlin`,
  );
  refuse({ eventTitle: "{{wallet}}" }, /Event title can't contain "\{\{" or "\}\}"/);
  refuse({ eventLink: "luma.com/x" }, /Registration link must be a web address starting with https:\/\//);
  refuse({ deposit: "" }, /Deposit: type an amount of ETH such as 0\.01/);
  refuse({ deposit: "0" }, /Deposit: it must be more than 0 ETH/);
  refuse({ deposit: "25" }, /more than 1 ETH per guest looks like a mistake/);
  refuse({ eventStart: "2027-03-12T19:00" }, /Event start: pick a date, a time and a timezone/);
  refuse({ claimDeadline: "2027-03-18T19:00:00+01:00" }, /at least 7 days after the event starts/);
  expect(() => core.newEventConfig(FORM, MAINNET, "")).toThrow(/Connect your wallet first/);
  // every wrong field at once, for the form to highlight
  try {
    core.eventDetails({ ...FORM, eventTitle: "", hosts: "" });
    expect.fail("accepted");
  } catch (e) {
    expect(Object.keys((e as core.KickbackError).fields ?? {})).toEqual(["eventTitle", "hosts"]);
  }
  // the template itself: a generic placeholder with no value, and the live checks still apply
  const cfg = core.newEventConfig(FORM, MAINNET, ORGANISER);
  const values = core.templateValues(cfg, ORGANISER);
  expect(() => core.caseTemplate(GENERIC_TEXT, { ...values, eventWhere: "" }, { name: "the template" })).toThrow(
    /the template names the event's "Venue or city" \(\{\{eventWhere\}\}\), but it is empty/,
  );
  expect(() => core.caseTemplate(GENERIC_TEXT, { ...values, owner: "" })).toThrow(/names the organiser's wallet/);
  expect(() => core.deployArgs({ ...cfg, kleros: { policyURI: "" } }, ORGANISER, GENERIC_TEXT)).toThrow(
    /kleros\.policyURI/,
  );
  expect(() => core.deployArgs(cfg, ORGANISER, undefined)).toThrow(/No case description template/);
  // a value that looks like a placeholder never becomes one: the contract's slots stay the template's own
  const plain = core.caseTemplate(GENERIC_TEXT, values);
  const tricky = core.caseTemplate(GENERIC_TEXT, { ...values, hosts: "{{wallet}} and {{contract}}" });
  expect(tricky.slots).toBe(plain.slots);
  expect(JSON.parse(tricky.sample).description).toContain("hosted by {{wallet}} and {{contract}}");
});

test("describeWhen writes the date and time in the event's own timezone", () => {
  expect(core.describeWhen("2026-11-04T18:00:00+05:30", "2026-11-04T22:00:00+05:30", "IST")).toBe(
    "Wednesday 4 November 2026, 18:00-22:00 IST",
  );
  expect(core.describeWhen("2027-03-12T19:00:00+01:00", "2027-03-12T23:00:00+01:00")).toBe(
    "Friday 12 March 2027, 19:00-23:00 UTC+01:00",
  );
  expect(core.describeWhen("2027-03-12T22:00:00-05:00", "2027-03-13T02:30:00-05:00", "EST")).toBe(
    "Friday 12 March 2027, 22:00 to Saturday 13 March 2027, 02:30 EST",
  );
  expect(() => core.describeWhen("2027-03-12T19:00", "2027-03-12T23:00")).toThrow(/with a timezone/);
  expect(() => core.describeWhen("2027-03-12T19:00:00Z", "2027-03-12T18:00:00Z")).toThrow(/must end after it starts/);
  // a timezone name that contradicts the offset is refused: jurors would read another time than the contract keeps
  const summer = ["2027-06-12T19:00:00+01:00", "2027-06-12T23:00:00+01:00"] as const;
  for (const zone of ["CEST", "EST", "UTC", "GMT+2", "UTC+02:00", "Berlin time (CEST)"])
    expect(() => core.describeWhen(...summer, zone), zone).toThrow(
      new RegExp(
        `Timezone name: "${zone.match(/CEST|EST|UTC\+02:00|GMT\+2|UTC/)![0].replace("+", "\\+")}" is not UTC\\+01:00`,
      ),
    );
  expect(() => core.describeWhen("2027-06-12T19:00:00+09:00", "2027-06-12T23:00:00+09:00", "IST")).toThrow(
    /Timezone name: "IST" is not UTC\+09:00/,
  );
  for (const zone of ["CET", "BST", "UTC+1", "GMT+01:00", "Berlin time", "West Africa Time"])
    expect(core.describeWhen(...summer, zone), zone).toMatch(
      new RegExp(`19:00-23:00 ${zone.replace("+", "\\+").replace("(", "\\(").replace(")", "\\)")}$`),
    );
  expect(core.describeWhen("2027-06-12T19:00:00+02:00", "2027-06-12T23:00:00+02:00", "CEST")).toBe(
    "Saturday 12 June 2027, 19:00-23:00 CEST",
  );
  expect(core.describeWhen("2027-06-12T19:00:00+05:30", "2027-06-12T23:00:00+05:30", "IST")).toBe(
    "Saturday 12 June 2027, 19:00-23:00 IST",
  );
  const ch = (code: number) => String.fromCharCode(code);
  for (const code of [0x202e, 0x2028, 0x200b, 0x85])
    expect(() => core.describeWhen(...summer, `C${ch(code)}ET`)).toThrow(
      /Timezone name: please keep it on one line, without invisible/,
    );
  expect(() => core.describeWhen(...summer, "x".repeat(41))).toThrow(/Timezone name is too long/);
  expect(() => core.describeWhen(...summer, "{{wallet}}")).toThrow(/Timezone name can't contain/);
});

describe("eventClock reads the event's own clock from its case description, or gives none", () => {
  test.each(CLOCK_CASES)("%s", (_what, text, start, expected) => {
    expect(core.eventClock(text, start)).toEqual(expected);
  });

  test("every offset the form offers comes back, named by the offset or by a UTC/GMT name; the names it trusts", () => {
    const OFFSETS = core.TZ_OFFSETS.map(
      (t) => (t[0] === "-" ? -1 : 1) * (Number(t.slice(1, 3)) * 60 + Number(t.slice(4, 6))),
    );
    expect(OFFSETS).toHaveLength(40);
    expect(OFFSETS.map(core.offsetText)).toEqual(core.TZ_OFFSETS);
    expect(OFFSETS).toEqual([...OFFSETS].sort((a, b) => a - b));
    for (const off of OFFSETS) {
      const iso = (h: string) => `2027-03-12T${h}:00${core.offsetText(off)}`;
      const start = Date.parse(iso("19:00")) / 1000;
      const when = (zone: string) =>
        JSON.stringify({
          title: `Did wallet ${W} attend Night (${core.describeWhen(iso("19:00"), iso("23:00"), zone)})?`,
        });
      expect(core.eventClock(when(""), start), String(off)).toEqual({
        offset: off,
        zone: `UTC${core.offsetText(off)}`,
      });
      expect(core.eventClock(when(`GMT${core.offsetText(off)}`), start), String(off)).toEqual({
        offset: off,
        zone: `GMT${core.offsetText(off)}`,
      });
    }
    // a case as the hosted panel renders it from readEvent's template is the contract's own text: the same clock
    const t = core.caseTemplate(
      GENERIC_TEXT,
      core.templateValues(
        core.newEventConfig(
          { ...FORM, eventWhen: core.describeWhen("2027-03-12T19:00:00+01:00", "2027-03-12T23:00:00+01:00", "CET") },
          MAINNET,
          ORGANISER,
        ),
        ORGANISER,
      ),
    );
    expect(core.eventClock(core.renderCase(t, ORGANISER, C), Date.parse(FORM.eventStart) / 1000)).toEqual({
      offset: 60,
      zone: "CET",
    });
    for (const [name, off] of [
      ["IST", 330],
      ["CET", 60],
      ["UTC", 0],
      ["GMT", 0],
      ["UTC+5:30", 330],
      ["UTC+0530", 330],
      ["GMT−03:30", -210],
      [" CEST ", 120],
      ["PST", -480],
      ["CST", -360],
      ["BST", 60],
      ["AST", -240],
    ] as const)
      // prettier-ignore
      expect(core.zoneIs(name, off), `${name} ${off}`).toBe(true);
    // not: another offset, other text, or a name read first as another timezone
    for (const [name, off] of [
      ["IST", 420],
      ["CET", 120],
      ["UTC+02:00", 60],
      ["UTC+05:75", 375],
      ["Berlin time", 60],
      ["cet", 60],
      ["constructor", 0],
      ["toString", 0],
      ["", 0],
      ["UTC+1 CET", 60],
      ["IST", 60],
      ["IST", 120],
      ["PST", 480],
      ["CST", -300],
      ["CST", 480],
      ["BST", 360],
      ["AST", 180],
    ] as const)
      // prettier-ignore
      expect(core.zoneIs(name, off), `${name} ${off}`).toBe(false);
    for (const [name, offs] of Object.entries(core.ZONE_OFFSETS))
      for (const off of offs) {
        expect(() => core.checkZoneName(name, off), name).not.toThrow();
        expect(core.TZ_OFFSETS, `${name} ${off} is an offset the form offers`).toContain(core.offsetText(off));
      }
  });
});
