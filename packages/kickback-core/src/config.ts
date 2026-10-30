import { encodeAbiParameters, getAddress, size, toHex, zeroAddress, type Address, type Hex } from "viem";

import { renderCase, type MetaEvidenceTemplate } from "./caseText";
import { DISGUISE_RE, offsetOf } from "./clock";
import {
  CHAINS,
  DECIMALS,
  DEFAULT_LOG_CHUNK,
  DEFAULT_RPC,
  isIpfsPath,
  KLEROS,
  KLEROS_IPFS_GATEWAY,
  KLEROS_IPFS_UPLOAD,
  MAX_DEPOSIT_ETH,
  MAX_TEMPLATE_BYTES,
  MIN_SETTLEMENT_WINDOW,
  SLOT,
  STALE_PINS,
  SYMBOL,
  DEFAULT_METAEVIDENCE_TEMPLATE,
} from "./constants";
import { KickbackError } from "./kickbackError";
import { checkedAddress, fmt, isAddressStrict, parseEthStrict, type Columns } from "./text";

export interface KlerosInput {
  disputeResolver?: string;
  arbitrator?: string;
  court?: number | string;
  jurors?: number | string;
  policyURI?: string;
  metaEvidenceTemplate?: string;
  metaEvidenceURI?: string;
  courtUrl?: string;
  ipfsUpload?: string;
  ipfsGateway?: string;
}

/** The event fields of the generic case description template. */
export type EventFieldKey = "eventTitle" | "eventName" | "eventWhen" | "eventWhere" | "hosts" | "eventLink";

/** A config as written by hand (config.json) or built by a page, before normalizeConfig. */
export interface RawConfig extends Partial<Record<EventFieldKey, string>> {
  chain?: string;
  chainId?: number | string;
  chainName?: string;
  rpcUrl?: string;
  explorer?: string;
  logChunk?: number | string;
  deposit?: string;
  poolCap?: string;
  receiver?: string;
  contract?: string;
  depositOpensAt?: string;
  depositDeadline?: string;
  eventStart?: string;
  claimDeadline?: string;
  deployBlock?: number | string;
  owner?: string;
  mode?: string;
  depositTicketPattern?: string;
  columns?: Columns;
  kleros?: KlerosInput;
  token?: unknown;
  tokenDecimals?: unknown;
}

/** A normalized config: what every check needs, amounts in wei and times in unix seconds. */
export interface Config extends Omit<RawConfig, "chainId" | "logChunk" | "deployBlock"> {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorer: string;
  symbol: typeof SYMBOL;
  decimals: typeof DECIMALS;
  depositUnits: bigint;
  poolCapUnits?: bigint;
  receiver: Address;
  opensAt: number;
  deadline: number;
  eventStartTs?: number;
  claimDeadlineTs?: number;
  deployBlock?: number;
  logChunk: number;
  columns: Columns;
}

// Dates must carry a timezone, otherwise they would be read in the computer's local time.
function parseDate(
  cfg: RawConfig,
  key: "depositOpensAt" | "depositDeadline" | "eventStart" | "claimDeadline",
): number | undefined {
  const v = cfg[key];
  if (v === undefined || v === null || v === "") return undefined;
  const t = Date.parse(v);
  if (Number.isNaN(t) || !/(Z|[+-]\d\d:\d\d)$/.test(String(v)))
    throw new Error(
      `"${key}" in the config must be an ISO date with timezone, e.g. 2026-11-04T18:00:00+05:30 (got "${v}")`,
    );
  return Math.floor(t / 1000);
}

function parseEth(cfg: RawConfig, key: "deposit" | "poolCap", file: string): bigint {
  const v = String(cfg[key] ?? "").trim();
  try {
    return parseEthStrict(v);
  } catch {
    throw new Error(`"${key}" in ${file} must be an amount of ETH such as "0.01" (got "${cfg[key] ?? ""}")`);
  }
}

/**
 * A config with what every check needs added: chainId, explorer, symbol/decimals (ETH / 18), the
 * deposit and pool cap in wei, the deposit address (receiver), the deposit window and contract times in
 * unix seconds, deployBlock and logChunk. `file` names the config in messages. `depositCap: false`
 * accepts a deposit above MAX_DEPOSIT_ETH (an existing contract's own amount: contractConfig).
 */
