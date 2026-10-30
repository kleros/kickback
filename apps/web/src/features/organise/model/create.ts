import genericTemplate from "@kickback/contracts/docs/metaevidence.generic.template.json";
import {
  caseTemplate,
  deployArgs,
  describeWhen,
  ipfsCidV0,
  newEventConfig,
  offsetOf,
  renderCase,
  templateValues,
  TZ_OFFSETS,
  type NetworkInput,
} from "@kickback/core";
import * as v from "valibot";
import { isAddress, type Address } from "viem";

import { GENERIC_POLICY_TEXT } from "./policy";

const text = (max: number) => v.pipe(v.string(), v.trim(), v.minLength(1, "Please fill this in."), v.maxLength(max));
export const createEventSchema = v.object({
  title: text(200),
  shortName: text(80),
  start: text(16),
  end: text(16),
  timezoneOffset: v.pipe(
    v.string(),
    v.check((value) => TZ_OFFSETS.includes(value), "Choose a timezone offset."),
  ),
  zoneName: v.pipe(v.string(), v.trim(), v.maxLength(40)),
  venue: text(200),
  hosts: text(200),
  registrationLink: v.pipe(text(300), v.url(), v.startsWith("https://")),
  deposit: v.pipe(v.string(), v.regex(/^(?:0|1)(?:\.\d{1,18})?$/, "Enter an ETH amount up to 1 ETH.")),
  settleDays: v.pipe(v.number(), v.integer(), v.minValue(7), v.maxValue(365)),
});
export type CreateEventForm = v.InferOutput<typeof createEventSchema>;
const SAMPLE_OWNER: Address = "0x1111111111111111111111111111111111111111";
const SAMPLE_WALLET: Address = "0x2222222222222222222222222222222222222222";
const SAMPLE_CONTRACT: Address = "0x3333333333333333333333333333333333333333";
export const GENERIC_TEMPLATE = JSON.stringify(genericTemplate);

export function createConfig(input: unknown, network: NetworkInput, owner: Address = SAMPLE_OWNER) {
  const form = v.parse(createEventSchema, input);
  const iso = (value: string) => {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))
      throw new Error("Use a local date and time, with the timezone chosen separately.");
    const date = `${value}:00${form.timezoneOffset}`;
    const time = Date.parse(date);
    if (!Number.isFinite(time) || new Date(time + offsetOf(date)! * 60000).toISOString().slice(0, 16) !== value)
      throw new Error("Choose a valid calendar date and time.");
    return date;
  };
  const start = iso(form.start);
  const end = iso(form.end);
  return newEventConfig(
    {
      eventTitle: form.title,
      eventName: form.shortName,
      eventStart: start,
      eventWhen: describeWhen(start, end, form.zoneName),
      eventWhere: form.venue,
      hosts: form.hosts,
      eventLink: form.registrationLink,
      deposit: form.deposit,
      claimDeadline: new Date(Date.parse(start) + form.settleDays * 86400000).toISOString(),
    },
    network,
    owner,
  );
}

export function jurorPreview(input: unknown, network: NetworkInput, policyURI: string, owner?: Address) {
  const cfg = createConfig(input, { ...network, kleros: { ...network.kleros, policyURI } }, owner);
  const template = caseTemplate(GENERIC_TEMPLATE, templateValues(cfg, owner ?? SAMPLE_OWNER));
  return renderCase(template, SAMPLE_WALLET, SAMPLE_CONTRACT);
}

export function createDeployment(
  input: unknown,
  network: NetworkInput,
  owner: Address,
  policyURI: string,
  now: number,
) {
  const config = createConfig(input, { ...network, kleros: { ...network.kleros, policyURI } }, owner);
  if (config.eventStartTs! <= now) throw new Error("The event must start in the future.");
  return { config, args: deployArgs(config, owner, GENERIC_TEMPLATE) };
}

export interface BrowserDeployment {
  address: Address;
  chainId: number;
  block: number;
  name: string;
}
export const DEPLOYMENTS_KEY = "kickback.organise.deployments.v1";
export interface DeploymentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readDeployments(storage?: DeploymentStorage): BrowserDeployment[] {
  try {
    const rows: unknown = JSON.parse((storage ?? globalThis.localStorage).getItem(DEPLOYMENTS_KEY) ?? "[]");
    if (!Array.isArray(rows)) return [];
    return rows.filter(
      (row): row is BrowserDeployment =>
        !!row &&
        typeof row === "object" &&
        isAddress(row.address) &&
        Number.isSafeInteger(row.chainId) &&
        row.chainId > 0 &&
        Number.isSafeInteger(row.block) &&
        row.block >= 0 &&
        typeof row.name === "string",
    );
  } catch {
    return [];
  }
}

export function saveDeployment(deployment: BrowserDeployment, storage?: DeploymentStorage): boolean {
  try {
    const target = storage ?? globalThis.localStorage;
    const rows = readDeployments(target).filter(
      (r) => r.chainId !== deployment.chainId || r.address.toLowerCase() !== deployment.address.toLowerCase(),
    );
    target.setItem(DEPLOYMENTS_KEY, JSON.stringify([deployment, ...rows]));
    return true;
  } catch {
    return false;
  }
}

export async function pinGenericPolicy(transport: {
  upload(text: string): Promise<string>;
  fetch(uri: string): Promise<string>;
}) {
  const policy = GENERIC_POLICY_TEXT;
  const expected = `/ipfs/${ipfsCidV0(policy)}`;
  const uri = await transport.upload(policy);
  if (uri !== expected || ipfsCidV0(await transport.fetch(uri)) !== ipfsCidV0(policy))
    throw new Error("The pinned policy did not match; do not deploy. Try pinning it again.");
  return uri;
}
