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

/**
 * The CIDv0 ("Qm…") `ipfs add` gives these bytes with default settings, for up to one block
 * (256 KiB): sha256 of a dag-pb node holding a UnixFS file, as a base58 multihash. Same as the contract.
 */
export function ipfsCidV0(data: string | Uint8Array): string {
  const bytes = typeof data === "string" ? stringToBytes(data) : data;
  if (bytes.length > MAX_METAEVIDENCE_BYTES) throw new Error("More than one IPFS block (256 KiB)");
  const size = varint(bytes.length);
  const file = concat([new Uint8Array([0x08, 0x02, 0x12, ...size]), bytes, new Uint8Array([0x18, ...size])]);
  const node = concat([new Uint8Array([0x0a, ...varint(file.length)]), file]);
  return base58(concat([new Uint8Array([0x12, 0x20]), sha256(node, "bytes")]));
}
/** "/ipfs/<CIDv0>" of a text, as the contract's caseMetaEvidence computes it. */
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
