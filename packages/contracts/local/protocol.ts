import {
  concat,
  encodeAbiParameters,
  formatUnits,
  getAddress,
  hexToBytes,
  sha256,
  stringToBytes,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

/** Networks with Kleros Court v1 and its general-purpose Dispute Resolver. Add yours in a fork. */
export const NETWORKS = {
  1: {
    key: "ethereum",
    name: "Ethereum mainnet",
    explorer: "https://etherscan.io",
    currency: "ETH",
    kleros: {
      disputeResolver: "0x4b89e798b10478a839ea0abcf86c4b94a3c782a4",
      arbitrator: "0x988b3A538b618C7A603e1c11Ab82Cd16dbE28069",
      /** General Court */
      subcourt: 0n,
      jurors: 3n,
      court: "https://court.kleros.io/cases/",
      resolverApp: "https://resolve.kleros.io/cases/",
    },
  },
} as const;

export const KLEROS_IPFS_UPLOAD = "https://kleros-api.netlify.app/.netlify/functions/upload-to-ipfs";
export const KLEROS_IPFS_GATEWAY = "https://cdn.kleros.link";
export const DEFAULT_PERIODS = { challenge: 86_400n, match: 86_400n } as const;

/** Values the case description template names, as the contract's PresenceCaseWriter.SLOT_* numbers. */
export const SLOT = {
  wallet: 1,
  walletLower: 2,
  contract: 3,
  organiser: 4,
  organiserLower: 5,
  eventName: 6,
  eventURL: 7,
  eventStart: 8,
  eventEnd: 9,
  deposit: 10,
  chainId: 11,
} as const;
/** Placeholders filled once, when the protocol is deployed. */
export const DEPLOY_PLACEHOLDERS = ["policyURI", "network", "explorer"] as const;

export const PHASES = ["Open", "Listed", "Finalized", "Cancelled"] as const;
export const STATUS = ["None", "Staker", "Rejected", "Refunded"] as const;
export const CHALLENGE_STATES = ["None", "Waiting", "Disputed", "Resolved"] as const;
/** Must match PresenceEvent.MIN_SETTLEMENT_WINDOW. */
export const MIN_SETTLEMENT_WINDOW = 7 * 86_400;
/** Must match PresenceEvent.MAX_SETTLEMENT_WINDOW. */
export const MAX_SETTLEMENT_WINDOW = 90 * 86_400;
/** Must match PresenceEvent.MAX_LEAD_TIME. */
export const MAX_LEAD_TIME = 2 * 365 * 86_400;
export const MAX_NAME = 200;
export const MAX_URL = 300;
/** One IPFS block: ipfsCidV0 (and the contract's caseMetaEvidence) only hash single-block files. */
export const MAX_METAEVIDENCE_BYTES = 262_144;

export type CaseTemplate = { pieces: string[]; slots: Hex };
export type DeployValues = Partial<Record<(typeof DEPLOY_PLACEHOLDERS)[number], string>>;

/** KlerosLiquid extra data: abi.encode(court, minJurors); court 0 is the General Court. */
export const klerosExtraData = (court = 0n, jurors = 3n): Hex =>
  encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [court, jurors]);

/** The facts the contract writes into one case. */
export type CaseFacts = {
  staker: string;
  eventContract: string;
  organiser: string;
  name: string;
  url: string;
  start: number | bigint;
  end: number | bigint;
  depositAmount: bigint;
  decimals: number;
  symbol: string;
  token?: string;
  chainId: number | bigint;
};

export function sampleFacts(): CaseFacts {
  return {
    staker: "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed",
    eventContract: "0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359",
    organiser: "0xdbf03b407c01e7cd3cbea99509d93f8dddc8c6fb",
    name: "Sample event",
    url: "https://example.org/event",
    start: 1793800000,
    end: 1793814400,
    depositAmount: 10n ** 16n,
    decimals: 18,
    symbol: "ETH",
    token: zeroAddress,
    chainId: 1,
  };
}