export function normalizeConfig(cfg: RawConfig, file = "config.json", { depositCap = true } = {}): Config {
  if (cfg.token || cfg.tokenDecimals)
    throw new Error(
      `${file} still has "token"/"tokenDecimals": deposits are in ETH now. Remove them and set "deposit" in ETH (e.g. "0.01").`,
    );
  const chain = cfg.chain && Object.hasOwn(CHAINS, cfg.chain) ? CHAINS[cfg.chain as keyof typeof CHAINS] : undefined;
  if (!chain && !cfg.chainId)
    throw new Error(
      `Unknown chain "${cfg.chain}" in ${file}: use "ethereum" (Ethereum mainnet), or set "chainId" for a local test chain`,
    );
  const chainId = Number(cfg.chainId ?? chain?.chainId);
  if (chain && chainId !== chain.chainId)
    throw new Error(`"chainId" ${chainId} in ${file} does not match chain "${cfg.chain}" (${chain.chainId})`);

  const depositUnits = parseEth(cfg, "deposit", file);
  if (depositUnits <= 0n) throw new Error(`"deposit" in ${file} must be more than 0 ETH`);
  if (depositCap && depositUnits > parseEthStrict(MAX_DEPOSIT_ETH))
    throw new Error(
      `"deposit" in ${file} is ${cfg.deposit} ETH: more than ${MAX_DEPOSIT_ETH} ETH looks like a mistake (an old USDC amount?)`,
    );
  const poolCapUnits = cfg.poolCap ? parseEth(cfg, "poolCap", file) : undefined;

  const opensAt = parseDate(cfg, "depositOpensAt");
  const deadline = parseDate(cfg, "depositDeadline");
  const eventStartTs = parseDate(cfg, "eventStart");
  const claimDeadlineTs = parseDate(cfg, "claimDeadline");
  if (cfg.contract && cfg.receiver && cfg.contract.toLowerCase() !== cfg.receiver.toLowerCase())
    throw new Error('"receiver" and "contract" in the config must be the same address (the deployed contract)');
  const logChunk = Number(cfg.logChunk);
  const receiver = cfg.contract || cfg.receiver;
  if (!receiver || !isAddressStrict(receiver))
    throw new Error(`"contract" in ${file} must be the deposit contract's address`);
  const { chainId: _c, logChunk: _l, deployBlock: _d, ...rest } = cfg;
  return {
    ...rest,
    chainId,
    chainName: cfg.chainName ?? chain?.name ?? String(cfg.chain ?? "custom network"),
    rpcUrl: cfg.rpcUrl || (chain ? DEFAULT_RPC : ""),
    explorer: cfg.explorer ?? chain?.explorer ?? "",
    symbol: SYMBOL,
    decimals: DECIMALS,
    depositUnits,
    poolCapUnits,
    receiver: checkedAddress(receiver),
    opensAt: opensAt ?? 0,
    deadline: deadline ?? Infinity,
    eventStartTs,
    claimDeadlineTs,
    deployBlock: cfg.deployBlock ? Number(cfg.deployBlock) : undefined,
    logChunk: Number.isInteger(logChunk) && logChunk > 0 ? logChunk : DEFAULT_LOG_CHUNK,
    columns: cfg.columns ?? {},
  };
}

export interface KlerosConfig {
  disputeResolver: Address;
  /** "" when unknown: the contract's arbitrator() has it. */
  arbitrator: Address | "";
  court: number;
  jurors: number;
  /** abi.encode(court, jurors) */
  extraData: Hex;
  policyURI: string;
  metaEvidenceTemplate: string;
  courtUrl: string;
  ipfsUpload: string;
  ipfsGateway: string;
}

