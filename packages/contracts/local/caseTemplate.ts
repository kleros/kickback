import {
  concat,
  encodeAbiParameters,
  formatEther,
  getAddress,
  hexToBytes,
  sha256,
  size,
  stringToBytes,
  toHex,
  type Hex,
} from "viem";

/** Values the contract writes into each case: the wallet and itself checksummed, and the wallet in lower case. */
export const SLOT = { wallet: 1, contract: 2, walletLower: 3 } as const;
/** One IPFS block: ipfsCidV0 (and the contract's caseMetaEvidence) only hash single-block files. */
export const MAX_METAEVIDENCE_BYTES = 262_144;
/** The contract keeps abi.encode(pieces, slots) as contract code, under EIP-170's 24,576 bytes. */
export const MAX_TEMPLATE_BYTES = 24_575;

export type CaseTemplate = { pieces: string[]; slots: Hex };

/** Fields of the generic template the organiser types; `max` keeps the filled template inside MAX_TEMPLATE_BYTES. */
export const EVENT_FIELDS = [
  { key: "eventTitle", label: "Event title", max: 200 },
  { key: "eventName", label: "Short name", max: 80 },
  { key: "eventWhen", label: "Date and time", max: 120 },
  { key: "eventWhere", label: "Venue or city", max: 200 },
  { key: "hosts", label: "Hosts", max: 200 },
  { key: "eventLink", label: "Registration link", max: 300 },
] as const;

/** Deploy-time placeholders; a non-empty label means an empty value is refused with that label. */
const DEPLOY_PLACEHOLDERS: Record<string, string> = {
  eventName: "",
  eventInfo: "",
  deposit: "",
  policyURI: "",
  owner: "",
  ownerLower: "",
  explorer: "",
  ...Object.fromEntries(EVENT_FIELDS.filter((f) => f.key !== "eventName").map((f) => [f.key, f.label])),
};

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

/** The CIDv0 `ipfs add` gives these bytes with default settings: sha256 of a dag-pb node holding a UnixFS file. */
export function ipfsCidV0(data: string | Uint8Array): string {
  const bytes = typeof data === "string" ? stringToBytes(data) : data;
  if (bytes.length > MAX_METAEVIDENCE_BYTES) throw new Error("More than one IPFS block (256 KiB)");
  const len = varint(bytes.length);
  const file = concat([new Uint8Array([0x08, 0x02, 0x12, ...len]), bytes, new Uint8Array([0x18, ...len])]);
  const node = concat([new Uint8Array([0x0a, ...varint(file.length)]), file]);
  return base58(concat([new Uint8Array([0x12, 0x20]), sha256(node, "bytes")]));
}

/** "/ipfs/<CIDv0>" of a text, as the contract's caseMetaEvidence computes it. */
export const ipfsPathOf = (text: string) => "/ipfs/" + ipfsCidV0(text);

/** A case description from the template pieces: what the contract's caseMetaEvidence(wallet) returns. */
export function renderCase({ pieces, slots }: CaseTemplate, wallet: string, contract: string): string {
  const values = Array.from(hexToBytes(slots));
  let out = pieces[0] ?? "";
  values.forEach((v, i) => {
    const value =
      v === SLOT.wallet
        ? getAddress(wallet)
        : v === SLOT.contract
          ? getAddress(contract)
          : getAddress(wallet).toLowerCase();
    out += value + (pieces[i + 1] ?? "");
  });
  return out;
}

export type TemplateConfig = {
  eventInfo?: string;
  eventName?: string;
  depositUnits: bigint;
  explorer?: string;
  owner?: string;
  kleros?: { policyURI?: string };
} & Partial<Record<(typeof EVENT_FIELDS)[number]["key"], string>>;

/** The deploy-time values of the case description; `owner` is used when the config names no owner. */
export function templateValues(cfg: TemplateConfig, owner?: string): Record<string, string> {
  const isAddr = (a?: string) => !!a && /^0x[0-9a-fA-F]{40}$/.test(a);
  const zero = "0x0000000000000000000000000000000000000000";
  const organiser = isAddr(cfg.owner)
    ? getAddress(cfg.owner!.toLowerCase())
    : isAddr(owner) && owner!.toLowerCase() !== zero
      ? getAddress(owner!.toLowerCase())
      : "";
  const deposit = formatEther(cfg.depositUnits);
  const values: Record<string, string> = {
    eventName: cfg.eventName ?? "Truth Pays",
    eventInfo: cfg.eventInfo ?? "none",
    deposit: `${deposit.includes(".") ? deposit : `${deposit}.0`} ETH`,
    policyURI: cfg.kleros?.policyURI ?? "",
    owner: organiser,
    ownerLower: organiser.toLowerCase(),
    explorer: cfg.explorer ?? "",
  };
  for (const f of EVENT_FIELDS) {
    const v = cfg[f.key];
    if (f.key !== "eventName" && v !== undefined) values[f.key] = v;
  }
  return values;
}

