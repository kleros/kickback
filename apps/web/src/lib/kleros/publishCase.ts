import { presenceEventAbi } from "@kickback/contracts";
import { ipfsPathOf, KLEROS_IPFS_GATEWAY, KLEROS_IPFS_UPLOAD } from "@kickback/core";
import type { Address, PublicClient } from "viem";

/** Uploads one text file through Kleros's IPFS service and returns its "/ipfs/<cid>" path. */
export async function uploadToKleros(text: string, filename: string, fetcher: typeof fetch = fetch): Promise<string> {
  const form = new FormData();
  form.append("data", new Blob([text], { type: "application/json" }), filename);
  let res: Response;
  try {
    res = await fetcher(`${KLEROS_IPFS_UPLOAD}?operation=file&pinToGraph=false`, { method: "POST", body: form });
  } catch {
    throw new Error(
      "Could not reach Kleros's IPFS service to publish the case. Nothing was sent. Try again in a minute.",
    );
  }
  if (!res.ok) throw new Error(`Kleros's IPFS service answered with error ${res.status}. Nothing was sent. Try again.`);
  let body: { cids?: string[]; data?: { cids?: string[] } };
  try {
    body = await res.json();
  } catch {
    throw new Error("Kleros's IPFS service gave an answer that could not be read. Nothing was sent. Try again.");
  }
  const path = (body.cids?.[0] ?? body.data?.cids?.[0] ?? "").replace(/^ipfs:\/\//, "/ipfs/");
  if (!path.startsWith("/ipfs/")) throw new Error("Kleros's IPFS service gave no address. Nothing was sent.");
  return path;
}

/**
 * Makes sure the jurors can read the case before it opens: reads the case text the contract will point Kleros at,
 * checks it hashes to that address, and pins it through Kleros's IPFS service. Throws (so nothing is sent) if any
 * step fails.
 */
export async function publishCase(
  client: Pick<PublicClient, "readContract">,
  event: Address,
  staker: Address,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const [text, uri] = await client.readContract({
    address: event,
    abi: presenceEventAbi,
    functionName: "caseMetaEvidence",
    args: [staker],
  });
  if (ipfsPathOf(text) !== uri)
    throw new Error("The case description does not match its IPFS address. Nothing was sent.");
  const pinned = await uploadToKleros(text, "metaevidence.json", fetcher);
  if (pinned !== uri) {
    const reachable = await fetcher(KLEROS_IPFS_GATEWAY + uri)
      .then((r) => r.ok)
      .catch(() => false);
    if (!reachable) throw new Error(`The case description was saved at ${pinned}, not ${uri}. Nothing was sent.`);
  }
  return uri;
}
