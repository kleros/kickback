import { ipfsPathOf } from "@kickback/core";
import { describe, expect, it, vi } from "vitest";

import { publishCase } from "../publishCase";

const text = '{"title":"Did this wallet attend?"}';
const uri = ipfsPathOf(text);
const event = "0x0000000000000000000000000000000000000001" as const;
const staker = "0x0000000000000000000000000000000000000002" as const;
const client = (t = text, u = uri) => ({ readContract: vi.fn().mockResolvedValue([t, u]) }) as never;
const answer = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response;

describe("publishCase", () => {
  it("pins the contract's case text and returns its address", async () => {
    const fetcher = vi.fn().mockResolvedValue(answer({ cids: [`ipfs://${uri.slice(6)}`] }));
    await expect(publishCase(client(), event, staker, fetcher)).resolves.toBe(uri);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("stops before the wallet prompt when the text does not hash to the contract's address", async () => {
    const fetcher = vi.fn();
    await expect(publishCase(client(text, "/ipfs/QmWrong"), event, staker, fetcher)).rejects.toThrow(
      /Nothing was sent/,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stops when the IPFS service fails", async () => {
    const fetcher = vi.fn().mockResolvedValue(answer({}, false));
    await expect(publishCase(client(), event, staker, fetcher)).rejects.toThrow(/Nothing was sent/);
  });

  it("accepts another CID only if the case address itself is readable", async () => {
    const ok = vi
      .fn()
      .mockResolvedValueOnce(answer({ cids: ["/ipfs/QmOther"] }))
      .mockResolvedValueOnce(answer({}));
    await expect(publishCase(client(), event, staker, ok)).resolves.toBe(uri);
    const bad = vi
      .fn()
      .mockResolvedValueOnce(answer({ cids: ["/ipfs/QmOther"] }))
      .mockRejectedValueOnce(new Error());
    await expect(publishCase(client(), event, staker, bad)).rejects.toThrow(/Nothing was sent/);
  });
});