/** Splits a template text into the contract's pieces and slots, filling the deploy-time placeholders (JSON-escaped). */
export function caseTemplate(text: string, values: DeployValues = {}): CaseTemplate {
  const pieces: string[] = [];
  const slots: number[] = [];
  let piece = "";
  let last = 0;
  for (const m of text.matchAll(/\{\{(\w+)\}\}/g)) {
    piece += text.slice(last, m.index);
    last = m.index! + m[0].length;
    const key = m[1]!;
    if (key in SLOT) {
      pieces.push(piece);
      piece = "";
      slots.push(SLOT[key as keyof typeof SLOT]);
    } else if ((DEPLOY_PLACEHOLDERS as readonly string[]).includes(key)) {
      const v = values[key as keyof DeployValues] ?? "";
      if (!v.trim()) throw new Error(`The template needs a value for {{${key}}}`);
      piece += JSON.stringify(v).slice(1, -1);
    } else throw new Error(`Unknown placeholder {{${key}}} in the template`);
  }
  pieces.push(piece + text.slice(last));
  if (!slots.includes(SLOT.wallet)) throw new Error("The template must name the challenged wallet ({{wallet}})");
  const t: CaseTemplate = { pieces, slots: toHex(new Uint8Array(slots)) };
  // the filled template must be valid ERC-1497 JSON whatever the event's (JSON-safe) values are
  const meta = JSON.parse(renderCase(t, sampleFacts()));
  for (const k of ["title", "description", "question", "fileURI"])
    if (typeof meta[k] !== "string" || !meta[k]) throw new Error(`The template has no "${k}"`);
  if (meta.fileURI !== values.policyURI) throw new Error('The template\'s "fileURI" must be {{policyURI}}');
  if (meta.rulingOptions?.titles?.length !== 2)
    throw new Error("The template must list the 2 answers (1 attended, 2 did not attend)");
  return t;
}