/** Kleros settings from config.kleros, with mainnet defaults: General Court (0), 3 jurors. */
export function klerosConfig(cfg: Pick<RawConfig, "kleros"> & { chainId?: number | string }): KlerosConfig {
  const k = cfg.kleros ?? {};
  if (k.metaEvidenceURI)
    throw new Error(
      '"kleros.metaEvidenceURI" is gone (v7): each case gets its own description from "kleros.metaEvidenceTemplate". Remove it.',
    );
  const known = KLEROS[Number(cfg.chainId)];
  const disputeResolver = k.disputeResolver || known?.disputeResolver;
  if (!disputeResolver) throw new Error('Set "kleros.disputeResolver" in the config for this network');
  const arbitrator = k.arbitrator || known?.arbitrator || "";
  const court = Number(k.court ?? 0);
  const jurors = Number(k.jurors ?? 3);
  if (!Number.isInteger(court) || court < 0)
    throw new Error(`"kleros.court" must be a court number such as 0 (got ${k.court})`);
  if (!Number.isInteger(jurors) || jurors < 1)
    throw new Error(`"kleros.jurors" must be a whole number of jurors such as 3 (got ${k.jurors})`);
  return {
    disputeResolver: getAddress(String(disputeResolver).toLowerCase()),
    arbitrator: arbitrator ? getAddress(String(arbitrator).toLowerCase()) : "",
    court,
    jurors,
    extraData: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [BigInt(court), BigInt(jurors)]),
    policyURI: k.policyURI ?? "",
    metaEvidenceTemplate: k.metaEvidenceTemplate || DEFAULT_METAEVIDENCE_TEMPLATE,
    courtUrl: k.courtUrl || known?.court || "https://court.kleros.io",
    ipfsUpload: k.ipfsUpload || KLEROS_IPFS_UPLOAD,
    ipfsGateway: k.ipfsGateway || KLEROS_IPFS_GATEWAY,
  };
}

export interface EventField {
  key: EventFieldKey;
  label: string;
  max: number;
  example: string;
  link?: boolean;
}
/** The event details a new event's case description names, as the new-event form asks for them. */
export const EVENT_FIELDS: readonly EventField[] = [
  { key: "eventTitle", label: "Event title", max: 200, example: "Onchain Justice Night: Talks and Dinner" },
  { key: "eventName", label: "Short name", max: 80, example: "Onchain Justice Night, Berlin 2027" },
  { key: "eventWhen", label: "Date and time", max: 120, example: "Friday 12 March 2027, 19:00-23:00 CET" },
  // fixed at deployment: a city is enough
  { key: "eventWhere", label: "Venue or city", max: 200, example: "Café Example, Main Street 1, Berlin" },
  { key: "hosts", label: "Hosts", max: 200, example: "Kleros and friends" },
  { key: "eventLink", label: "Registration link", max: 300, example: "https://luma.com/your-event", link: true },
];
type DeployKey =
  "eventName" | "deposit" | "policyURI" | "owner" | "ownerLower" | "explorer" | Exclude<EventFieldKey, "eventName">;
/** The deploy-time placeholders and the label to name when one is empty ("" = not checked). */
const DEPLOY_PLACEHOLDERS: Record<DeployKey, string> = {
  eventName: "",
  deposit: "",
  policyURI: "",
  owner: "",
  ownerLower: "",
  explorer: "",
  ...(Object.fromEntries(EVENT_FIELDS.filter((f) => f.key !== "eventName").map((f) => [f.key, f.label])) as Record<
    Exclude<EventFieldKey, "eventName">,
    string
  >),
};
export type TemplateValues = Partial<Record<DeployKey, string>>;

export type EventDetails = Record<EventFieldKey, string>;
/**
 * The form's event details, trimmed and in NFC. Throws a KickbackError (code INVALID_INPUT) for the
 * first wrong field, with `fields` mapping every wrong field to its message.
 */