/**
 * Fills the deploy-time placeholders of a template TEXT (each value JSON-escaped) and splits it at
 * {{wallet}}, {{contract}} and {{walletLower}}. Checks that a sample case is ERC-1497 JSON that names
 * the wallet, points to the policy, has lower-case alias keys and fits the contract.
 */
export function caseTemplate(
  text: string,
  values: Record<string, string> = {},
  { name = "The case description template" } = {},
): CaseTemplate & { sample: string } {
  const pieces: string[] = [];
  const slots: number[] = [];
  let piece = "";
  let last = 0;
  for (const m of text.matchAll(/\{\{\w+\}\}/g)) {
    piece += text.slice(last, m.index);
    last = m.index + m[0].length;
    const key = m[0].slice(2, -2);
    if (key in SLOT) {
      pieces.push(piece);
      piece = "";
      slots.push(SLOT[key as keyof typeof SLOT]);
      continue;
    }
    if (!(key in DEPLOY_PLACEHOLDERS)) throw new Error(`Unknown placeholder ${m[0]} in ${name}`);
    const v = values[key] ?? (key === "eventInfo" ? "none" : undefined);
    if ((key === "owner" || key === "ownerLower") && !v)
      throw new Error(`Set "owner" in the config: the case description (${name}) names the organiser's wallet`);
    if (DEPLOY_PLACEHOLDERS[key] && !String(v ?? "").trim())
      throw new Error(
        `${name} names the event's "${DEPLOY_PLACEHOLDERS[key]}" (${m[0]}), but it is empty: please fill it in.`,
      );
    if (key === "eventInfo" && v !== "none" && !/^\/ipfs\/Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(v ?? ""))
      throw new Error("Invalid event info path.");
    piece += JSON.stringify(String(v ?? "")).slice(1, -1);
  }
  pieces.push(piece + text.slice(last));
  if (!slots.includes(SLOT.wallet)) throw new Error(`${name} must name the challenged wallet ({{wallet}})`);
  const t: CaseTemplate = { pieces, slots: toHex(new Uint8Array(slots)) };
  // EIP-55 test vectors: mixed case once checksummed, so a lower-case alias key can be told apart
  const sampleWallet = "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed";
  const sampleContract = "0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359";
  const sample = renderCase(t, sampleWallet, sampleContract);
  if (size(encodeAbiParameters([{ type: "string[]" }, { type: "bytes" }], [t.pieces, t.slots])) > MAX_TEMPLATE_BYTES)
    throw new Error(`${name} is too long: the contract can keep about 24 KB of template`);
  let meta: {
    title?: unknown;
    question?: unknown;
    description?: unknown;
    rulingOptions?: { titles?: unknown };
    fileURI?: unknown;
    aliases?: Record<string, unknown>;
  };
  try {
    meta = JSON.parse(sample);
  } catch (e) {
    throw new Error(`${name} is not valid JSON once filled in: ${(e as Error).message}`);
  }
  const wallet = getAddress(sampleWallet);
  for (const key of ["title", "question"] as const) {
    const v = meta[key];
    if (typeof v !== "string" || !v.includes(wallet))
      throw new Error(`${name}: "${key}" must name the wallet ({{wallet}})`);
  }
  if (typeof meta.description !== "string" || !meta.description) throw new Error(`${name}: "description" is missing`);
  const titles = meta.rulingOptions?.titles;
  if (!Array.isArray(titles) || titles.length !== 2)
    throw new Error(`${name}: "rulingOptions.titles" must list the 2 answers (1 attended, 2 did not attend)`);
  if ((meta.fileURI ?? "") !== (values.policyURI ?? ""))
    throw new Error(`${name}: "fileURI" must be the juror policy ("{{policyURI}}")`);
  // Kleros Court labels each piece of evidence with aliases[sender], the sender in lower case
  const aliasKeys = Object.keys(meta.aliases ?? {});
  for (const key of aliasKeys)
    if (/^0x[0-9a-fA-F]{40}$/.test(key) && !aliasKeys.includes(key.toLowerCase()))
      throw new Error(
        `${name}: alias ${key} also needs a lower-case key ({{walletLower}} / {{ownerLower}}): Kleros Court looks senders up in lower case`,
      );
  return { ...t, sample };
}
