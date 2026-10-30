import { concat, hexToBytes, sha256, stringToBytes, type Hex } from "viem";

import { MAX_METAEVIDENCE_BYTES, SLOT } from "./constants";
import { checkedAddress } from "./text";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
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

const varint = (value: number): number[] => {
  const o: number[] = [];
  let n = value;
  while (n >= 0x80) {
    o.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  o.push(n);
  return o;
};

/** Default CIDv0 UnixFS encoding: 256 KiB chunks, dag-pb leaves and a balanced parent, up to 2 MiB. */
export function ipfsCidV0(data: string | Uint8Array): string {
  const bytes = typeof data === "string" ? stringToBytes(data) : data;
  if (bytes.length > 2 * 1024 * 1024) throw new Error("More than 2 MiB of IPFS data");
  const field = (tag: number, value: Uint8Array) => concat([new Uint8Array([tag, ...varint(value.length)]), value]);
  const hash = (block: Uint8Array) => concat([new Uint8Array([0x12, 0x20]), sha256(block, "bytes")]);
  const leaf = (chunk: Uint8Array) =>
    field(
      0x0a,
      concat([new Uint8Array([0x08, 0x02]), field(0x12, chunk), new Uint8Array([0x18, ...varint(chunk.length)])]),
    );
  if (bytes.length <= MAX_METAEVIDENCE_BYTES) return base58(hash(leaf(bytes)));
  const links: Uint8Array[] = [];
  const sizes: number[] = [];
  for (let i = 0; i < bytes.length; i += MAX_METAEVIDENCE_BYTES) {
    const chunk = bytes.subarray(i, i + MAX_METAEVIDENCE_BYTES);
    const node = leaf(chunk);
    links.push(field(0x12, concat([field(0x0a, hash(node)), new Uint8Array([0x12, 0, 0x18, ...varint(node.length)])])));
    sizes.push(0x20, ...varint(chunk.length));
  }
  // DAG-PB serializes links before data; UnixFS records each child's file size separately from its DAG size.
  const file = new Uint8Array([0x08, 0x02, 0x18, ...varint(bytes.length), ...sizes]);
  return base58(hash(concat([...links, field(0x0a, file)])));
}
/** "/ipfs/<CIDv0>" of text using the default UnixFS encoding. */
export const ipfsPathOf = (text: string): string => "/ipfs/" + ipfsCidV0(text);

export interface MetaEvidenceTemplate {
  pieces: readonly string[];
  /** One byte per value between pieces (SLOT). */
  slots: Hex;
}

/** A case description from the template pieces: what the contract's caseMetaEvidence(wallet) returns. */
export function renderCase({ pieces, slots }: MetaEvidenceTemplate, wallet: string, contract: string): string {
  let out = pieces[0] ?? "";
  hexToBytes(slots).forEach((v, i) => {
    const w = checkedAddress(wallet);
    const value = v === SLOT.wallet ? w : v === SLOT.contract ? checkedAddress(contract) : w.toLowerCase();
    out += value + (pieces[i + 1] ?? "");
  });
  return out;
}

/**
 * The SHA-256 of runtime code with its immutables zeroed (`immutables`: [start, length] byte ranges),
 * so every deployment of one build has the same fingerprint. null when a range lies outside the code.
 */
export function codeFingerprint(
  code: Hex | undefined,
  immutables: readonly (readonly [number, number])[] = [],
): Hex | null {
  const b = hexToBytes(code ?? "0x");
  for (const [start, length] of immutables) {
    if (!(Number.isInteger(start) && Number.isInteger(length) && start >= 0 && start + length <= b.length)) return null;
    b.fill(0, start, start + length);
  }
  return sha256(b);
}
