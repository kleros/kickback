import {
  buildEventInfo,
  fetchVerifiedIpfs,
  imageMime,
  ipfsCidV0,
  MAX_COVER_BYTES,
  serializeEventInfo,
  type EventCover,
  type NetworkInput,
} from "@kickback/core";
import type { Address } from "viem";

import { pinFile } from "./policy";
import { parseCreateForm, createConfig, createDeployment } from "../model/create";

export function eventInfoTransport(fetcher: typeof fetch = globalThis.fetch) {
  return {
    async pin(bytes: Uint8Array, mime: string, filename: string) {
      const expected = `/ipfs/${ipfsCidV0(bytes)}`;
      const path = await pinFile(new Blob([new Uint8Array(bytes)], { type: mime }), filename, fetcher);
      if (path !== expected) throw new Error("The pin service returned a different CID.");
      await fetchVerifiedIpfs(expected, bytes.length, fetcher);
      return expected;
    },
  };
}
export async function pinEventInfo(input: unknown, transport = eventInfoTransport()) {
  const form = parseCreateForm(input);
  if (!form.description && !form.links.length && !form.cover) return null;
  let cover: EventCover | undefined;
  if (form.cover) {
    const bytes = new Uint8Array(await form.cover.arrayBuffer());
    const mime = imageMime(bytes);
    if (
      bytes.length !== form.cover.size ||
      bytes.length > MAX_COVER_BYTES ||
      mime !== form.cover.type ||
      mime === "image/gif" ||
      mime === null
    )
      throw new Error("The cover is not the selected image type.");
    cover = { path: await transport.pin(bytes, mime, "cover"), mime, bytes: bytes.length };
  }
  const document = buildEventInfo({ description: form.description, links: form.links, cover });
  const json = serializeEventInfo(document);
  const path = await transport.pin(new TextEncoder().encode(json), "application/json", "event-info.json");
  return { path, document, json };
}

export async function prepareEventDeployment(
  input: unknown,
  network: NetworkInput,
  owner: Address,
  policyURI: string,
  now: number,
  transport = eventInfoTransport(),
) {
  const config = createConfig(input, network, owner);
  if (config.eventStartTs! <= now) throw new Error("The event must start in the future.");
  const info = await pinEventInfo(input, transport);
  return { ...createDeployment(input, network, owner, policyURI, now, info?.path), info };
}