export function eventDetails(input: Partial<Record<EventFieldKey, unknown>> = {}): EventDetails {
  const out: Partial<EventDetails> = {};
  const fields: Record<string, string> = {};
  for (const f of EVENT_FIELDS) {
    const v = String(input[f.key] ?? "")
      .normalize("NFC")
      .trim();
    let why = "";
    if (!v) why = `${f.label}: please fill this in.`;
    else if (v.length > f.max) why = `${f.label} is too long (${v.length} characters, at most ${f.max}).`;
    else if (DISGUISE_RE.test(v))
      why = `${f.label}: please keep it on one line, without invisible or text-direction characters.`;
    else if (/\{\{|\}\}/.test(v)) why = `${f.label} can't contain "{{" or "}}".`;
    else if (f.link && !/^https:\/\/[^\s/]+\.[^\s]+$/i.test(v))
      why = `${f.label} must be a web address starting with https://`;
    if (why) fields[f.key] = why;
    else out[f.key] = v;
  }
  const wrong = Object.values(fields);
  if (wrong.length) throw new KickbackError(wrong[0]!, "INVALID_INPUT", { fields });
  return out as EventDetails;
}

/**
 * The deploy-time values of the case description: eventName, deposit ("0.01 ETH"), policyURI, owner
 * (config "owner", or the deploying wallet), ownerLower, explorer, plus the generic template's event fields when set.
 */
export function templateValues(cfg: Pick<Config, "depositUnits"> & RawConfig, owner?: string): TemplateValues {
  const organiser =
    cfg.owner && isAddressStrict(cfg.owner)
      ? checkedAddress(cfg.owner)
      : owner && owner !== zeroAddress
        ? checkedAddress(owner)
        : "";
  const values: TemplateValues = {
    eventName: cfg.eventName ?? "Truth Pays",
    deposit: `${fmt(cfg.depositUnits)} ${SYMBOL}`,
    policyURI: cfg.kleros?.policyURI ?? "",
    owner: organiser,
    ownerLower: organiser.toLowerCase(),
    explorer: cfg.explorer ?? "",
  };
  for (const f of EVENT_FIELDS) if (f.key !== "eventName" && cfg[f.key] !== undefined) values[f.key] = cfg[f.key];
  return values;
}

// EIP-55 test vectors: mixed case once checksummed, so a lower-case alias key can be told apart
const SAMPLE_WALLET = "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed";
const SAMPLE_CONTRACT = "0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359";

export interface CaseTemplate extends MetaEvidenceTemplate {
  /** The case for sample addresses. */
  sample: string;
}

/**
 * The case description template for the deploy, from the template's text: fills the deploy-time
 * placeholders with `values` (JSON-escaped, never read again for placeholders) and splits it at
 * {{wallet}}, {{contract}} and {{walletLower}}. Checks that a sample case is ERC-1497 JSON that names
 * the wallet, points to the juror policy, labels addresses in lower case too and fits the contract.
 */