/** UTC text the contract writes: "2026-11-04 12:30 UTC". */
export function utcText(ts: number | bigint): string {
  const d = new Date(Number(ts) * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/** The amount as the contract writes it: "0.01", "25". */
export const decimalText = (amount: bigint, decimals: number) => formatUnits(amount, decimals);

/** The case description the contract's caseMetaEvidence returns, computed here (for tests and previews). */
export function renderCase({ pieces, slots }: CaseTemplate, f: CaseFacts): string {
  const lower = (a: string) => getAddress(a).toLowerCase();
  const isEth = !f.token || f.token === zeroAddress;
  const value = (s: number) => {
    switch (s) {
      case SLOT.wallet:
        return getAddress(f.staker);
      case SLOT.walletLower:
        return lower(f.staker);
      case SLOT.contract:
        return getAddress(f.eventContract);
      case SLOT.organiser:
        return getAddress(f.organiser);
      case SLOT.organiserLower:
        return lower(f.organiser);
      case SLOT.eventName:
        return f.name;
      case SLOT.eventURL:
        return f.url || "(none given)";
      case SLOT.eventStart:
        return utcText(f.start);
      case SLOT.eventEnd:
        return utcText(f.end);
      case SLOT.deposit:
        return (
          `${decimalText(f.depositAmount, f.decimals)} ${f.symbol}` + (isEth ? "" : ` (token ${getAddress(f.token!)})`)
        );
      case SLOT.chainId:
        return String(f.chainId);
      default:
        throw new Error(`Unknown slot ${s}`);
    }
  };
  let out = pieces[0]!;
  hexToBytes(slots).forEach((s, i) => (out += value(s) + pieces[i + 1]));
  return out;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(bytes: Uint8Array): string {
  let n = BigInt(toHex(bytes));
  let out = "";
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

function varint(n: number): number[] {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
}

/** The CIDv0 ("Qm...") `ipfs add` gives these bytes with default settings (one block, up to 256 KiB). */
export function ipfsCidV0(data: string | Uint8Array): string {
  const bytes = typeof data === "string" ? stringToBytes(data) : data;
  if (bytes.length > MAX_METAEVIDENCE_BYTES) throw new Error("More than one IPFS block (256 KiB)");
  const len = varint(bytes.length);
  const file = concat([new Uint8Array([0x08, 0x02, 0x12, ...len]), bytes, new Uint8Array([0x18, ...len])]);
  const node = concat([new Uint8Array([0x0a, ...varint(file.length)]), file]);
  return base58(concat([new Uint8Array([0x12, 0x20]), sha256(node, "bytes")]));
}
export const ipfsPathOf = (text: string | Uint8Array) => "/ipfs/" + ipfsCidV0(text);

/** The contract's rule for the event name and page: no quote, backslash or control character. */
// eslint-disable-next-line no-control-regex
export const jsonSafe = (s: string) => !/["\\\u0000-\u001f\u007f]/.test(s);

export type EventForm = {
  name: string;
  url?: string;
  token?: Address;
  depositAmount: bigint;
  eventStart: number | bigint;
  eventEnd: number | bigint;
  claimDeadline: number | bigint;
  capacity?: number;
};
/** PresenceFactory.createEvent's Config tuple. */
export type EventConfig = {
  name: string;
  url: string;
  token: Address;
  depositAmount: bigint;
  eventStart: bigint;
  eventEnd: bigint;
  claimDeadline: bigint;
  capacity: number;
};

/** Checks an organiser's form before sending createEvent; returns the Config tuple, or throws a plain message. */
export function eventConfig(form: EventForm, now = Math.floor(Date.now() / 1000)): EventConfig {
  const n = String(form.name ?? "").trim();
  const u = String(form.url ?? "").trim();
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  if (!n) throw new Error("Give the event a name.");
  if (bytes(n) > MAX_NAME) throw new Error(`The name is too long (${MAX_NAME} characters at most; some symbols count as more than one).`);
  if (!jsonSafe(n)) throw new Error('The name cannot contain quotes ("), backslashes or line breaks.');
  if (bytes(u) > MAX_URL) throw new Error("The event link is too long.");
  if (u && !/^https:\/\/\S+$/.test(u)) throw new Error("The event link must start with https://.");
  if (!jsonSafe(u)) throw new Error("The event link cannot contain quotes or backslashes.");
  const amount = BigInt(form.depositAmount);
  if (amount <= 0n) throw new Error("The deposit must be more than 0.");
  const [s, e, d] = [form.eventStart, form.eventEnd, form.claimDeadline].map(Number) as [number, number, number];
  if (!Number.isFinite(s) || !(s > 0)) throw new Error("Enter a start date and time.");
  if (!Number.isFinite(e) || !(e > 0)) throw new Error("Enter an end date and time.");
  if (![s, e, d].every(Number.isInteger)) throw new Error("The dates must be whole seconds.");
  if (!(e > s)) throw new Error("The event must end after it starts.");
  if (!(e > now)) throw new Error("The event's end time has already passed.");
  if (!(d >= e + MIN_SETTLEMENT_WINDOW))
    throw new Error("The deadline to confirm who came must be at least 7 days after the event ends.");
  if (!(d <= e + MAX_SETTLEMENT_WINDOW))
    throw new Error("The deadline to confirm who came must be at most 90 days after the event ends.");
  if (!(e <= now + MAX_LEAD_TIME)) throw new Error("The event must end within 2 years.");
  const cap = Number(form.capacity) || 0;
  if (!Number.isInteger(cap) || cap < 0)
    throw new Error("Capacity must be a whole number. Leave it empty for no limit.");
  if (cap > 2 ** 32 - 1) throw new Error("Capacity can be at most 4,294,967,295. Leave it empty for no limit.");
  return {
    name: n,
    url: u,
    token: form.token || zeroAddress,
    depositAmount: amount,
    eventStart: BigInt(s),
    eventEnd: BigInt(e),
    claimDeadline: BigInt(d),
    capacity: cap,
  };
}
