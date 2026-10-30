import { isIpfsPath, KLEROS_IPFS_GATEWAY, KLEROS_IPFS_UPLOAD } from "@kickback/core";

export function uploadedPolicyPath(answer: unknown): string {
  const record = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const body = record(answer);
  const data = record(body.data);
  const candidates = [
    answer,
    body.cid,
    body.path,
    body.IpfsHash,
    body.Hash,
    ...(Array.isArray(body.cids) ? body.cids : []),
    data.cid,
    data.path,
    ...(Array.isArray(data.cids) ? data.cids : []),
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const text = candidate.trim();
    const path = text.includes("/ipfs/")
      ? text.slice(text.indexOf("/ipfs/"))
      : `/ipfs/${text.replace(/^ipfs:\/\//, "")}`;
    if (isIpfsPath(path)) return path;
  }
  throw new Error("The pin service did not return a policy address; try again.");
}

export async function pinFile(file: Blob, filename: string, fetcher: typeof fetch = globalThis.fetch) {
  const body = new FormData();
  body.append("data", file, filename);
  const response = await fetcher(`${KLEROS_IPFS_UPLOAD}?operation=file&pinToGraph=false`, { method: "POST", body });
  if (!response.ok) throw new Error("Could not pin the file; try again.");
  return uploadedPolicyPath(await response.json());
}

export function policyTransport(fetcher: typeof fetch = globalThis.fetch) {
  return {
    async upload(text: string) {
      return pinFile(new Blob([text], { type: "text/markdown" }), "attendance-policy.generic.md", fetcher);
    },
    async fetch(uri: string) {
      if (!isIpfsPath(uri)) throw new Error("Invalid policy address.");
      const response = await fetcher(`${KLEROS_IPFS_GATEWAY}${uri}`);
      if (!response.ok) throw new Error("Could not verify the pinned policy; try again.");
      return response.text();
    },
  };
}