export function caseTemplate(
  text: string,
  values: TemplateValues = {},
  { name = "The case description template" } = {},
): CaseTemplate {
  const pieces: string[] = [];
  const slots: number[] = [];
  let piece = "";
  let last = 0;
  const raw = String(text);
  for (const m of raw.matchAll(/\{\{\w+\}\}/g)) {
    piece += raw.slice(last, m.index);
    last = m.index + m[0].length;
    const key = m[0].slice(2, -2);
    if (Object.hasOwn(SLOT, key)) {
      pieces.push(piece);
      piece = "";
      slots.push(SLOT[key as keyof typeof SLOT]);
      continue;
    }
    if (!Object.hasOwn(DEPLOY_PLACEHOLDERS, key)) throw new Error(`Unknown placeholder ${m[0]} in ${name}`);
    const k = key as DeployKey;
    const v = values[k];
    if ((k === "owner" || k === "ownerLower") && !v)
      throw new Error(`Set "owner" in the config: the case description (${name}) names the organiser's wallet`);
    if (DEPLOY_PLACEHOLDERS[k] && !String(v ?? "").trim())
      throw new Error(
        `${name} names the event's "${DEPLOY_PLACEHOLDERS[k]}" (${m[0]}), but it is empty: please fill it in.`,
      );
    // values go inside JSON strings, so they are escaped as JSON
    piece += JSON.stringify(String(v ?? "")).slice(1, -1);
  }
  pieces.push(piece + raw.slice(last));
  if (!slots.includes(SLOT.wallet)) throw new Error(`${name} must name the challenged wallet ({{wallet}})`);
  const t: MetaEvidenceTemplate = { pieces, slots: toHex(new Uint8Array(slots)) };
  const sample = renderCase(t, SAMPLE_WALLET, SAMPLE_CONTRACT);
  if (size(encodeAbiParameters([{ type: "string[]" }, { type: "bytes" }], [pieces, t.slots])) > MAX_TEMPLATE_BYTES)
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
  const wallet = getAddress(SAMPLE_WALLET);
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

/**
 * The deploy settings of a config, checked: claimDeadline at least 7 days after eventStart, the
 * deposit, the Kleros settings, a current juror policy (a pinned IPFS path in live mode) and the
 * deploying wallet being the config's owner. Returns klerosConfig(cfg).
 */
export function deploySettings(cfg: Config, owner?: string): KlerosConfig {
  const { eventStartTs: start, claimDeadlineTs: end } = cfg;
  if (!start || !end) throw new Error('Set "eventStart" and "claimDeadline" in the config (ISO dates with timezone)');
  if (end < start + MIN_SETTLEMENT_WINDOW) throw new Error("claimDeadline must be at least 7 days after eventStart");
  if (!(typeof cfg.depositUnits === "bigint" && cfg.depositUnits > 0n))
    throw new Error("No deposit amount: load the config with loadConfig()");
  const k = klerosConfig(cfg);
  if (STALE_PINS.some((p) => String(k.policyURI).includes(p)))
    throw new Error(
      `"kleros.policyURI" (${k.policyURI}) is an earlier version of the juror policy. Pin docs/attendance-policy.md and set its new path.`,
    );
  if (cfg.mode === "live" && !isIpfsPath(k.policyURI))
    throw new Error(
      'Set "kleros.policyURI" to the IPFS path of the pinned juror policy (e.g. /ipfs/Qm…) before the live deploy',
    );
  if (
    cfg.owner &&
    owner &&
    owner !== zeroAddress &&
    isAddressStrict(cfg.owner) &&
    checkedAddress(cfg.owner) !== checkedAddress(owner)
  )
    throw new Error(`The deploying wallet ${owner} is not the owner in the config (${cfg.owner})`);
  return k;
}

export type KickbackDeployArgs = [
  depositAmount: bigint,
  eventName: string,
  owner: Address,
  eventStart: number,
  claimDeadline: number,
  arbitration: [resolver: Address, extraData: Hex, pieces: readonly string[], slots: Hex, policyURI: string],
];

/** Constructor arguments with numeric Unix timestamps and a positional arbitration tuple. */
export function deployArgs(
  cfg: Config,
  owner: string,
  templateText: unknown,
  { name }: { name?: string } = {},
): KickbackDeployArgs {
  const k = deploySettings(cfg, owner);
  if (typeof templateText !== "string") throw new Error("No case description template: pass the template's text");
  const t = caseTemplate(templateText, templateValues(cfg, owner), name === undefined ? {} : { name });
  return [
    cfg.depositUnits,
    cfg.eventName ?? "Truth Pays",
    checkedAddress(owner),
    cfg.eventStartTs!,
    cfg.claimDeadlineTs!,
    [k.disputeResolver, k.extraData, t.pieces, t.slots, k.policyURI],
  ];
}

/** The network part of a page's config. */
export interface NetworkInput {
  chainId: number | string;
  chain?: string;
  chainName?: string;
  rpcUrl?: string;
  explorer?: string;
  logChunk?: number;
  columns?: Columns;
  kleros?: KlerosInput;
}
const networkConfig = (network: NetworkInput): RawConfig => ({
  chain: network.chain ?? (Number(network.chainId) === 1 ? "ethereum" : "local"),
  chainId: Number(network.chainId),
  ...(network.chainName ? { chainName: network.chainName } : {}),
  rpcUrl: network.rpcUrl ?? "",
  ...(network.explorer !== undefined ? { explorer: network.explorer } : {}),
  ...(network.logChunk !== undefined ? { logChunk: network.logChunk } : {}),
  mode: "live",
  columns: network.columns ?? {},
});

export type EventForm = Partial<Record<EventFieldKey, string>> & {
  deposit?: string;
  eventStart?: string;
  claimDeadline?: string;
};

/**
 * The config of a new event from the new-event form, in normalizeConfig's shape, for deployArgs with
 * the generic template. claimDeadline defaults to 14 days after eventStart. Its receiver is the zero
 * address until deployed. Throws plain messages (eventDetails' `fields` for the text fields).
 */
export function newEventConfig(form: EventForm, network: NetworkInput, owner: string | undefined): Config {
  const details = eventDetails(form);
  if (!isAddressStrict(owner)) throw new Error("Connect your wallet first: it becomes the owner of the new contract.");
  const deposit = String(form.deposit ?? "").trim();
  let wei: bigint;
  try {
    wei = parseEthStrict(deposit);
  } catch {
    throw new Error(`Deposit: type an amount of ETH such as 0.01 (got "${deposit}").`);
  }
  if (wei <= 0n) throw new Error("Deposit: it must be more than 0 ETH.");
  if (wei > parseEthStrict(MAX_DEPOSIT_ETH))
    throw new Error(`Deposit: more than ${MAX_DEPOSIT_ETH} ETH per guest looks like a mistake.`);
  const start = Date.parse(form.eventStart ?? "");
  if (Number.isNaN(start) || offsetOf(form.eventStart) === null)
    throw new Error("Event start: pick a date, a time and a timezone.");
  const claimDeadline = form.claimDeadline || new Date(start + 14 * 86400_000).toISOString();
  const end = Date.parse(claimDeadline);
  if (Number.isNaN(end) || offsetOf(claimDeadline) === null)
    throw new Error("Settlement deadline: pick a date, a time and a timezone.");
  if (Math.floor(end / 1000) < Math.floor(start / 1000) + MIN_SETTLEMENT_WINDOW)
    throw new Error("Settlement deadline: it must be at least 7 days after the event starts (14 days is usual).");
  return normalizeConfig(
    {
      ...networkConfig(network),
      ...details,
      receiver: zeroAddress, // not deployed yet
      deposit,
      eventStart: form.eventStart,
      claimDeadline,
      owner: checkedAddress(owner),
      kleros: { ...(network.kleros ?? {}) },
    },
    "the form",
  );
}

/** True when `address` is Kleros's own Dispute Resolver on this network (KLEROS). */
export const isKnownResolver = (chainId: number | string, address: unknown): boolean => {
  const known = KLEROS[Number(chainId)];
  return !!known && String(address ?? "").toLowerCase() === known.disputeResolver.toLowerCase();
};

/** What readEvent reads from a deposit contract. */
export interface EventInfo {
  contract: Address;
  eventName: string;
  depositAmount: bigint;
  eventStart: number;
  claimDeadline: number;
  owner: Address;
  disputeResolver: Address;
  arbitrator: Address;
  policyURI: string;
  metaEvidenceTemplate: MetaEvidenceTemplate;
  /** PHASES index */
  phase: number;
}

/**
 * The config of an existing deposit contract, from readEvent, in normalizeConfig's shape: deposit,
 * times, owner and Kleros settings are the contract's own; deposits after the event started count as
 * late; `deployBlock` is where log scans start.
 */
export function contractConfig(ev: EventInfo, network: NetworkInput, deployBlock?: number | string | null): Config {
  const iso = (t: number) => new Date(Number(t) * 1000).toISOString();
  return normalizeConfig(
    {
      ...networkConfig(network),
      eventName: ev.eventName,
      deposit: fmt(ev.depositAmount),
      receiver: ev.contract,
      contract: ev.contract,
      eventStart: iso(ev.eventStart),
      claimDeadline: iso(ev.claimDeadline),
      depositDeadline: iso(ev.eventStart),
      owner: ev.owner,
      ...(deployBlock !== undefined && deployBlock !== null && deployBlock !== ""
        ? { deployBlock: Number(deployBlock) }
        : {}),
      kleros: {
        ...(network.kleros ?? {}),
        disputeResolver: ev.disputeResolver,
        arbitrator: ev.arbitrator,
        policyURI: ev.policyURI,
      },
    },
    "the contract",
    { depositCap: false },
  );
}
